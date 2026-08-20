const DEPOSIT_ACTION_ALIASES = Object.freeze({
  TITIPAN: "TITIPAN",
  PENERIMAAN: "TITIPAN",
  PEMBAYARAN: "PEMBAYARAN",
  BAYAR: "PEMBAYARAN",
  PAID: "PEMBAYARAN",
  PROSES: "PEMBAYARAN",
  PROCESS: "PEMBAYARAN",
  KOREKSI: "PEMBAYARAN",
  REFUND: "REFUND",
  PENGEMBALIAN: "REFUND",
});

const DEPOSIT_TRANSACTION_SOURCES = Object.freeze({
  LEGACY_MIGRATION: "LEGACY_MIGRATION",
  MANUAL_ENTRY: "MANUAL_ENTRY",
  OPENING_BALANCE: "OPENING_BALANCE",
  SYSTEM_IMPORT: "SYSTEM_IMPORT",
});

const LEDGER_FORMULA_CODE =
  "TOTAL_TITIPAN_MINUS_TOTAL_PEMBAYARAN_MINUS_TOTAL_REFUND";
const LEDGER_FORMULA_LABEL =
  "Saldo akhir = Total titipan - Total pembayaran - Total refund";
const MONEY_EPSILON = 0.000001;

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDepositAction(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return null;
  return DEPOSIT_ACTION_ALIASES[normalized] || normalized;
}

function normalizeDepositTransactionSource(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (Object.hasOwn(DEPOSIT_TRANSACTION_SOURCES, normalized)) {
    return normalized;
  }
  return DEPOSIT_TRANSACTION_SOURCES.MANUAL_ENTRY;
}

function emptyDepositLedgerTotals() {
  return {
    total_deposit_amount: 0,
    total_payment_amount: 0,
    total_refund_amount: 0,
    balance_amount: 0,
  };
}

function finalizeDepositLedgerTotals(totals) {
  return {
    ...totals,
    balance_amount: Math.max(
      totals.total_deposit_amount -
        totals.total_payment_amount -
        totals.total_refund_amount,
      0,
    ),
  };
}

function resolveDepositLedgerStatus(totals) {
  const hasActivity =
    totals.total_deposit_amount > 0 ||
    totals.total_payment_amount > 0 ||
    totals.total_refund_amount > 0;
  if (!hasActivity) return "PENDING";
  return totals.balance_amount > 0 ? "AKTIF" : "SELESAI";
}

function calculateDepositLedgerTotals(transactions = []) {
  const totals = emptyDepositLedgerTotals();
  for (const transaction of transactions) {
    const action = normalizeDepositAction(transaction.action);
    const amount = number(transaction.amount);
    if (action === "TITIPAN") totals.total_deposit_amount += amount;
    if (action === "PEMBAYARAN") totals.total_payment_amount += amount;
    if (action === "REFUND") totals.total_refund_amount += amount;
  }
  return finalizeDepositLedgerTotals(totals);
}

function calculateDepositLedgerFromGroups(groups = []) {
  const totals = emptyDepositLedgerTotals();
  for (const group of groups) {
    const action = normalizeDepositAction(group.action);
    const amount = number(group._sum?.amount ?? group.amount);
    if (action === "TITIPAN") totals.total_deposit_amount += amount;
    if (action === "PEMBAYARAN") totals.total_payment_amount += amount;
    if (action === "REFUND") totals.total_refund_amount += amount;
  }
  return finalizeDepositLedgerTotals(totals);
}

function storedDepositTotals(deposit) {
  return {
    total_deposit_amount: number(deposit.nominal),
    total_payment_amount: number(deposit.paid_amount),
    total_refund_amount: number(deposit.processed_amount),
    balance_amount: number(deposit.remaining_amount),
  };
}

function depositLedgerDifferences(stored, ledger) {
  return {
    total_deposit_amount:
      stored.total_deposit_amount - ledger.total_deposit_amount,
    total_payment_amount:
      stored.total_payment_amount - ledger.total_payment_amount,
    total_refund_amount:
      stored.total_refund_amount - ledger.total_refund_amount,
    balance_amount: stored.balance_amount - ledger.balance_amount,
  };
}

function hasDepositLedgerMismatch(differences) {
  return Object.values(differences).some(
    (difference) => Math.abs(number(difference)) > MONEY_EPSILON,
  );
}

function depositSourceSummary(groups = []) {
  const summaries = new Map();
  for (const group of groups) {
    const source = normalizeDepositTransactionSource(group.source);
    const current = summaries.get(source) || {
      source,
      transaction_count: 0,
      total_amount: 0,
    };
    current.transaction_count += number(group._count?._all ?? group.transaction_count);
    current.total_amount += number(group._sum?.amount ?? group.total_amount);
    summaries.set(source, current);
  }
  return Array.from(summaries.values()).sort((left, right) =>
    left.source.localeCompare(right.source),
  );
}

function buildDepositLedgerSnapshot(deposit, groups = [], visibleTransactionCount = 0) {
  const ledgerTotals = calculateDepositLedgerFromGroups(groups);
  const storedTotals = storedDepositTotals(deposit);
  const differences = depositLedgerDifferences(storedTotals, ledgerTotals);
  const mismatch = hasDepositLedgerMismatch(differences);
  const transactionCount = groups.reduce(
    (total, group) => total + number(group._count?._all ?? group.transaction_count),
    0,
  );

  return {
    status: resolveDepositLedgerStatus(ledgerTotals),
    ...ledgerTotals,
    ledger: {
      formula_code: LEDGER_FORMULA_CODE,
      formula_label: LEDGER_FORMULA_LABEL,
      status: resolveDepositLedgerStatus(ledgerTotals),
      ...ledgerTotals,
      transaction_count: transactionCount,
      visible_transaction_count: visibleTransactionCount,
      history_complete: visibleTransactionCount >= transactionCount,
      source_summary: depositSourceSummary(groups),
      reconciliation: {
        status: mismatch ? "MISMATCH" : "MATCHED",
        stored_totals: storedTotals,
        differences,
        message: mismatch
          ? "Agregat tersimpan tidak cocok dengan ledger transaksi. Angka ringkasan menggunakan ledger transaksi."
          : "Agregat tersimpan cocok dengan ledger transaksi.",
      },
    },
  };
}

function groupDepositLedgerRows(rows = []) {
  const byDeposit = new Map();
  for (const row of rows) {
    const current = byDeposit.get(row.deposit_id) || [];
    current.push(row);
    byDeposit.set(row.deposit_id, current);
  }
  return byDeposit;
}

function enrichDepositLedgerRecords(deposits = [], rows = []) {
  const byDeposit = groupDepositLedgerRows(rows);
  return deposits.map((deposit) => ({
    ...deposit,
    ...buildDepositLedgerSnapshot(
      deposit,
      byDeposit.get(deposit.id) || [],
      Array.isArray(deposit.transactions) ? deposit.transactions.length : 0,
    ),
  }));
}

module.exports = {
  DEPOSIT_TRANSACTION_SOURCES,
  LEDGER_FORMULA_CODE,
  LEDGER_FORMULA_LABEL,
  buildDepositLedgerSnapshot,
  calculateDepositLedgerFromGroups,
  calculateDepositLedgerTotals,
  enrichDepositLedgerRecords,
  groupDepositLedgerRows,
  hasDepositLedgerMismatch,
  normalizeDepositAction,
  normalizeDepositTransactionSource,
  number,
  resolveDepositLedgerStatus,
  storedDepositTotals,
};
