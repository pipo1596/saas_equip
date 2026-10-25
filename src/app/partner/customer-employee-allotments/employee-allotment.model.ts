// Remaining units for one assortment grant — one entry per rule unit grant
// (progCatId), not one per program. A rule's category-level scope can place
// several grants under the same program, and each now carries its own
// balance.
export interface EmployeeUnitBalance {
  programId: number;
  programName: string;
  progCatId: number;
  categoryName: string;
  grantedUnits: number;
  usedUnits: number;
  adjustmentUnits: number;
  unitBalance: number;
  pendingUnits: number;
  availableUnits: number;
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
// progCatId is required for a UNITS adjustment — unit balances are tracked
// per assortment grant, not per program. programId is optional there (the
// backend derives it from progCatId) and ignored for DOLLARS/POINTS.
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
  // Only populated for a UNITS-type entry — the rule-scope category this
  // transaction was recorded against (mirrors TP_EMP_ALLOTMENT_TRANSACTIONS'
  // own PROG_CAT_ID column for that case). Null on a DOLLARS/POINTS row, and
  // also null on a UNITS row written before per-assortment tracking — those
  // legacy rows display as "All assortments" rather than a resolved name.
  progCatId: number | null;
  // The category's own name (not the full breadcrumb) — null wherever
  // progCatId is null, for the same two reasons.
  categoryName: string | null;
  // Whether this draw (or a credit refunding one) spilled over onto a
  // fallback rule rather than the one it's filed under (`ruleId`) having
  // covered it directly. fallbackForRuleId/Name name the original rule the
  // item was scoped to — null when isFallback is 'N'.
  isFallback: 'Y' | 'N';
  fallbackForRuleId: number | null;
  fallbackForRuleName: string | null;
  reason: string | null;
  createdBy: string | null;
}
