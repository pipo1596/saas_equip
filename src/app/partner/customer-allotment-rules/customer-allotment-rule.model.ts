export interface CustomerAllotmentRule {
  ruleId: number;
  tpId: number;
  custId: number;
  roleId: number;
  ruleName: string;
  status: 'ACTIVE' | 'DRAFT';
  allotType: 'DOLLAR' | 'UNITS' | 'DOLLAR_UNITS' | 'POINTS';
  dollarAmount: number | null;
  pointsAmount: number | null;
  scopeAllAssortments: 'Y' | 'N';
  renewalBasis: 'FIXED' | 'HIRE' | 'HIREDAYS' | 'LASTORDER';
  renewalPeriodMonths: 6 | 12 | 24 | 36;
  renewalTime: string;
  hireDaysOffset: number | null;
  cycleStartDate: string | null;
  expirationDate: string | null;
  onExpirationAction: 'SUSPEND' | 'CC_ONLY' | 'AUTO_RENEW';
  carryoverType: 'FORFEIT' | 'PARTIAL' | 'FULL';
  carryoverPct: number | null;
  autoCreateNewEmp: 'Y' | 'N';
  prorateMidCycle: 'Y' | 'N';
  notifyNewCycle: 'Y' | 'N';
  notifyLowBalance: 'Y' | 'N';
  notifyCarryover: 'Y' | 'N';
  requireApproval: 'Y' | 'N';
  allowCcFallback: 'Y' | 'N';
  createdTs: string;
  createdBy: string | null;
  updatedTs: string;
  updatedBy: string | null;
}

export interface CustomerAllotmentRuleForm {
  ruleName: string;
  status: 'ACTIVE' | 'DRAFT';
  allotType: 'DOLLAR' | 'UNITS' | 'DOLLAR_UNITS' | 'POINTS';
  dollarAmount: number | null;
  pointsAmount: number | null;
  scopeAllAssortments: 'Y' | 'N';
  renewalBasis: 'FIXED' | 'HIRE' | 'HIREDAYS' | 'LASTORDER';
  renewalPeriodMonths: 6 | 12 | 24 | 36;
  renewalTime: string;
  hireDaysOffset: number | null;
  cycleStartDate: string | null;
  expirationDate: string | null;
  onExpirationAction: 'SUSPEND' | 'CC_ONLY' | 'AUTO_RENEW';
  carryoverType: 'FORFEIT' | 'PARTIAL' | 'FULL';
  carryoverPct: number | null;
  autoCreateNewEmp: 'Y' | 'N';
  prorateMidCycle: 'Y' | 'N';
  notifyNewCycle: 'Y' | 'N';
  notifyLowBalance: 'Y' | 'N';
  notifyCarryover: 'Y' | 'N';
  requireApproval: 'Y' | 'N';
  allowCcFallback: 'Y' | 'N';
}

export interface CustomerAllotmentRulesPage {
  data: CustomerAllotmentRule[];
  pagination: { totalRows: number; page: number; pageSize: number };
}

// One row per category currently in a rule's scope (only meaningful when
// scopeAllAssortments === 'N'). Scope is category-level, not whole-program
// — a rule covers specific categories (e.g. "Outerwear") within an
// assortment, not the entire assortment. unitQty is populated only when
// allotType is UNITS or DOLLAR_UNITS.
export interface RuleAssortmentScope {
  progCatId: number;
  categoryName: string;
  programId: number;
  programName: string;
  unitQty: number | null;
}

export interface RuleQuotaLimit {
  quotaId: number;
  ruleId: number;
  programId: number;
  programName: string;
  progCatId: number | null; // null = "All categories" in that program
  categoryName: string | null;
  limitType: 'UNITS' | 'DOLLARS' | 'POINTS';
  limitValue: number;
  renewalPeriodMonths: 6 | 12 | 24 | 36;
}

export interface RuleQuotaLimitForm {
  programId: number;
  progCatId: number | null;
  limitType: 'UNITS' | 'DOLLARS' | 'POINTS';
  limitValue: number;
  renewalPeriodMonths: 6 | 12 | 24 | 36;
}

// Only filled slots are returned/sent — an omitted precedence means the
// slot is empty, never a null ledgerId.
export interface RuleLedgerSlot {
  precedence: 1 | 2 | 3;
  ledgerId: number;
  ledgerName: string;
  ledgerType: 'DOLLAR' | 'POINTS' | 'CREDIT_CARD';
}
