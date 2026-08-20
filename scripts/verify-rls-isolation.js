const crypto = require("node:crypto");
const { Client } = require("pg");
const { loadEnv } = require("../src/config/env");
const {
  MANDATORY_RLS_TABLES,
} = require("../src/system/database-security");

loadEnv();

function connectionString() {
  return (
    process.env.RLS_VERIFY_DATABASE_URL ||
    process.env.MIGRATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    ""
  );
}

async function main() {
  const client = new Client({ connectionString: connectionString() });
  const roleName = `rls_verify_${crypto.randomBytes(6).toString("hex")}`;
  const ids = {
    appRole: crypto.randomUUID(),
    appRoleNoMenu: crypto.randomUUID(),
    appRoleMenu: crypto.randomUUID(),
    appRoleCreateMenu: crypto.randomUUID(),
    appRoleRequestableMenu: crypto.randomUUID(),
    appUserOne: crypto.randomUUID(),
    appUserTwo: crypto.randomUUID(),
    documentCreated: crypto.randomUUID(),
    documentOne: crypto.randomUUID(),
    documentRestricted: crypto.randomUUID(),
    documentTwo: crypto.randomUUID(),
    notificationOne: crypto.randomUUID(),
    notificationTwo: crypto.randomUUID(),
    refreshOne: crypto.randomUUID(),
    refreshTwo: crypto.randomUUID(),
    actionOne: crypto.randomUUID(),
    actionTwo: crypto.randomUUID(),
    accessRequest: crypto.randomUUID(),
    relatedUser: crypto.randomUUID(),
    relatedUserNoMenu: crypto.randomUUID(),
    debtorActivityOne: crypto.randomUUID(),
    debtorActivityTwo: crypto.randomUUID(),
    debtorIdebOne: crypto.randomUUID(),
    debtorIdebTwo: crypto.randomUUID(),
    legalActivityOne: crypto.randomUUID(),
    legalActivityTwo: crypto.randomUUID(),
    debtorOne: crypto.randomUUID(),
    debtorTwo: crypto.randomUUID(),
    contractOne: crypto.randomUUID(),
    contractTwo: crypto.randomUUID(),
    collateralOne: crypto.randomUUID(),
    collateralTwo: crypto.randomUUID(),
    incomingOne: crypto.randomUUID(),
    incomingTwo: crypto.randomUUID(),
    outgoingOne: crypto.randomUUID(),
    outgoingTwo: crypto.randomUUID(),
    memorandumOne: crypto.randomUUID(),
    memorandumTwo: crypto.randomUUID(),
    legalDepositOne: crypto.randomUUID(),
    legalDepositTwo: crypto.randomUUID(),
  };
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `CREATE ROLE "${roleName}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await client.query(`GRANT USAGE ON SCHEMA public TO "${roleName}"`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON
         notifications,
         refresh_tokens,
         auth_action_tokens,
         digital_documents,
         digital_debtors,
         debtor_contracts,
         debtor_collaterals,
         incoming_mails,
         outgoing_mails,
         memorandums,
         legal_deposits
       TO "${roleName}"`,
    );
    await client.query(
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "${roleName}"`,
    );
    await client.query(
      `GRANT SELECT ON ${MANDATORY_RLS_TABLES.map((table) => `"${table}"`).join(", ")} TO "${roleName}"`,
    );
    await client.query(
      `GRANT SELECT ON
         users,
         role_menus,
         menus,
         digital_document_related_users,
         digital_document_access_requests
       TO "${roleName}"`,
    );

    const dependencies = await client.query(`
      SELECT
        (SELECT id FROM divisions ORDER BY id LIMIT 1) AS division_id,
        (SELECT id FROM storages WHERE is_active = true ORDER BY id LIMIT 1) AS storage_id,
        (SELECT id FROM document_types WHERE is_active = true ORDER BY id LIMIT 1) AS document_type_id,
        (SELECT id FROM menus
          WHERE url = '/dashboard/arsip-digital/ruang-arsip/list-dokumen'
          ORDER BY id LIMIT 1) AS menu_id,
        (SELECT id FROM menus
          WHERE url = '/dashboard/arsip-digital/input-dokumen'
          ORDER BY id LIMIT 1) AS input_menu_id,
        (SELECT id FROM menus
          WHERE url = '/dashboard/arsip-digital/disposisi/pengajuan'
          ORDER BY id LIMIT 1) AS requestable_menu_id,
        (SELECT id FROM letter_priorities ORDER BY id LIMIT 1) AS priority_id,
        (SELECT id FROM financing_products WHERE is_active = true ORDER BY id LIMIT 1) AS product_id,
        (SELECT id FROM contract_types WHERE is_active = true ORDER BY id LIMIT 1) AS contract_type_id
    `);
    const dependency = dependencies.rows[0];
    if (
      !dependency?.division_id ||
      !dependency?.storage_id ||
      !dependency?.document_type_id ||
      !dependency?.menu_id ||
      !dependency?.input_menu_id ||
      !dependency?.requestable_menu_id ||
      !dependency?.priority_id ||
      !dependency?.product_id ||
      !dependency?.contract_type_id
    ) {
      throw new Error(
        "Verifikasi RLS membutuhkan divisi, storage aktif, jenis dokumen aktif, dan menu arsip digital.",
      );
    }
    const suffix = crypto.randomBytes(6).toString("hex");
    await client.query(
      `INSERT INTO roles (id, name, created_at, updated_at)
       VALUES ($1, $3, now(), now()), ($2, $4, now(), now())`,
      [
        ids.appRole,
        ids.appRoleNoMenu,
        `RLS Verify ${suffix}`,
        `RLS Verify No Menu ${suffix}`,
      ],
    );
    await client.query(
      `INSERT INTO role_menus
        (id, role_id, menu_id, can_create, can_read, can_update, can_delete, features, created_at, updated_at)
       VALUES
        ($1, $3, $4, false, true, true, true, ARRAY[]::text[], now(), now()),
        ($2, $3, $5, true, true, false, false, ARRAY[]::text[], now(), now()),
        ($6, $3, $7, true, true, false, false, ARRAY[]::text[], now(), now())`,
      [
        ids.appRoleMenu,
        ids.appRoleCreateMenu,
        ids.appRole,
        dependency.menu_id,
        dependency.input_menu_id,
        ids.appRoleRequestableMenu,
        dependency.requestable_menu_id,
      ],
    );
    for (const menuUrl of [
      "/dashboard/informasi-debitur/master-debitur",
      "/dashboard/manajemen-surat/kelola-surat/input-surat-masuk",
      "/dashboard/manajemen-surat/kelola-surat/input-surat-keluar",
      "/dashboard/manajemen-surat/kelola-surat/input-memorandum",
      "/dashboard/legal/titipan/lainnya",
    ]) {
      await client.query(
        `INSERT INTO role_menus
          (id, role_id, menu_id, can_create, can_read, can_update, can_delete,
           features, created_at, updated_at)
         SELECT $1, $2, menu.id, true, true, true, true,
                ARRAY[]::text[], now(), now()
         FROM menus menu
         WHERE menu.url = $3`,
        [crypto.randomUUID(), ids.appRole, menuUrl],
      );
    }
    await client.query(
      `INSERT INTO users
        (id, name, username, email, password, role_id, division_id, is_active,
         onboarding_status, email_verified_at, password_set_at, created_at, updated_at)
       VALUES
        ($1, 'RLS User One', $3, $4, 'temporary', $5, $6, true,
         'ACTIVE', now(), now(), now(), now()),
        ($2, 'RLS User Two', $7, $8, 'temporary', $9, $6, true,
         'ACTIVE', now(), now(), now(), now())`,
      [
        ids.appUserOne,
        ids.appUserTwo,
        `rls_one_${suffix}`,
        `rls_one_${suffix}@invalid.local`,
        ids.appRole,
        dependency.division_id,
        `rls_two_${suffix}`,
        `rls_two_${suffix}@invalid.local`,
        ids.appRoleNoMenu,
      ],
    );
    const firstUser = ids.appUserOne;
    const secondUser = ids.appUserTwo;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await client.query(
      `INSERT INTO digital_documents
        (id, storage_id, owner_user_id, owner_division_id, access_level,
         document_type_id, document_number, document_name, created_by,
         created_at, updated_at)
       VALUES
        ($1, $3, $4, $5, 'NON_RESTRICT', $6, $7, 'RLS Document One', $4, now(), now()),
        ($2, $3, $8, $5, 'NON_RESTRICT', $6, $9, 'RLS Document Two', $8, now(), now())`,
      [
        ids.documentOne,
        ids.documentTwo,
        dependency.storage_id,
        firstUser,
        dependency.division_id,
        dependency.document_type_id,
        `RLS-DOC-ONE-${suffix}`,
        secondUser,
        `RLS-DOC-TWO-${suffix}`,
      ],
    );

    await client.query(
      `INSERT INTO digital_debtors
        (id, name, marketing_user_id, created_by, created_at, updated_at)
       VALUES ($1, 'RLS Debtor One', $3, $3, now(), now()),
              ($2, 'RLS Debtor Two', $4, $4, now(), now())`,
      [ids.debtorOne, ids.debtorTwo, firstUser, secondUser],
    );
    await client.query(
      `INSERT INTO debtor_contracts
        (id, no_kontrak, debtor_id, product_id, akad_type_id, marketing_user_id,
         tanggal_akad, tenor, created_by, created_at, updated_at)
       VALUES
        ($1, $3, $4, $5, $6, $7, CURRENT_DATE, 12, $7, now(), now()),
        ($2, $8, $9, $5, $6, $10, CURRENT_DATE, 12, $10, now(), now())`,
      [
        ids.contractOne,
        ids.contractTwo,
        `RLS-CONTRACT-ONE-${suffix}`,
        ids.debtorOne,
        dependency.product_id,
        dependency.contract_type_id,
        firstUser,
        `RLS-CONTRACT-TWO-${suffix}`,
        ids.debtorTwo,
        secondUser,
      ],
    );
    await client.query(
      `INSERT INTO debtor_collaterals
        (id, debtor_id, contract_id, collateral_number, period_month, created_by,
         created_at, updated_at)
       VALUES ($1, $3, $4, $5, '2026-07', $6, now(), now()),
              ($2, $7, $8, $9, '2026-07', $10, now(), now())`,
      [
        ids.collateralOne,
        ids.collateralTwo,
        ids.debtorOne,
        ids.contractOne,
        `RLS-COLLATERAL-ONE-${suffix}`,
        firstUser,
        ids.debtorTwo,
        ids.contractTwo,
        `RLS-COLLATERAL-TWO-${suffix}`,
        secondUser,
      ],
    );
    await client.query(
      `INSERT INTO incoming_mails
        (id, letter_prioritie_id, storage_id, name, receive_date, address,
         mail_number, regarding, created_by, created_at, updated_at)
       VALUES ($1, $3, $4, 'RLS Incoming One', CURRENT_DATE, 'Test', $5, 'Test', $6, now(), now()),
              ($2, $3, $4, 'RLS Incoming Two', CURRENT_DATE, 'Test', $7, 'Test', $8, now(), now())`,
      [ids.incomingOne, ids.incomingTwo, dependency.priority_id, dependency.storage_id,
        `RLS-IN-${suffix}-1`, firstUser, `RLS-IN-${suffix}-2`, secondUser],
    );
    await client.query(
      `INSERT INTO outgoing_mails
        (id, letter_prioritie_id, storage_id, delivery_media, name, send_date,
         address, mail_number, created_by, created_at, updated_at)
       VALUES ($1, $3, $4, 'LAINNYA', 'RLS Outgoing One', CURRENT_DATE, 'Test', $5, $6, now(), now()),
              ($2, $3, $4, 'LAINNYA', 'RLS Outgoing Two', CURRENT_DATE, 'Test', $7, $8, now(), now())`,
      [ids.outgoingOne, ids.outgoingTwo, dependency.priority_id, dependency.storage_id,
        `RLS-OUT-${suffix}-1`, firstUser, `RLS-OUT-${suffix}-2`, secondUser],
    );
    await client.query(
      `INSERT INTO memorandums
        (id, origin_division_id, storage_id, memo_number, memo_date, received_date,
         regarding, created_by, created_at, updated_at)
       VALUES ($1, $3, $4, $5, CURRENT_DATE, CURRENT_DATE, 'Test', $6, now(), now()),
              ($2, $3, $4, $7, CURRENT_DATE, CURRENT_DATE, 'Test', $8, now(), now())`,
      [ids.memorandumOne, ids.memorandumTwo, dependency.division_id, dependency.storage_id,
        `RLS-MEMO-${suffix}-1`, firstUser, `RLS-MEMO-${suffix}-2`, secondUser],
    );
    await client.query(
      `INSERT INTO legal_deposits
        (id, type, contract_id, created_by, created_at, updated_at)
       VALUES ($1, 'LAINNYA', $3, $4, now(), now()),
              ($2, 'LAINNYA', $5, $6, now(), now())`,
      [ids.legalDepositOne, ids.legalDepositTwo, ids.contractOne, firstUser, ids.contractTwo, secondUser],
    );
    await client.query(
      `INSERT INTO digital_document_related_users
        (id, document_id, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [ids.relatedUserNoMenu, ids.documentOne, secondUser],
    );
    await client.query(
      `INSERT INTO debtor_activity_logs
        (id, actor_id, action, source, entity_type, entity_id, title, created_at)
       VALUES
        ($1, $3, 'RLS_VERIFY', 'MANUAL', 'RLS_TEST', $1, 'RLS debtor activity one', now()),
        ($2, $4, 'RLS_VERIFY', 'MANUAL', 'RLS_TEST', $2, 'RLS debtor activity two', now())`,
      [ids.debtorActivityOne, ids.debtorActivityTwo, firstUser, secondUser],
    );
    await client.query(
      `INSERT INTO debtor_ideb_uploads
        (id, source_fingerprint, month, year, status, file_path, uploaded_by,
         created_by, created_at, updated_at)
       VALUES
        ($1, $3, 7, 2026, 'COMPLETED', $4, $5, $5, now(), now()),
        ($2, $6, 7, 2026, 'COMPLETED', $7, $8, $8, now(), now())`,
      [
        ids.debtorIdebOne,
        ids.debtorIdebTwo,
        `rls-ideb-one-${suffix}`,
        `rls/ideb-one-${suffix}.json`,
        firstUser,
        `rls-ideb-two-${suffix}`,
        `rls/ideb-two-${suffix}.json`,
        secondUser,
      ],
    );
    await client.query(
      `INSERT INTO legal_activity_logs
        (id, actor_id, action, source, entity_type, entity_id, title, created_at)
       VALUES
        ($1, $3, 'RLS_VERIFY', 'MANUAL', 'RLS_TEST', $1, 'RLS legal activity one', now()),
        ($2, $4, 'RLS_VERIFY', 'MANUAL', 'RLS_TEST', $2, 'RLS legal activity two', now())`,
      [ids.legalActivityOne, ids.legalActivityTwo, firstUser, secondUser],
    );

    await client.query(
      `INSERT INTO notifications
        (id, recipient_id, module, event_type, entity_type, entity_id, title, message, created_at, updated_at)
       VALUES ($1, $2, 'RLS_TEST', 'TEST', 'TEST', $1, 'RLS one', 'temporary', now(), now()),
              ($3, $4, 'RLS_TEST', 'TEST', 'TEST', $3, 'RLS two', 'temporary', now(), now())`,
      [ids.notificationOne, firstUser, ids.notificationTwo, secondUser],
    );
    await client.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, updated_at)
       VALUES ($1, $2, $3, $5, now()), ($4, $6, $7, $5, now())`,
      [
        ids.refreshOne,
        firstUser,
        crypto.randomBytes(32).toString("hex"),
        ids.refreshTwo,
        expiresAt,
        secondUser,
        crypto.randomBytes(32).toString("hex"),
      ],
    );
    await client.query(
      `INSERT INTO auth_action_tokens (id, user_id, type, token_hash, expires_at)
       VALUES ($1, $2, 'RESET_PASSWORD', $3, $5),
              ($4, $6, 'RESET_PASSWORD', $7, $5)`,
      [
        ids.actionOne,
        firstUser,
        crypto.randomBytes(32).toString("hex"),
        ids.actionTwo,
        expiresAt,
        secondUser,
        crypto.randomBytes(32).toString("hex"),
      ],
    );
    await client.query(`SET LOCAL ROLE "${roleName}"`);
    for (const tableName of MANDATORY_RLS_TABLES) {
      const missingContext = await client.query(
        `SELECT COUNT(*)::int AS count FROM "${tableName}"`,
      );
      if (missingContext.rows[0].count !== 0) {
        throw new Error(
          `RLS ${tableName} tidak fail-closed ketika konteks user belum tersedia.`,
        );
      }
    }
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [firstUser],
    );
    const checks = [
      ["notifications", "id", [ids.notificationOne, ids.notificationTwo]],
      ["refresh_tokens", "id", [ids.refreshOne, ids.refreshTwo]],
      ["auth_action_tokens", "id", [ids.actionOne, ids.actionTwo]],
      ["digital_documents", "id", [ids.documentOne, ids.documentTwo]],
      ["digital_debtors", "id", [ids.debtorOne, ids.debtorTwo]],
      ["debtor_contracts", "id", [ids.contractOne, ids.contractTwo]],
      ["debtor_collaterals", "id", [ids.collateralOne, ids.collateralTwo]],
      ["incoming_mails", "id", [ids.incomingOne, ids.incomingTwo]],
      ["outgoing_mails", "id", [ids.outgoingOne, ids.outgoingTwo]],
      ["memorandums", "id", [ids.memorandumOne, ids.memorandumTwo]],
      ["legal_deposits", "id", [ids.legalDepositOne, ids.legalDepositTwo]],
      ["debtor_activity_logs", "id", [ids.debtorActivityOne, ids.debtorActivityTwo]],
      ["debtor_ideb_uploads", "id", [ids.debtorIdebOne, ids.debtorIdebTwo]],
      ["legal_activity_logs", "id", [ids.legalActivityOne, ids.legalActivityTwo]],
    ];
    for (const [tableName, columnName, recordIds] of checks) {
      const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM "${tableName}" WHERE "${columnName}" = ANY($1::text[])`,
        [recordIds],
      );
      if (result.rows[0].count !== 1) {
        throw new Error(`Isolasi SELECT RLS gagal pada ${tableName}.`);
      }
    }
    await client.query(
      "SELECT set_config('app.access_purpose', 'digital_document_requestable', true)",
    );
    const requestableDocuments = await client.query(
      "SELECT COUNT(*)::int AS count FROM digital_documents WHERE id = ANY($1::text[])",
      [[ids.documentOne, ids.documentTwo]],
    );
    if (requestableDocuments.rows[0].count !== 2) {
      throw new Error(
        "Tujuan akses requestable tidak membuka metadata dokumen kandidat.",
      );
    }
    await client.query(
      "SELECT set_config('app.access_purpose', '', true)",
    );
    for (const [tableName, id] of [
      ["digital_debtors", ids.debtorTwo],
      ["debtor_contracts", ids.contractTwo],
      ["debtor_collaterals", ids.collateralTwo],
      ["incoming_mails", ids.incomingTwo],
      ["outgoing_mails", ids.outgoingTwo],
      ["memorandums", ids.memorandumTwo],
      ["legal_deposits", ids.legalDepositTwo],
    ]) {
      const blocked = await client.query(
        `UPDATE "${tableName}" SET updated_at = now() WHERE id = $1`,
        [id],
      );
      if (blocked.rowCount !== 0) {
        throw new Error(`Isolasi UPDATE RLS gagal pada ${tableName}.`);
      }
    }
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [secondUser],
    );
    for (const [tableName, id] of [
      ["digital_documents", ids.documentTwo],
      ["digital_debtors", ids.debtorTwo],
      ["debtor_contracts", ids.contractTwo],
      ["incoming_mails", ids.incomingTwo],
      ["outgoing_mails", ids.outgoingTwo],
      ["memorandums", ids.memorandumTwo],
      ["legal_deposits", ids.legalDepositTwo],
      ["digital_document_related_users", ids.relatedUserNoMenu],
      ["debtor_activity_logs", ids.debtorActivityTwo],
      ["debtor_ideb_uploads", ids.debtorIdebTwo],
      ["legal_activity_logs", ids.legalActivityTwo],
    ]) {
      const noMenuRead = await client.query(
        `SELECT COUNT(*)::int AS count FROM "${tableName}" WHERE id = $1`,
        [id],
      );
      if (noMenuRead.rows[0].count !== 0) {
        throw new Error(
          `RLS ${tableName} membuka data milik user tanpa izin menu.`,
        );
      }
    }
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [firstUser],
    );
    const blockedUpdate = await client.query(
      "UPDATE notifications SET title = 'blocked' WHERE id = $1",
      [ids.notificationTwo],
    );
    if (blockedUpdate.rowCount !== 0) {
      throw new Error("Isolasi UPDATE RLS gagal pada notifications.");
    }
    const allowedDocumentUpdate = await client.query(
      "UPDATE digital_documents SET description = 'allowed' WHERE id = $1",
      [ids.documentOne],
    );
    if (allowedDocumentUpdate.rowCount !== 1) {
      throw new Error("UPDATE dokumen milik sendiri ditolak oleh RLS.");
    }
    const blockedDocumentUpdate = await client.query(
      "UPDATE digital_documents SET description = 'blocked' WHERE id = $1",
      [ids.documentTwo],
    );
    if (blockedDocumentUpdate.rowCount !== 0) {
      throw new Error("Isolasi UPDATE RLS gagal pada digital_documents.");
    }
    const insertDocument = async ({
      accessLevel,
      createdBy,
      id,
      isRestricted = false,
      number,
    }) =>
      client.query(
        `INSERT INTO digital_documents
          (id, storage_id, owner_user_id, owner_division_id, access_level, is_restricted,
           document_type_id, document_number, document_name, created_by,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'RLS Created Document', $9, now(), now())`,
        [
          id,
          dependency.storage_id,
          firstUser,
          dependency.division_id,
          accessLevel,
          isRestricted,
          dependency.document_type_id,
          number,
          createdBy,
        ],
      );

    const allowedInsert = await insertDocument({
      accessLevel: "NON_RESTRICT",
      createdBy: firstUser,
      id: ids.documentCreated,
      number: `RLS-DOC-CREATED-${suffix}`,
    });
    if (allowedInsert.rowCount !== 1) {
      throw new Error("INSERT dokumen sendiri ditolak oleh RLS.");
    }

    async function expectBlockedInsert(savepoint, input, message) {
      await client.query(`SAVEPOINT "${savepoint}"`);
      let blocked = false;
      try {
        await insertDocument(input);
      } catch (error) {
        blocked = error.code === "42501";
      }
      await client.query(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
      if (!blocked) throw new Error(message);
    }

    await expectBlockedInsert(
      "rls_blocked_owner_insert",
      {
        accessLevel: "NON_RESTRICT",
        createdBy: secondUser,
        id: crypto.randomUUID(),
        number: `RLS-DOC-BLOCKED-OWNER-${suffix}`,
      },
      "RLS menerima INSERT dokumen atas nama user lain.",
    );
    await expectBlockedInsert(
      "rls_blocked_restricted_insert",
      {
        accessLevel: "RESTRICT",
        createdBy: firstUser,
        id: ids.documentRestricted,
        number: `RLS-DOC-BLOCKED-RESTRICTED-${suffix}`,
      },
      "RLS menerima dokumen restricted dari user tanpa izin.",
    );
    await expectBlockedInsert(
      "rls_blocked_legacy_restricted_insert",
      {
        accessLevel: "NON_RESTRICT",
        createdBy: firstUser,
        id: crypto.randomUUID(),
        isRestricted: true,
        number: `RLS-DOC-BLOCKED-LEGACY-RESTRICTED-${suffix}`,
      },
      "RLS menerima flag is_restricted dari user tanpa izin.",
    );

    const blockedDocumentDelete = await client.query(
      "DELETE FROM digital_documents WHERE id = $1",
      [ids.documentTwo],
    );
    if (blockedDocumentDelete.rowCount !== 0) {
      throw new Error("Isolasi DELETE RLS gagal pada digital_documents.");
    }
    const allowedDocumentDelete = await client.query(
      "DELETE FROM digital_documents WHERE id = $1",
      [ids.documentCreated],
    );
    if (allowedDocumentDelete.rowCount !== 1) {
      throw new Error("DELETE dokumen sendiri ditolak oleh RLS.");
    }

    await client.query("RESET ROLE");
    await client.query(
      `INSERT INTO digital_document_related_users
        (id, document_id, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [ids.relatedUser, ids.documentTwo, firstUser],
    );
    await client.query(`SET LOCAL ROLE "${roleName}"`);
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [firstUser],
    );
    const relatedDocuments = await client.query(
      "SELECT COUNT(*)::int AS count FROM digital_documents WHERE id = ANY($1::text[])",
      [[ids.documentOne, ids.documentTwo]],
    );
    if (relatedDocuments.rows[0].count !== 2) {
      throw new Error("Related user tidak memperoleh akses dokumen dari RLS.");
    }

    await client.query("RESET ROLE");
    await client.query(
      "DELETE FROM digital_document_related_users WHERE id = $1",
      [ids.relatedUser],
    );
    await client.query(
      `INSERT INTO digital_document_access_requests
        (id, document_id, requester_id, owner_id, status, request_reason,
         expires_at, approved_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'APPROVED', 'RLS verification',
         CURRENT_DATE, now(), now(), now())`,
      [ids.accessRequest, ids.documentTwo, firstUser, secondUser],
    );
    await client.query(`SET LOCAL ROLE "${roleName}"`);
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [firstUser],
    );
    const approvedDocuments = await client.query(
      "SELECT COUNT(*)::int AS count FROM digital_documents WHERE id = ANY($1::text[])",
      [[ids.documentOne, ids.documentTwo]],
    );
    if (approvedDocuments.rows[0].count !== 2) {
      throw new Error(
        "Access request yang berakhir hari ini tidak dianggap aktif oleh RLS.",
      );
    }

    await client.query("RESET ROLE");
    await client.query(
      "UPDATE digital_document_access_requests SET expires_at = CURRENT_DATE - INTERVAL '1 day' WHERE id = $1",
      [ids.accessRequest],
    );
    await client.query(`SET LOCAL ROLE "${roleName}"`);
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [firstUser],
    );
    const expiredDocuments = await client.query(
      "SELECT COUNT(*)::int AS count FROM digital_documents WHERE id = ANY($1::text[])",
      [[ids.documentOne, ids.documentTwo]],
    );
    if (expiredDocuments.rows[0].count !== 1) {
      throw new Error("Access request kedaluwarsa masih membuka dokumen di RLS.");
    }

    await client.query("RESET ROLE");
    await client.query(
      "DELETE FROM digital_document_access_requests WHERE id = $1",
      [ids.accessRequest],
    );
    await client.query(
      "UPDATE role_menus SET features = ARRAY['view_division']::text[] WHERE id = $1",
      [ids.appRoleCreateMenu],
    );
    await client.query(`SET LOCAL ROLE "${roleName}"`);
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [firstUser],
    );
    const divisionDocuments = await client.query(
      "SELECT COUNT(*)::int AS count FROM digital_documents WHERE id = ANY($1::text[])",
      [[ids.documentOne, ids.documentTwo]],
    );
    if (divisionDocuments.rows[0].count !== 2) {
      throw new Error("Feature view_division tidak membuka dokumen satu divisi.");
    }

    await client.query("RESET ROLE");
    await client.query(
      "UPDATE digital_documents SET is_restricted = true WHERE id = $1",
      [ids.documentTwo],
    );
    await client.query(`SET LOCAL ROLE "${roleName}"`);
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [firstUser],
    );
    const restrictedDivisionDocuments = await client.query(
      "SELECT COUNT(*)::int AS count FROM digital_documents WHERE id = ANY($1::text[])",
      [[ids.documentOne, ids.documentTwo]],
    );
    if (restrictedDivisionDocuments.rows[0].count !== 1) {
      throw new Error(
        "Feature view_division membuka dokumen restricted tanpa izin.",
      );
    }

    await client.query("RESET ROLE");
    await client.query(
      "UPDATE digital_documents SET is_restricted = false WHERE id = $1",
      [ids.documentTwo],
    );
    await client.query(
      "UPDATE role_menus SET features = ARRAY['manage_all']::text[] WHERE id = $1",
      [ids.appRoleCreateMenu],
    );
    await client.query(`SET LOCAL ROLE "${roleName}"`);
    await client.query(
      "SELECT set_config('app.current_user_id', $1, true)",
      [firstUser],
    );
    const managedDocuments = await client.query(
      "SELECT COUNT(*)::int AS count FROM digital_documents WHERE id = ANY($1::text[])",
      [[ids.documentOne, ids.documentTwo]],
    );
    if (managedDocuments.rows[0].count !== 2) {
      throw new Error(
        "Feature manage_all pada scope menu arsip tidak membuka data lintas pemilik.",
      );
    }
    const managedDocumentUpdate = await client.query(
      "UPDATE digital_documents SET description = 'managed' WHERE id = $1",
      [ids.documentTwo],
    );
    if (managedDocumentUpdate.rowCount !== 1) {
      throw new Error(
        "Feature manage_all pada scope menu arsip tidak membuka UPDATE lintas pemilik.",
      );
    }

    await client.query("RESET ROLE");
    await client.query("ROLLBACK");
    process.stdout.write(
      `${JSON.stringify({
        status: "passed",
        rollback: true,
        tables_verified: MANDATORY_RLS_TABLES,
      })}\n`,
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Verifikasi RLS gagal:", error.message);
  process.exitCode = 1;
});
