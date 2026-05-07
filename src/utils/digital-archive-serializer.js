const {
  buildFileUrl,
  deriveDocumentFileName,
} = require("./digital-archive-files");

const ACCESS_STATUS_LABELS = {
  PENDING: "Menunggu Persetujuan",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
};

const LOAN_STATUS_LABELS = {
  PENDING: "Menunggu Persetujuan",
  APPROVED: "Disetujui",
  HANDED_OVER: "Sudah Diserahkan",
  REJECTED: "Ditolak",
  BORROWED: "Dipinjam",
  RETURNED: "Dikembalikan",
};

const ACTIVITY_ACTION_LABELS = {
  CREATED: "Input Baru",
  UPDATED: "Edit Data",
  STORAGE_MOVED: "Pindah Lokasi",
  DELETED: "Hapus Dokumen",
  ACCESS_REQUESTED: "Pengajuan Akses",
  ACCESS_APPROVED: "Persetujuan Akses",
  ACCESS_REJECTED: "Penolakan Akses",
  LOAN_REQUESTED: "Pengajuan Peminjaman",
  LOAN_APPROVED: "Persetujuan Peminjaman",
  LOAN_REJECTED: "Penolakan Peminjaman",
  LOAN_HANDED_OVER: "Penyerahan Dokumen",
  LOAN_RETURNED: "Pengembalian Dokumen",
};

function serializeUserSummary(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role_id: user.role_id,
    division_id: user.division_id,
    role: user.role
      ? {
          id: user.role.id,
          name: user.role.name,
          type: user.role.type,
        }
      : null,
    division: user.division
      ? {
          id: user.division.id,
          name: user.division.name,
        }
      : null,
  };
}

function serializeDivisionSummary(division) {
  if (!division) return null;

  return {
    id: division.id,
    name: division.name,
  };
}

function serializeDebtorSummary(debtor) {
  if (!debtor) return null;

  return {
    id: debtor.id,
    debtor_number: debtor.debtor_number,
    name: debtor.name,
    identity_number: debtor.identity_number,
    financing_number: debtor.financing_number,
    description: debtor.description,
  };
}

function serializeStorageSummary(storage) {
  if (!storage) return null;

  const office = storage.cabinet?.office;
  const cabinet = storage.cabinet;

  return {
    id: storage.id,
    office_id: office?.id ?? null,
    office_code: office?.code ?? null,
    office_name: office?.name ?? null,
    cabinet_id: cabinet?.id ?? null,
    cabinet_code: cabinet?.code ?? null,
    rack_name: storage.name,
    capacity: storage.capacity,
    is_active: storage.is_active,
    location_label:
      office && cabinet
        ? `${office.name} - ${cabinet.code} (${storage.name})`
        : storage.name,
  };
}

function isLoanOverdue(loan) {
  if (
    !loan ||
    !["BORROWED", "HANDED_OVER"].includes(loan.status) ||
    !loan.requested_due_date
  ) {
    return false;
  }

  return new Date(loan.requested_due_date) < new Date();
}

function getLoanStatusLabel(loanOrStatus) {
  const status =
    typeof loanOrStatus === "string" ? loanOrStatus : loanOrStatus?.status;

  if (
    typeof loanOrStatus === "object" &&
    loanOrStatus &&
    isLoanOverdue(loanOrStatus)
  ) {
    return "Terlambat";
  }

  return LOAN_STATUS_LABELS[status] || status;
}

function getDocumentAvailability(document) {
  const activeLoan = Array.isArray(document.loans) ? document.loans[0] : null;

  if (!activeLoan) {
    return {
      key: "AVAILABLE",
      label: "Tersedia",
      is_overdue: false,
      current_loan: null,
    };
  }

  if (activeLoan.status === "PENDING") {
    return {
      key: "REQUESTED",
      label: "Diajukan",
      is_overdue: false,
      current_loan: activeLoan,
    };
  }

  if (activeLoan.status === "APPROVED") {
    return {
      key: "PROCESSING",
      label: "Dalam Proses",
      is_overdue: false,
      current_loan: activeLoan,
    };
  }

  return {
    key: "BORROWED",
    label: "Dipinjam",
    is_overdue: isLoanOverdue(activeLoan),
    current_loan: activeLoan,
  };
}

function serializeLoanSummary(loan) {
  if (!loan) return null;

  const statusLabel = getLoanStatusLabel(loan);

  return {
    id: loan.id,
    status_key: loan.status,
    status_label: statusLabel,
    status_pinjam_key: isLoanOverdue(loan) ? "OVERDUE" : loan.status,
    status_pinjam_label: statusLabel,
    request_reason: loan.request_reason,
    requested_start_date: loan.requested_start_date,
    requested_due_date: loan.requested_due_date,
    tanggal_pinjam: loan.requested_start_date,
    tanggal_penyerahan: loan.handover_at,
    tanggal_estimasi_pengembalian: loan.requested_due_date,
    tanggal_pengembalian: loan.returned_at,
    approved_at: loan.approved_at,
    rejected_at: loan.rejected_at,
    handover_at: loan.handover_at,
    returned_at: loan.returned_at,
    is_overdue: isLoanOverdue(loan),
    borrower: serializeUserSummary(loan.borrower),
  };
}

function serializeDocumentFile(req, file, fallbackBaseName) {
  if (!file) return null;

  return {
    id: file.id,
    path: file.file_path,
    name:
      file.file_name ||
      deriveDocumentFileName(file.file_path, fallbackBaseName),
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    is_primary: file.is_primary,
    created_at: file.created_at,
    uploaded_by: file.uploaded_by,
    uploader: serializeUserSummary(file.uploader),
    url: buildFileUrl(req, file.file_path),
  };
}

function serializeDocumentBase(req, document) {
  const availability = getDocumentAvailability(document);
  const documentFiles = Array.isArray(document.document_files)
    ? document.document_files
    : [];
  const primaryFile =
    documentFiles.find((item) => item.is_primary) || documentFiles[0] || null;
  const filePath = document.file || primaryFile?.file_path || null;

  return {
    id: document.id,
    document_number: document.document_number,
    document_name: document.document_name,
    description: document.description,
    is_restricted: document.is_restricted,
    access_level:
      document.access_level ||
      (document.is_restricted ? "RESTRICT" : "NON_RESTRICT"),
    level_access:
      document.access_level ||
      (document.is_restricted ? "RESTRICT" : "NON_RESTRICT"),
    availability_status_key: availability.key,
    availability_status_label: availability.label,
    is_overdue: availability.is_overdue,
    document_date: document.document_date,
    due_date: document.due_date,
    created_at: document.created_at,
    updated_at: document.updated_at,
    deleted_at: document.deleted_at,
    file: filePath
      ? {
          path: filePath,
          name:
            primaryFile?.file_name ||
            deriveDocumentFileName(filePath, document.document_name),
          url: buildFileUrl(req, filePath),
          mime_type: primaryFile?.mime_type || null,
          size_bytes: primaryFile?.size_bytes || null,
        }
      : null,
    files: documentFiles
      .map((item) => serializeDocumentFile(req, item, document.document_name))
      .filter(Boolean),
    document_files: documentFiles
      .map((item) => serializeDocumentFile(req, item, document.document_name))
      .filter(Boolean),
    document_type: document.document_type
      ? {
          id: document.document_type.id,
          code: document.document_type.code,
          name: document.document_type.name,
          description: document.document_type.description,
        }
      : null,
    storage: serializeStorageSummary(document.storage),
    creator: serializeUserSummary(document.creator),
    owner: serializeUserSummary(document.owner),
    owner_user: serializeUserSummary(document.owner),
    owner_division: serializeDivisionSummary(document.owner_division),
    debtor: serializeDebtorSummary(document.debtor),
    related_users: Array.isArray(document.related_users)
      ? document.related_users
          .map((item) => serializeUserSummary(item.user))
          .filter(Boolean)
      : [],
    updater: serializeUserSummary(document.updater),
    deleter: serializeUserSummary(document.deleter),
    current_loan: serializeLoanSummary(availability.current_loan),
  };
}

function serializeDigitalDocumentSummary(req, document) {
  return serializeDocumentBase(req, document);
}

function serializeDigitalDocumentDetail(req, document) {
  const base = serializeDocumentBase(req, document);

  return {
    ...base,
    access_request_summary: {
      pending_count:
        document._count?.access_requests_pending ??
        document.access_requests_pending_count ??
        0,
    },
    loan_summary: {
      total_count: document._count?.loans ?? document.loan_count ?? 0,
      current: base.current_loan,
    },
  };
}

function hasActiveAccess(accessRequest) {
  if (!accessRequest || accessRequest.status !== "APPROVED") return false;
  if (!accessRequest.expires_at) return true;

  return new Date(accessRequest.expires_at) >= new Date();
}

function serializeDigitalDocumentAccessRequest(req, item) {
  return {
    id: item.id,
    status_key: item.status,
    status_label: ACCESS_STATUS_LABELS[item.status] || item.status,
    request_reason: item.request_reason,
    action_note: item.action_note,
    expires_at: item.expires_at,
    acted_at: item.acted_at,
    approved_at: item.approved_at,
    rejected_at: item.rejected_at,
    expired_at: item.expired_at,
    created_at: item.created_at,
    is_active_access: hasActiveAccess(item),
    can_view_document: hasActiveAccess(item),
    requester: serializeUserSummary(item.requester),
    owner: serializeUserSummary(item.owner),
    actor: serializeUserSummary(item.actor),
    document: item.document
      ? serializeDigitalDocumentSummary(req, item.document)
      : null,
  };
}

function serializeDigitalDocumentLoan(req, item) {
  const statusLabel = getLoanStatusLabel(item);

  return {
    id: item.id,
    status_key: item.status,
    status_label: statusLabel,
    status_pinjam_key: isLoanOverdue(item) ? "OVERDUE" : item.status,
    status_pinjam_label: statusLabel,
    request_reason: item.request_reason,
    requested_start_date: item.requested_start_date,
    requested_due_date: item.requested_due_date,
    tanggal_pinjam: item.requested_start_date,
    tanggal_penyerahan: item.handover_at,
    tanggal_estimasi_pengembalian: item.requested_due_date,
    tanggal_pengembalian: item.returned_at,
    approved_at: item.approved_at,
    rejected_at: item.rejected_at,
    handover_at: item.handover_at,
    returned_at: item.returned_at,
    approval_note: item.approval_note,
    rejection_note: item.rejection_note,
    handover_note: item.handover_note,
    return_note: item.return_note,
    created_at: item.created_at,
    is_overdue: isLoanOverdue(item),
    borrower: serializeUserSummary(item.borrower),
    approver: serializeUserSummary(item.approver),
    rejector: serializeUserSummary(item.rejector),
    handover_actor: serializeUserSummary(item.handover_actor),
    return_actor: serializeUserSummary(item.return_actor),
    document: item.document
      ? serializeDigitalDocumentSummary(req, item.document)
      : null,
  };
}

function serializeDigitalDocumentActivityLog(item) {
  return {
    id: item.id,
    action_key: item.action,
    action_label: ACTIVITY_ACTION_LABELS[item.action] || item.action,
    reference_type: item.reference_type,
    reference_id: item.reference_id,
    description: item.description,
    created_at: item.created_at,
    actor: serializeUserSummary(item.actor),
    document: item.document
      ? {
          id: item.document.id,
          document_number: item.document.document_number,
          document_name: item.document.document_name,
        }
      : null,
    from_storage: serializeStorageSummary(item.from_storage),
    to_storage: serializeStorageSummary(item.to_storage),
  };
}

module.exports = {
  getActivityActionLabel: (action) => ACTIVITY_ACTION_LABELS[action] || action,
  getAccessRequestStatusLabel: (status) =>
    ACCESS_STATUS_LABELS[status] || status,
  getLoanStatusLabel,
  hasActiveAccess,
  isLoanOverdue,
  serializeDigitalDocumentAccessRequest,
  serializeDigitalDocumentActivityLog,
  serializeDigitalDocumentDetail,
  serializeDigitalDocumentLoan,
  serializeDigitalDocumentSummary,
  serializeStorageSummary,
  serializeUserSummary,
};
