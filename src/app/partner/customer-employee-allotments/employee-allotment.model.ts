// Remaining units for one assortment (program). NOTE: per the DDL as given,
// TP_EMP_UNIT_BALANCES still keys on PROGRAM_ID — this predates (or wasn't
// updated for) the later TP_CUST_RULE_UNIT_QTY recat that rekeyed the
// rule-side table to PROG_CAT_ID. Flagged for confirmation; using
// programId here to match the literal DDL.
export interface EmployeeUnitBalance {
  programId: number;
  unitBalance: number;
}

// One row per employee, per rule, per cycle — the LIVE state checkout
// reads/decrements. dollarBalance/pointsBalance/unitBalance are the live
// remaining amounts already tracked server-side; usedAmount/adjustmentAmount
// are backend-aggregated from TP_EMP_ALLOTMENT_TRANSACTIONS (gross DEBITs,
// and net ADJUSTMENT/CREDIT respectively) — not re-derived client-side.
export interface EmployeeAllotmentBalance {
  balanceId: number;
  ruleId: number;
  cycleStart: string;
  cycleEnd: string;
  dollarBalance: number | null;
  pointsBalance: number | null;
  carryoverInDollar: number | null;
  carryoverInPoints: number | null;
  status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  usedAmount: number;
  adjustmentAmount: number;
  unitBalances: EmployeeUnitBalance[];
}

// A manually-entered adjustment against one rule's balance. `direction`
// disambiguates which way it moves the balance — the DDL notes an
// ADJUSTMENT transaction's amount is always a positive magnitude with the
// direction otherwise left to "context", so this is an explicit field the
// backend can map to whatever TXN_TYPE/sign convention it actually persists.
// programId/progCatId are only populated for a UNITS adjustment — unit
// balances are tracked per assortment (TP_EMP_UNIT_BALANCES.PROGRAM_ID), and
// progCatId is carried along as the rule-scope category the adjustment was
// made against, matching TP_EMP_ALLOTMENT_TRANSACTIONS' own PROGRAM_ID +
// PROG_CAT_ID columns for a UNITS-type entry.
export interface EmployeeAllotmentAdjustmentForm {
  direction: 'CREDIT' | 'DEBIT';
  amountType: 'DOLLARS' | 'POINTS' | 'UNITS';
  amount: number;
  reason: string;
  programId: number | null;
  progCatId: number | null;
}

// Append-only ledger entry. The "Adjustment history" display filters this
// down to ADJUSTMENT/CREDIT rows client-side — DEBIT/RENEWAL/CARRYOVER/EXPIRE
// are the normal system-driven lifecycle, not something to review as a log.
export interface EmployeeAllotmentTransaction {
  transactionId: number;
  createdTs: string;
  ruleId: number;
  txnType: 'DEBIT' | 'CREDIT' | 'ADJUSTMENT' | 'RENEWAL' | 'CARRYOVER' | 'EXPIRE';
  amountType: 'DOLLARS' | 'UNITS' | 'POINTS';
  // Signed, despite the DDL's "always a positive magnitude" note — the real
  // API returns a negative amount for a debit-direction entry and positive
  // for a credit-direction one, confirmed against actual responses. Credit
  // vs. debit is derived from this sign, not from txnType/a separate field.
  amount: number;
  reason: string | null;
  createdBy: string | null;
}
