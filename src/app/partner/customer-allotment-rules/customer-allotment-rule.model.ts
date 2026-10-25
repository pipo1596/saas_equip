export interface CustomerAllotmentRule {
  ruleId: number;
  tpId: number;
  custId: number;
  roleId: number;
  ruleName: string;
  status: 'ACTIVE' | 'DRAFT';
  allotType: 'DOLLAR' | 'UNITS' | 'POINTS';
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
  // The rule's 2nd and 3rd priority fallback, in order — [] when none. Read
  // only here; set via *FALLBACK_SET (see RuleFallbackCard below), not sent
  // on *CREATE/*UPDATE. Approval and credit-card overage are no longer
  // rule-level — they moved to the role (requiresApproval/allowCcOverage).
  fallbacks: RuleFallbackSummary[];
  createdTs: string;
  createdBy: string | null;
  updatedTs: string;
  updatedBy: string | null;
}

export interface CustomerAllotmentRuleForm {
  ruleName: string;
  status: 'ACTIVE' | 'DRAFT';
  allotType: 'DOLLAR' | 'UNITS' | 'POINTS';
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
}

export interface CustomerAllotmentRulesPage {
  data: CustomerAllotmentRule[];
  pagination: { totalRows: number; page: number; pageSize: number };
}

// One row per category currently in a rule's scope (only meaningful when
// scopeAllAssortments === 'N'). Scope is category-level, not whole-program
// — a rule covers specific categories (e.g. "Outerwear") within an
// assortment, not the entire assortment. unitQty is populated only when
// allotType is UNITS.
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

// The lightweight shape embedded directly on a rule object's `fallbacks`
// array (*LIST/*LIST_ALL/*GET) — just enough to render the chain on a rule
// card. The richer shapes below (with allotType/scopeSummary) come only
// from the Allotment Fallback card's own *FALLBACK_GET/*FALLBACK_OPT calls.
export interface RuleFallbackSummary {
  seq: 2 | 3;
  ruleId: number;
  ruleName: string;
  status: 'ACTIVE' | 'DRAFT';
}

// One candidate (or current) fallback rule, as returned by *FALLBACK_GET's
// `data` and *FALLBACK_OPT's `data`.
export interface RuleFallbackOption {
  ruleId: number;
  ruleName: string;
  allotType: 'DOLLAR' | 'UNITS' | 'POINTS';
  status: 'ACTIVE' | 'DRAFT';
  scopeSummary: string;
}

// *FALLBACK_GET's current-chain entries carry their own seq (2 or 3);
// *FALLBACK_OPT's candidate list does not.
export interface RuleFallbackChainEntry extends RuleFallbackOption {
  seq: 2 | 3;
}

// *FALLBACK_GET's `usedBy` — other rules that name THIS rule as their own
// fallback. Delete-confirmation data only; never shown on the card itself.
export interface RuleFallbackUsedByEntry {
  ruleId: number;
  ruleName: string;
  seq: 2 | 3;
}

export interface RuleFallbackCard {
  ruleId: number;
  ruleName: string;
  allotType: 'DOLLAR' | 'UNITS' | 'POINTS';
  // 'N' for UNITS rules — fallback isn't available for unit allotments.
  fallbackAvailable: 'Y' | 'N';
  data: RuleFallbackChainEntry[];
  usedBy: RuleFallbackUsedByEntry[];
}

export interface RuleFallbackOptionsResponse {
  ruleId: number;
  allotType: 'DOLLAR' | 'UNITS' | 'POINTS';
  fallbackAvailable: 'Y' | 'N';
  data: RuleFallbackOption[];
}
