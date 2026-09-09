import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerEmployeesService } from '../customer-employees/customer-employees.service';
import { CustomerEmployee } from '../customer-employees/customer-employee.model';
import { CustomerAllotmentRulesService } from '../customer-allotment-rules/customer-allotment-rules.service';
import {
  CustomerAllotmentRule, RuleAssortmentScope, RuleLedgerSlot, RuleQuotaLimit,
} from '../customer-allotment-rules/customer-allotment-rule.model';
import { EmployeeAllotmentsService } from './employee-allotments.service';
import { EmployeeAllotmentAdjustmentForm, EmployeeAllotmentBalance, EmployeeAllotmentTransaction } from './employee-allotment.model';

const BLANK_ADJUST_FORM: EmployeeAllotmentAdjustmentForm = {
  direction: 'CREDIT', amountType: 'DOLLARS', amount: 0, reason: '', programId: null, progCatId: null,
};

@Component({
  selector: 'app-customer-employee-allotment',
  standalone: true,
  imports: [RouterModule, FormsModule],
  templateUrl: './customer-employee-allotment.component.html',
})
export class CustomerEmployeeAllotmentComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly employeesService = inject(CustomerEmployeesService);
  private readonly rulesService = inject(CustomerAllotmentRulesService);
  private readonly allotmentsService = inject(EmployeeAllotmentsService);
  private readonly route = inject(ActivatedRoute);

  readonly employee = signal<CustomerEmployee | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly rules = signal<CustomerAllotmentRule[]>([]);
  readonly balances = signal<EmployeeAllotmentBalance[]>([]);
  readonly transactions = signal<EmployeeAllotmentTransaction[]>([]);

  // Unit-type rules need their scope's unitQty totals loaded up front (not
  // lazily) since the collapsed row's "X of Y units" line depends on it.
  readonly ruleScopes = signal<Record<number, RuleAssortmentScope[]>>({});

  // Ledger chain / quota limits are only shown once a row is expanded, so
  // they're fetched lazily and cached per ruleId — same pattern as the
  // Role Detail page's rule cards.
  readonly expandedRuleIds = signal<Set<number>>(new Set());
  readonly expandedLoading = signal<Set<number>>(new Set());
  readonly ruleLedgerChains = signal<Record<number, RuleLedgerSlot[]>>({});
  readonly ruleQuotas = signal<Record<number, RuleQuotaLimit[]>>({});

  // ── Manual adjustment modal ──────────────────────────────────────────────
  readonly showAdjustModal = signal(false);
  readonly adjustTarget = signal<CustomerAllotmentRule | null>(null);
  readonly adjustSaving = signal(false);
  readonly adjustError = signal<string | null>(null);
  readonly adjustSubmitted = signal(false);
  adjustForm: EmployeeAllotmentAdjustmentForm = { ...BLANK_ADJUST_FORM };

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get customerId(): number | null {
    const p = this.route.snapshot.paramMap.get('customerId');
    return p ? Number(p) : null;
  }

  protected get employeeId(): number | null {
    const p = this.route.snapshot.paramMap.get('employeeId');
    return p ? Number(p) : null;
  }

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const empId = this.employeeId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);
    if (!tpId || !custId || empId == null) return;

    this.loading.set(true);
    this.loadError.set(null);
    try {
      const state = window.history.state as { employee?: CustomerEmployee };
      const employee = (state.employee && state.employee.empId === empId)
        ? state.employee
        : await this.employeesService.get(tpId, custId, empId);
      this.employee.set(employee);

      const roleId = employee.roleId;
      if (roleId == null) return;

      const [rules, balances, transactions] = await Promise.all([
        this.rulesService.listAll(tpId, custId, roleId),
        this.allotmentsService.listBalances(tpId, custId, empId),
        this.allotmentsService.listTransactions(tpId, custId, empId),
      ]);
      this.rules.set(rules);
      this.balances.set(balances);
      this.transactions.set(transactions);

      const unitRules = rules.filter(r => r.allotType === 'UNITS' || r.allotType === 'DOLLAR_UNITS');
      await this.loadScopesFor(unitRules, roleId);
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load allotment summary.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadScopesFor(rules: CustomerAllotmentRule[], roleId: number): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId || rules.length === 0) return;
    const entries = await Promise.all(rules.map(async r => {
      try {
        return [r.ruleId, await this.rulesService.getScope(tpId, custId, roleId, r.ruleId)] as const;
      } catch {
        return [r.ruleId, [] as RuleAssortmentScope[]] as const;
      }
    }));
    const map = { ...this.ruleScopes() };
    entries.forEach(([id, scope]) => { map[id] = scope; });
    this.ruleScopes.set(map);
  }

  // ── Rule / balance matching ──────────────────────────────────────────────

  // DRAFT rules aren't live entitlements yet — only ACTIVE ones are shown.
  // `rules()` itself stays unfiltered so ruleNameFor() can still resolve a
  // name for a DRAFT (or since-changed) rule referenced by an old transaction.
  get activeRules(): CustomerAllotmentRule[] {
    return this.rules().filter(r => r.status === 'ACTIVE');
  }

  balanceFor(ruleId: number): EmployeeAllotmentBalance | null {
    return this.balances().find(b => b.ruleId === ruleId) ?? null;
  }

  allotTypeLabel(type: string): string {
    switch (type) {
      case 'DOLLAR': return 'Dollar';
      case 'UNITS': return 'Units';
      case 'DOLLAR_UNITS': return 'Dollar + Units';
      case 'POINTS': return 'Points';
      default: return type;
    }
  }

  private unitsRemaining(balance: EmployeeAllotmentBalance | null): number {
    return (balance?.unitBalances ?? []).reduce((sum, u) => sum + u.unitBalance, 0);
  }

  private unitsTotal(ruleId: number): number {
    return (this.ruleScopes()[ruleId] ?? []).reduce((sum, s) => sum + (s.unitQty ?? 0), 0);
  }

  hasUnits(rule: CustomerAllotmentRule): boolean {
    return rule.allotType === 'UNITS' || rule.allotType === 'DOLLAR_UNITS';
  }

  unitsLine(rule: CustomerAllotmentRule): string {
    const balance = this.balanceFor(rule.ruleId);
    const remaining = this.unitsRemaining(balance);
    const total = this.unitsTotal(rule.ruleId);
    return `${remaining} of ${total} unit${total === 1 ? '' : 's'}`;
  }

  // Primary remaining/total pair driving the progress bar — dollars for
  // DOLLAR/DOLLAR_UNITS, points for POINTS, unit count for plain UNITS.
  primaryRemaining(rule: CustomerAllotmentRule): number {
    const balance = this.balanceFor(rule.ruleId);
    if (rule.allotType === 'POINTS') return balance?.pointsBalance ?? 0;
    if (rule.allotType === 'UNITS') return this.unitsRemaining(balance);
    return balance?.dollarBalance ?? 0;
  }

  primaryTotal(rule: CustomerAllotmentRule): number {
    if (rule.allotType === 'POINTS') return rule.pointsAmount ?? 0;
    if (rule.allotType === 'UNITS') return this.unitsTotal(rule.ruleId);
    return rule.dollarAmount ?? 0;
  }

  primaryLabel(rule: CustomerAllotmentRule): string {
    const remaining = this.primaryRemaining(rule);
    const total = this.primaryTotal(rule);
    if (rule.allotType === 'POINTS') return `${remaining} of ${total} pts`;
    if (rule.allotType === 'UNITS') return `${remaining} of ${total} unit${total === 1 ? '' : 's'}`;
    return `$${remaining.toFixed(2)} / $${total.toFixed(2)}`;
  }

  hasBalance(rule: CustomerAllotmentRule): boolean {
    return this.balanceFor(rule.ruleId) != null;
  }

  // The rule's own entitlement amount — always known from the rule
  // definition, independent of whether a live balance row exists yet.
  totalAmountLabel(rule: CustomerAllotmentRule): string {
    const total = this.primaryTotal(rule);
    if (rule.allotType === 'POINTS') return `${total} pts`;
    if (rule.allotType === 'UNITS') return `${total} unit${total === 1 ? '' : 's'}`;
    return `$${total.toFixed(2)}`;
  }

  progressPct(rule: CustomerAllotmentRule): number {
    const total = this.primaryTotal(rule);
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, (this.primaryRemaining(rule) / total) * 100));
  }

  amountUnitSuffix(rule: CustomerAllotmentRule): string {
    if (rule.allotType === 'POINTS') return ' pts';
    if (rule.allotType === 'UNITS') return '';
    return '';
  }

  usedLabel(rule: CustomerAllotmentRule): string {
    const balance = this.balanceFor(rule.ruleId);
    if (!balance) return '—';
    return rule.allotType === 'POINTS' ? `${balance.usedAmount} pts` : `$${balance.usedAmount.toFixed(2)}`;
  }

  adjustmentLabel(rule: CustomerAllotmentRule): string {
    const balance = this.balanceFor(rule.ruleId);
    if (!balance) return '—';
    const amt = balance.adjustmentAmount;
    const sign = amt > 0 ? '+' : amt < 0 ? '-' : '';
    const abs = Math.abs(amt);
    return rule.allotType === 'POINTS' ? `${sign}${abs} pts` : `${sign}$${abs.toFixed(2)}`;
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  }

  // The rule's own configured cycle, projected forward one period from its
  // start date — used as a fallback for Renews/Expires whenever there's no
  // live balance row yet (e.g. the balances endpoint isn't wired up, or the
  // employee hasn't had a cycle processed). Only meaningful for FIXED-basis
  // rules; HIRE/HIREDAYS/LASTORDER are per-employee and can't be computed
  // without that employee's own hire/order history.
  private fallbackCycleEnd(rule: CustomerAllotmentRule): Date | null {
    if (rule.renewalBasis !== 'FIXED' || !rule.cycleStartDate) return null;
    const d = new Date(`${rule.cycleStartDate}T00:00:00`);
    if (isNaN(d.getTime())) return null;
    d.setMonth(d.getMonth() + rule.renewalPeriodMonths);
    d.setDate(d.getDate() - 1);
    return d;
  }

  renewsLabel(rule: CustomerAllotmentRule): string {
    const balance = this.balanceFor(rule.ruleId);
    if (balance?.cycleEnd) {
      const d = new Date(`${balance.cycleEnd}T00:00:00`);
      if (isNaN(d.getTime())) return '—';
      d.setDate(d.getDate() + 1);
      return this.formatDate(d.toISOString().slice(0, 10));
    }
    const fallbackEnd = this.fallbackCycleEnd(rule);
    if (!fallbackEnd) return rule.renewalBasis === 'FIXED' ? '—' : 'Per employee';
    fallbackEnd.setDate(fallbackEnd.getDate() + 1);
    return this.formatDate(fallbackEnd.toISOString().slice(0, 10));
  }

  expiresLabel(rule: CustomerAllotmentRule): string {
    const balance = this.balanceFor(rule.ruleId);
    if (balance?.cycleEnd) return this.formatDate(balance.cycleEnd);
    const fallbackEnd = this.fallbackCycleEnd(rule);
    if (!fallbackEnd) return rule.renewalBasis === 'FIXED' ? '—' : 'Per employee';
    return this.formatDate(fallbackEnd.toISOString().slice(0, 10));
  }

  scopeNamesLabel(ruleId: number): string {
    const scope = this.ruleScopes()[ruleId] ?? [];
    if (scope.length === 0) return 'No categories';
    if (scope.length === 1) return scope[0].categoryName;
    return `${scope[0].categoryName} +${scope.length - 1} more`;
  }

  ruleSubtitle(rule: CustomerAllotmentRule): string {
    const scopeLabel = rule.scopeAllAssortments === 'Y' ? 'All assortments' : this.scopeNamesLabel(rule.ruleId);
    return `${scopeLabel} · renews every ${rule.renewalPeriodMonths} months`;
  }

  carryoverLabel(rule: CustomerAllotmentRule): string {
    switch (rule.carryoverType) {
      case 'FORFEIT': return 'Forfeit unused';
      case 'FULL': return 'Full carryover';
      case 'PARTIAL': return `Partial carryover (${rule.carryoverPct ?? 0}%)`;
      default: return rule.carryoverType;
    }
  }

  renewalBasisLabel(rule: CustomerAllotmentRule): string {
    switch (rule.renewalBasis) {
      case 'FIXED': return 'Fixed date';
      case 'HIRE': return 'Hire date anniversary';
      case 'HIREDAYS': return `Hire date + ${rule.hireDaysOffset ?? 0}d`;
      case 'LASTORDER': return 'Last order date';
      default: return rule.renewalBasis;
    }
  }

  // ── Manual adjustment ────────────────────────────────────────────────────

  allowsDollarAdjustment(rule: CustomerAllotmentRule): boolean {
    return rule.allotType === 'DOLLAR' || rule.allotType === 'DOLLAR_UNITS';
  }

  allowsUnitAdjustment(rule: CustomerAllotmentRule): boolean {
    return rule.allotType === 'UNITS' || rule.allotType === 'DOLLAR_UNITS';
  }

  openAdjustModal(rule: CustomerAllotmentRule): void {
    this.adjustTarget.set(rule);
    const amountType = rule.allotType === 'POINTS' ? 'POINTS' : rule.allotType === 'UNITS' ? 'UNITS' : 'DOLLARS';
    this.adjustForm = { ...BLANK_ADJUST_FORM, amountType };
    if (amountType === 'UNITS') this.onAdjustCategoryChange(this.scopeFor(rule.ruleId)[0]?.progCatId ?? null);
    this.adjustError.set(null);
    this.adjustSubmitted.set(false);
    this.showAdjustModal.set(true);
  }

  closeAdjustModal(): void {
    this.showAdjustModal.set(false);
    this.adjustTarget.set(null);
  }

  onAdjustAmountTypeChange(): void {
    if (this.adjustForm.amountType === 'UNITS') {
      const rule = this.adjustTarget();
      const first = rule ? this.scopeFor(rule.ruleId)[0] : null;
      this.onAdjustCategoryChange(first?.progCatId ?? null);
    } else {
      this.adjustForm.progCatId = null;
      this.adjustForm.programId = null;
    }
  }

  onAdjustCategoryChange(progCatId: number | null): void {
    this.adjustForm.progCatId = progCatId;
    const rule = this.adjustTarget();
    const scope = rule ? this.scopeFor(rule.ruleId).find(s => s.progCatId === progCatId) : undefined;
    this.adjustForm.programId = scope?.programId ?? null;
  }

  async saveAdjustment(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const empId = this.employeeId;
    const rule = this.adjustTarget();
    if (!tpId || !custId || empId == null || !rule) return;

    this.adjustSubmitted.set(true);
    if (!this.adjustForm.amount || this.adjustForm.amount <= 0 || !this.adjustForm.reason.trim()) return;
    if (this.adjustForm.amountType === 'UNITS' && this.adjustForm.progCatId == null) return;

    this.adjustSaving.set(true);
    this.adjustError.set(null);
    try {
      await this.allotmentsService.createAdjustment(tpId, custId, empId, rule.ruleId, this.adjustForm);
      this.showAdjustModal.set(false);
      this.adjustTarget.set(null);
      const [balances, transactions] = await Promise.all([
        this.allotmentsService.listBalances(tpId, custId, empId),
        this.allotmentsService.listTransactions(tpId, custId, empId),
      ]);
      this.balances.set(balances);
      this.transactions.set(transactions);
    } catch (err) {
      this.adjustError.set(err instanceof Error ? err.message : 'Failed to save adjustment.');
    } finally {
      this.adjustSaving.set(false);
    }
  }

  // ── Expand / lazy load ───────────────────────────────────────────────────

  toggleExpand(ruleId: number): void {
    const expanded = new Set(this.expandedRuleIds());
    if (expanded.has(ruleId)) {
      expanded.delete(ruleId);
      this.expandedRuleIds.set(expanded);
      return;
    }
    expanded.add(ruleId);
    this.expandedRuleIds.set(expanded);
    if (!this.ruleScopes()[ruleId] || !this.ruleLedgerChains()[ruleId] || !this.ruleQuotas()[ruleId]) {
      this.loadExpandedData(ruleId);
    }
  }

  private async loadExpandedData(ruleId: number): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.employee()?.roleId;
    if (!tpId || !custId || roleId == null) return;
    this.expandedLoading.update(s => new Set(s).add(ruleId));
    try {
      const [scope, chain, quotas] = await Promise.all([
        this.ruleScopes()[ruleId] ? Promise.resolve(this.ruleScopes()[ruleId]) : this.rulesService.getScope(tpId, custId, roleId, ruleId),
        this.rulesService.getLedgerChain(tpId, custId, roleId, ruleId),
        this.rulesService.listQuotas(tpId, custId, roleId, ruleId),
      ]);
      this.ruleScopes.update(m => ({ ...m, [ruleId]: scope }));
      this.ruleLedgerChains.update(m => ({ ...m, [ruleId]: chain }));
      this.ruleQuotas.update(m => ({ ...m, [ruleId]: quotas }));
    } catch {
      // Leave whatever loaded — sections simply render empty.
    } finally {
      this.expandedLoading.update(s => {
        const next = new Set(s);
        next.delete(ruleId);
        return next;
      });
    }
  }

  scopeFor(ruleId: number): RuleAssortmentScope[] {
    return this.ruleScopes()[ruleId] ?? [];
  }

  ledgerAt(ruleId: number, precedence: number): RuleLedgerSlot | null {
    return (this.ruleLedgerChains()[ruleId] ?? []).find(s => s.precedence === precedence) ?? null;
  }

  quotasFor(ruleId: number): RuleQuotaLimit[] {
    return this.ruleQuotas()[ruleId] ?? [];
  }

  // ── Adjustment history ───────────────────────────────────────────────────

  get adjustmentHistory(): EmployeeAllotmentTransaction[] {
    return this.transactions()
      .filter(t => t.txnType === 'ADJUSTMENT' || t.txnType === 'CREDIT')
      .sort((a, b) => b.createdTs.localeCompare(a.createdTs));
  }

  ruleNameFor(ruleId: number): string {
    return this.rules().find(r => r.ruleId === ruleId)?.ruleName ?? `Rule #${ruleId}`;
  }

  // The API returns a signed amount (negative = debit, positive = credit)
  // despite the DDL's "always a positive magnitude" note — confirmed
  // against real responses. Direction is derived purely from that sign.
  private effectiveDirection(txn: EmployeeAllotmentTransaction): 'CREDIT' | 'DEBIT' {
    return txn.amount < 0 ? 'DEBIT' : 'CREDIT';
  }

  transactionAmountLabel(txn: EmployeeAllotmentTransaction): string {
    const suffix = txn.amountType === 'POINTS' ? ' pts' : txn.amountType === 'UNITS' ? '' : '';
    const prefix = txn.amountType === 'DOLLARS' ? '$' : '';
    const sign = this.effectiveDirection(txn) === 'CREDIT' ? '+' : '-';
    const abs = Math.abs(txn.amount);
    return `${sign}${prefix}${abs.toFixed(txn.amountType === 'DOLLARS' ? 2 : 0)}${suffix}`;
  }

  transactionTypeBadge(txn: EmployeeAllotmentTransaction): string {
    return this.effectiveDirection(txn) === 'CREDIT'
      ? 'badge bg-success-subtle text-success border border-success-subtle'
      : 'badge bg-danger-subtle text-danger border border-danger-subtle';
  }

  transactionTypeLabel(txn: EmployeeAllotmentTransaction): string {
    const isCredit = this.effectiveDirection(txn) === 'CREDIT';
    if (txn.txnType === 'ADJUSTMENT') return isCredit ? 'Adjustment (Credit)' : 'Adjustment (Debit)';
    return isCredit ? 'Credit' : 'Debit';
  }
}
