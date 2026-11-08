const prisma = require("../../config/prisma");

const ACTIVE_REVIEW_STATES = Object.freeze([
  "IN_REVIEW",
  "REVISION_REQUIRED",
  "APPROVED",
  "VERIFIED",
]);

function publicState() {
  // No bank-consumable observation contract exists yet. Local pointers,
  // decisions and transport outcomes establish neither presence nor absence.
  return "PUBLIC_UNKNOWN";
}

function deliveryState(outbox) {
  if (!outbox) return "NOT_SENT";
  if (outbox.state === "ACKNOWLEDGED") return "RECEIVED_BY_CONTROL";
  if (["QUEUED", "SENDING", "RETRYING"].includes(outbox.state)) {
    return "SENDING_TO_CONTROL";
  }
  if (["FAILED", "QUARANTINED"].includes(outbox.state)) {
    return "DELIVERY_FAILED";
  }
  return "UNKNOWN";
}

function bankApplicationState(command, reviewState) {
  if (command?.status === "APPLIED") return "APPLIED_BY_BANK";
  if (command?.status === "REJECTED") return "DECISION_REJECTED_BY_BANK";
  if (["APPROVED", "VERIFIED", "REVISION_REQUIRED"].includes(reviewState)) {
    return "APPLIED_BY_BANK";
  }
  return "WAITING_FOR_DECISION";
}

function requestKind(version, aggregate) {
  // Approval of this submission must not relabel its history as a change.
  // Revisions before the first approval still belong to the initial request.
  const firstApproved = aggregate.versions?.[0]?.version_number;
  return firstApproved != null && firstApproved < version.version_number ? "CHANGE" : "CREATE";
}

function submittedBy(user) {
  return user ? { id: user.id, name: user.name } : null;
}

async function loadVersions(kind, where, take, position) {
  const scoped = position ? { AND: [where, position] } : where;
  if (kind === "PROFILE") {
    return prisma.sj_public_profile_versions.findMany({
      where: scoped,
      include: {
        creator: { select: { id: true, name: true } },
        profile: {
          select: {
            id: true,
            display_name: true,
            current_version_id: true,
            sync_state: true,
            versions: { where: { approved_at: { not: null } }, orderBy: { version_number: "asc" }, take: 1, select: { version_number: true } },
          },
        },
      },
      orderBy: [{ submitted_at: "desc" }, { created_at: "desc" }, { id: "desc" }],
      take,
    });
  }
  if (kind === "CONTACT") {
    return prisma.sj_whatsapp_contact_versions.findMany({
      where: scoped,
      include: {
        creator: { select: { id: true, name: true } },
        contact: {
          select: {
            id: true,
            label: true,
            current_version_id: true,
            sync_state: true,
            versions: { where: { verified_at: { not: null } }, orderBy: { version_number: "asc" }, take: 1, select: { version_number: true } },
          },
        },
      },
      orderBy: [{ submitted_at: "desc" }, { created_at: "desc" }, { id: "desc" }],
      take,
    });
  }
  return prisma.sj_publication_versions.findMany({
    where: scoped,
    include: {
      submitter: { select: { id: true, name: true } },
      editor: { select: { id: true, name: true } },
      publication: {
        select: {
          id: true,
          public_reference_code: true,
          current_version_id: true,
          published_version_id: true,
          sync_state: true,
          versions: { where: { approved_at: { not: null } }, orderBy: { version_number: "asc" }, take: 1, select: { version_number: true } },
        },
      },
    },
    orderBy: [{ submitted_at: "desc" }, { created_at: "desc" }, { id: "desc" }],
    take,
  });
}

function baseWhere(state) {
  return {
    submitted_at: { not: null },
    ...(state ? { state } : { state: { in: ACTIVE_REVIEW_STATES } }),
  };
}

function serializeProfile(version, outbox, command) {
  const profile = version.profile;
  return {
    id: version.id,
    kind: "PROFILE",
    request_kind: requestKind(version, profile),
    resource_id: profile.id,
    resource_label: version.payload_json?.public_name || "Profil BPRS",
    submitted_by: submittedBy(version.creator),
    submitted_at: version.submitted_at,
    version_number: version.version_number,
    payload_checksum: version.payload_checksum,
    review_state: version.state,
    reviewer_note: version.rejection_reason,
    delivery_state: deliveryState(outbox),
    bank_application_state: bankApplicationState(command, version.state),
    public_state: publicState({
      currentVersionId: profile.current_version_id,
      syncState: profile.sync_state,
    }),
    snapshot: require('./readContract').profilePayload(version.payload_json),
  };
}

function serializeContact(version, outbox, command) {
  const contact = version.contact;
  return {
    id: version.id,
    kind: "CONTACT",
    request_kind: requestKind(version, contact),
    resource_id: contact.id,
    resource_label: version.label || contact.label,
    submitted_by: submittedBy(version.creator),
    submitted_at: version.submitted_at,
    version_number: version.version_number,
    payload_checksum: version.checksum,
    review_state: version.state,
    reviewer_note: version.rejection_reason,
    delivery_state: deliveryState(outbox),
    bank_application_state: bankApplicationState(command, version.state),
    public_state: "NOT_APPLICABLE", // Contacts have no standalone public page.
    snapshot: {
      label: version.label,
      phone_e164: version.phone_e164,
      message_template_version: version.message_template_version,
    },
  };
}

function serializePublication(version, outbox, command) {
  const publication = version.publication;
  return {
    id: version.id,
    kind: "PUBLICATION",
    request_kind: requestKind(version, publication),
    resource_id: publication.id,
    resource_label: version.title,
    reference_code: publication.public_reference_code,
    submitted_by: submittedBy(version.submitter || version.editor),
    submitted_at: version.submitted_at,
    version_number: version.version_number,
    payload_checksum: version.payload_checksum,
    review_state: version.state,
    reviewer_note: version.rejection_reason,
    delivery_state: deliveryState(outbox),
    bank_application_state: bankApplicationState(command, version.state),
    public_state: publicState({
      publishedVersionId: publication.published_version_id,
      syncState: publication.sync_state,
    }),
    snapshot: require('./readContract').publicationPayload(version.public_payload_json),
  };
}

exports.listSubmissions = async ({ page = 1, limit = 20, kind, state, paged, cursor:position } = {}) => {
  const kinds = kind ? [kind] : ["PROFILE", "CONTACT", "PUBLICATION"];
  const take = paged ? limit + 1 : page * limit;
  const where = baseWhere(state);
  const cursorCodec=require('./readCursor'),cursorFilter={kind:kind||null,state:state||null};
  const [groups, counts] = await Promise.all([
    Promise.all(kinds.map((itemKind) => loadVersions(itemKind, where, take,
      paged ? cursorCodec.decodeSubmission(position,cursorFilter,itemKind) : null))),
    paged ? [] : Promise.all(kinds.map((itemKind) => {
      if (itemKind === "PROFILE") return prisma.sj_public_profile_versions.count({ where });
      if (itemKind === "CONTACT") return prisma.sj_whatsapp_contact_versions.count({ where });
      return prisma.sj_publication_versions.count({ where });
    })),
  ]);
  const offset = paged ? 0 : (page - 1) * limit;
  const rows = groups.flatMap((items, index) =>
    items.map((version) => ({ kind: kinds[index], version })),
  ).sort(require('./readContract').compareSubmissions).slice(offset,offset+limit+(paged?1:0));
  const snapshotIds = rows.map(({ version }) => version.id);
  const [outboxRows] = await Promise.all([
    snapshotIds.length
      ? prisma.sj_sync_outbox.findMany({
          where: {
            event_type: "CONTROL_REVIEW_SNAPSHOT",
            aggregate_id: { in: snapshotIds },
          },
          orderBy: [{ created_at: "desc" },{id:'desc'}],
        })
      : [],
  ]);
  const outboxBySnapshot = new Map();
  for (const row of outboxRows) {
    if (!outboxBySnapshot.has(row.aggregate_id)) outboxBySnapshot.set(row.aggregate_id, row);
  }
  const outcomeBySnapshot = new Map();
  const outcomeInputs=[];
  for (const {kind: itemKind, version} of rows) {
    const envelope = outboxBySnapshot.get(version.id)?.payload_json;
    // Historical local submissions have no central snapshot: never guess the
    // submitted lock_version from version_number/current mutable aggregate.
    if (!envelope?.resource || !Number.isInteger(envelope.source_version) || !envelope.payload_checksum) continue;
    outcomeInputs.push({snapshot_id:version.id,kind:itemKind.toLowerCase(),resource_id:envelope.resource.id,source_version:envelope.source_version,checksum:envelope.payload_checksum});
  }
  if(outcomeInputs.length){
    // One round-trip for this page. The existing permission-scoped function
    // remains authoritative; no direct access to the command ledger is added.
    const outcomes=await prisma.$queryRaw`
      SELECT input.snapshot_id, outcome.status
      FROM jsonb_to_recordset(${JSON.stringify(outcomeInputs)}::jsonb)
        AS input(snapshot_id text,kind text,resource_id text,source_version integer,checksum text)
      CROSS JOIN LATERAL public.ruwang_arsip_sj_review_outcome(
        input.kind,input.resource_id,input.source_version,input.checksum) outcome`;
    for(const outcome of outcomes)outcomeBySnapshot.set(outcome.snapshot_id,outcome);
  }
  const serialized = rows
    .map(({ kind: itemKind, version }) => {
      const outbox = outboxBySnapshot.get(version.id);
      const command = outcomeBySnapshot.get(version.id);
      if (itemKind === "PROFILE") return serializeProfile(version, outbox, command);
      if (itemKind === "CONTACT") return serializeContact(version, outbox, command);
      return serializePublication(version, outbox, command);
    });
  const total = counts.reduce((sum, count) => sum + count, 0);
  if(paged)return cursorCodec.pageSubmission(rows,limit,cursorFilter,(_row,index)=>serialized[index]);
  return {items: serialized,pagination: require('./readContract').pagination(page,limit,total)};
};

exports._private = {
  serializeContact,
  bankApplicationState,
  deliveryState,
  requestKind,
  publicState,
};
