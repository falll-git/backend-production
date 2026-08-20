const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDepositLedgerSnapshot,
  calculateDepositLedgerTotals,
  enrichDepositLedgerRecords,
  normalizeDepositAction,
} = require("./deposit-ledger");

test("normalizes historical deposit transaction aliases", () => {
  assert.equal(normalizeDepositAction("penerimaan"), "TITIPAN");
  assert.equal(normalizeDepositAction("bayar"), "PEMBAYARAN");
  assert.equal(normalizeDepositAction("pengembalian"), "REFUND");
});

test("calculates the deposit balance exclusively from transactions", () => {
  assert.deepEqual(
    calculateDepositLedgerTotals([
      { action: "TITIPAN", amount: 10_000_000 },
      { action: "PEMBAYARAN", amount: 2_000_000 },
      { action: "REFUND", amount: 1_000_000 },
    ]),
    {
      total_deposit_amount: 10_000_000,
      total_payment_amount: 2_000_000,
      total_refund_amount: 1_000_000,
      balance_amount: 7_000_000,
    },
  );
});

test("reports a mismatch without inventing missing transactions", () => {
  const snapshot = buildDepositLedgerSnapshot(
    {
      nominal: 10_000_000,
      paid_amount: 5_000_000,
      processed_amount: 5_000_000,
      remaining_amount: 5_000_000,
    },
    [
      {
        action: "TITIPAN",
        source: "SYSTEM_IMPORT",
        _sum: { amount: 10_000_000 },
        _count: { _all: 1 },
      },
    ],
    1,
  );

  assert.equal(snapshot.total_deposit_amount, 10_000_000);
  assert.equal(snapshot.total_payment_amount, 0);
  assert.equal(snapshot.total_refund_amount, 0);
  assert.equal(snapshot.balance_amount, 10_000_000);
  assert.equal(snapshot.status, "AKTIF");
  assert.equal(snapshot.ledger.reconciliation.status, "MISMATCH");
  assert.equal(snapshot.ledger.transaction_count, 1);
  assert.equal(snapshot.ledger.history_complete, true);
  assert.deepEqual(snapshot.ledger.source_summary, [
    {
      source: "SYSTEM_IMPORT",
      transaction_count: 1,
      total_amount: 10_000_000,
    },
  ]);
});

test("marks matching stored aggregates as reconciled", () => {
  const [deposit] = enrichDepositLedgerRecords(
    [
      {
        id: "deposit-1",
        nominal: 1_000,
        paid_amount: 250,
        processed_amount: 100,
        remaining_amount: 650,
        transactions: [{ id: "visible-1" }],
      },
    ],
    [
      {
        deposit_id: "deposit-1",
        action: "TITIPAN",
        source: "OPENING_BALANCE",
        _sum: { amount: 1_000 },
        _count: { _all: 1 },
      },
      {
        deposit_id: "deposit-1",
        action: "PEMBAYARAN",
        source: "MANUAL_ENTRY",
        _sum: { amount: 250 },
        _count: { _all: 1 },
      },
      {
        deposit_id: "deposit-1",
        action: "REFUND",
        source: "MANUAL_ENTRY",
        _sum: { amount: 100 },
        _count: { _all: 1 },
      },
    ],
  );

  assert.equal(deposit.ledger.reconciliation.status, "MATCHED");
  assert.equal(deposit.status, "AKTIF");
  assert.equal(deposit.ledger.transaction_count, 3);
  assert.equal(deposit.ledger.history_complete, false);
});
