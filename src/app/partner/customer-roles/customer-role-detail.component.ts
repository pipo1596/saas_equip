import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerRolesService } from './customer-roles.service';
import { CustomerRole, CustomerRoleForm } from './customer-role.model';
import { CustomerAllotmentRulesService } from '../customer-allotment-rules/customer-allotment-rules.service';
import { CustomerAllotmentRule, RuleAssortmentScope, RuleLedgerSlot } from '../customer-allotment-rules/customer-allotment-rule.model';
import { CustomerPaymentLedgersService } from '../customer-payment-ledgers/customer-payment-ledgers.service';
import { CustomerPaymentLedger, CustomerPaymentLedgerForm } from '../customer-payment-ledgers/customer-payment-ledger.model';

type RoleDetailTab = 'rules' | 'ledgers' | 'permissions';

interface LedgerForm {
  ledgerName: string;
  ledgerType: 'DOLLAR' | 'POINTS' | 'CREDIT_CARD';
  amount: number | null;
  status: 'ACTIVE' | 'INACTIVE';
}

const BLANK_LEDGER_FORM: LedgerForm = { ledgerName: '', ledgerType: 'DOLLAR', amount: null, status: 'ACTIVE' };

@Component({
  selector: 'app-customer-role-detail',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './customer-role-detail.component.html',
})
export class CustomerRoleDetailComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly rolesService = inject(CustomerRolesService);
  private readonly rulesService = inject(CustomerAllotmentRulesService);
  private readonly ledgersService = inject(CustomerPaymentLedgersService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly role = signal<CustomerRole | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly activeTab = signal<RoleDetailTab>('rules');

  // ── Allotment Rules tab ─────────────────────────────────────────────────
  readonly rules = signal<CustomerAllotmentRule[]>([]);
  readonly rulesLoading = signal(false);
  readonly rulesError = signal<string | null>(null);
  readonly showDeleteRuleModal = signal(false);
  readonly deleteRuleTarget = signal<CustomerAllotmentRule | null>(null);
  readonly deletingRule = signal(false);
  readonly roleEmployeeCount = signal(0);
  readonly ruleScopes = signal<Record<number, RuleAssortmentScope[]>>({});
  readonly expandedRuleIds = signal<Set<number>>(new Set());
  readonly ruleLedgerChains = signal<Record<number, RuleLedgerSlot[]>>({});
  readonly ruleLedgerChainsLoading = signal<Set<number>>(new Set());

  // ── Payment Ledgers tab ──────────────────────────────────────────────────
  readonly ledgers = signal<CustomerPaymentLedger[]>([]);
  readonly ledgersLoading = signal(false);
  readonly ledgersError = signal<string | null>(null);
  readonly showLedgerFormModal = signal(false);
  readonly editingLedgerId = signal<number | null>(null);
  readonly ledgerSaving = signal(false);
  readonly ledgerSaveError = signal<string | null>(null);
  readonly ledgerSubmitted = signal(false);
  readonly showDeleteLedgerModal = signal(false);
  readonly deleteLedgerTarget = signal<CustomerPaymentLedger | null>(null);
  readonly deletingLedger = signal(false);
  ledgerForm: LedgerForm = { ...BLANK_LEDGER_FORM };

  // ── Permissions tab ──────────────────────────────────────────────────────
  readonly permSaving = signal(false);
  readonly permSaveError = signal<string | null>(null);
  readonly permSaved = signal(false);
  permForm: { canOrderSelf: 'Y' | 'N'; canApprove: 'Y' | 'N'; canShopForOthers: 'Y' | 'N'; canManageTeamBalances: 'Y' | 'N' } = {
    canOrderSelf: 'Y', canApprove: 'N', canShopForOthers: 'N', canManageTeamBalances: 'N',
  };

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get customerId(): number | null {
    const p = this.route.snapshot.paramMap.get('customerId');
    return p ? Number(p) : null;
  }

  protected get roleId(): number | null {
    const p = this.route.snapshot.paramMap.get('roleId');
    return p ? Number(p) : null;
  }

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);
    if (roleId == null) return;

    const state = window.history.state as { role?: CustomerRole };
    if (state.role && state.role.roleId === roleId) {
      this.applyRole(state.role);
    } else {
      await this.fetchRole(roleId);
    }
    this.setTab('rules');
  }

  private applyRole(role: CustomerRole): void {
    this.role.set(role);
    this.permForm = {
      canOrderSelf: role.canOrderSelf, canApprove: role.canApprove,
      canShopForOthers: role.canShopForOthers, canManageTeamBalances: role.canManageTeamBalances,
    };
  }

  private async fetchRole(roleId: number): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.applyRole(await this.rolesService.get(tpId, custId, roleId));
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load role.');
    } finally {
      this.loading.set(false);
    }
  }

  setTab(tab: RoleDetailTab): void {
    this.activeTab.set(tab);
    if (tab === 'rules' && this.rules().length === 0) this.loadRules();
    if (tab === 'ledgers' && this.ledgers().length === 0) this.loadLedgers();
  }

  // ── Allotment Rules tab ─────────────────────────────────────────────────

  async loadRules(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (!tpId || !custId || roleId == null) return;
    this.rulesLoading.set(true);
    this.rulesError.set(null);
    try {
      this.rules.set(await this.rulesService.listAll(tpId, custId, roleId));
      await Promise.all([this.loadRuleScopes(), this.loadRoleEmployeeCount()]);
    } catch (err) {
      this.rulesError.set(err instanceof Error ? err.message : 'Failed to load allotment rules.');
    } finally {
      this.rulesLoading.set(false);
    }
  }

  private async loadRuleScopes(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (!tpId || !custId || roleId == null) return;
    const scoped = this.rules().filter(r => r.scopeAllAssortments === 'N');
    const entries = await Promise.all(scoped.map(async r => {
      try {
        return [r.ruleId, await this.rulesService.getScope(tpId, custId, roleId, r.ruleId)] as const;
      } catch {
        return [r.ruleId, [] as RuleAssortmentScope[]] as const;
      }
    }));
    const map: Record<number, RuleAssortmentScope[]> = {};
    entries.forEach(([id, scope]) => { map[id] = scope; });
    this.ruleScopes.set(map);
  }

  private async loadRoleEmployeeCount(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (!tpId || !custId || roleId == null) return;
    try {
      const counts = await this.rolesService.getRoleEmployeeCounts(tpId, custId);
      this.roleEmployeeCount.set(counts[roleId] ?? 0);
    } catch {
      // Non-critical — the stat card just falls back to 0.
    }
  }

  toggleRuleExpand(ruleId: number): void {
    const expanded = new Set(this.expandedRuleIds());
    if (expanded.has(ruleId)) {
      expanded.delete(ruleId);
      this.expandedRuleIds.set(expanded);
      return;
    }
    expanded.add(ruleId);
    this.expandedRuleIds.set(expanded);
    if (!this.ruleLedgerChains()[ruleId]) this.loadRuleLedgerChain(ruleId);
  }

  private async loadRuleLedgerChain(ruleId: number): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (!tpId || !custId || roleId == null) return;
    this.ruleLedgerChainsLoading.update(s => new Set(s).add(ruleId));
    try {
      const chain = await this.rulesService.getLedgerChain(tpId, custId, roleId, ruleId);
      this.ruleLedgerChains.update(m => ({ ...m, [ruleId]: chain }));
    } catch {
      // Leave empty — the expanded section just shows "none" for every slot.
    } finally {
      this.ruleLedgerChainsLoading.update(s => {
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

  // ── Rules summary stat cards ─────────────────────────────────────────────

  private unitsForRule(ruleId: number): number {
    return (this.ruleScopes()[ruleId] ?? []).reduce((sum, s) => sum + (s.unitQty ?? 0), 0);
  }

  private get totalDollar(): number {
    return this.rules()
      .filter(r => r.allotType === 'DOLLAR' || r.allotType === 'DOLLAR_UNITS')
      .reduce((sum, r) => sum + (r.dollarAmount ?? 0), 0);
  }

  private get totalPoints(): number {
    return this.rules()
      .filter(r => r.allotType === 'POINTS')
      .reduce((sum, r) => sum + (r.pointsAmount ?? 0), 0);
  }

  private get totalUnits(): number {
    return this.rules()
      .filter(r => r.allotType === 'UNITS' || r.allotType === 'DOLLAR_UNITS')
      .reduce((sum, r) => sum + this.unitsForRule(r.ruleId), 0);
  }

  get totalPerEmployeeLabel(): string {
    const parts: string[] = [];
    if (this.totalDollar > 0) parts.push(`$${this.totalDollar.toFixed(2)}`);
    if (this.totalPoints > 0) parts.push(`${this.totalPoints} pts`);
    if (this.totalUnits > 0) parts.push(`${this.totalUnits} unit${this.totalUnits === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' · ') : '—';
  }

  get totalPerEmployeeBreakdown(): string {
    return this.rules().map(r => this.amountSummary(r)).join(' + ') || 'No rules yet';
  }

  get distinctRenewalCycles(): number[] {
    return Array.from(new Set(this.rules().map(r => r.renewalPeriodMonths))).sort((a, b) => a - b);
  }

  newRule(): void {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    this.router.navigate(['/partner', tpId, 'customers', custId, 'roles', roleId, 'rules', 'new']);
  }

  editRule(rule: CustomerAllotmentRule): void {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    this.router.navigate(
      ['/partner', tpId, 'customers', custId, 'roles', roleId, 'rules', rule.ruleId],
      { state: { rule } },
    );
  }

  openDeleteRuleModal(rule: CustomerAllotmentRule): void {
    this.deleteRuleTarget.set(rule);
    this.showDeleteRuleModal.set(true);
  }

  closeDeleteRuleModal(): void {
    this.showDeleteRuleModal.set(false);
    this.deleteRuleTarget.set(null);
  }

  async confirmDeleteRule(): Promise<void> {
    const target = this.deleteRuleTarget();
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (!target || !tpId || !custId || roleId == null) return;
    this.deletingRule.set(true);
    try {
      await this.rulesService.remove(tpId, custId, roleId, target.ruleId);
      this.closeDeleteRuleModal();
      await this.loadRules();
    } catch (err) {
      this.rulesError.set(err instanceof Error ? err.message : 'Delete failed.');
      this.closeDeleteRuleModal();
    } finally {
      this.deletingRule.set(false);
    }
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

  amountSummary(rule: CustomerAllotmentRule): string {
    switch (rule.allotType) {
      case 'DOLLAR':
        return rule.dollarAmount != null ? `$${rule.dollarAmount.toFixed(2)}` : '—';
      case 'DOLLAR_UNITS': {
        const units = this.unitsForRule(rule.ruleId);
        const dollar = rule.dollarAmount != null ? `$${rule.dollarAmount.toFixed(2)}` : '$0.00';
        return `${dollar} + ${units} unit${units === 1 ? '' : 's'}`;
      }
      case 'UNITS': {
        const units = this.unitsForRule(rule.ruleId);
        return `${units} unit${units === 1 ? '' : 's'}`;
      }
      case 'POINTS':
        return rule.pointsAmount != null ? `${rule.pointsAmount} pts` : '—';
      default:
        return '—';
    }
  }

  scopeNamesLabel(ruleId: number): string {
    const scope = this.ruleScopes()[ruleId] ?? [];
    if (scope.length === 0) return 'No categories';
    if (scope.length === 1) return scope[0].categoryName;
    return `${scope[0].categoryName} +${scope.length - 1} more`;
  }

  ruleSubtitle(rule: CustomerAllotmentRule): string {
    const scopeLabel = rule.scopeAllAssortments === 'Y' ? 'All assortments' : this.scopeNamesLabel(rule.ruleId);
    return `${scopeLabel} · ${this.allotTypeLabel(rule.allotType)} · renews every ${rule.renewalPeriodMonths} months`;
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  }

  nextRenewalLabel(rule: CustomerAllotmentRule): string {
    if (rule.renewalBasis !== 'FIXED') return 'Per employee';
    if (!rule.cycleStartDate) return '—';
    const d = new Date(`${rule.cycleStartDate}T00:00:00`);
    d.setMonth(d.getMonth() + rule.renewalPeriodMonths);
    return this.formatDate(d.toISOString().slice(0, 10));
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

  ruleStatusBadge(status: string): string {
    return status === 'ACTIVE'
      ? 'badge bg-success-subtle text-success border border-success-subtle'
      : 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
  }

  // ── Payment Ledgers tab ──────────────────────────────────────────────────

  async loadLedgers(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.ledgersLoading.set(true);
    this.ledgersError.set(null);
    try {
      this.ledgers.set(await this.ledgersService.listAll(tpId, custId));
    } catch (err) {
      this.ledgersError.set(err instanceof Error ? err.message : 'Failed to load payment ledgers.');
    } finally {
      this.ledgersLoading.set(false);
    }
  }

  openAddLedgerModal(): void {
    this.editingLedgerId.set(null);
    this.ledgerForm = { ...BLANK_LEDGER_FORM };
    this.ledgerSaveError.set(null);
    this.ledgerSubmitted.set(false);
    this.showLedgerFormModal.set(true);
  }

  openEditLedgerModal(ledger: CustomerPaymentLedger): void {
    this.editingLedgerId.set(ledger.ledgerId);
    this.ledgerForm = {
      ledgerName: ledger.ledgerName, ledgerType: ledger.ledgerType,
      amount: ledger.amount, status: ledger.status,
    };
    this.ledgerSaveError.set(null);
    this.ledgerSubmitted.set(false);
    this.showLedgerFormModal.set(true);
  }

  closeLedgerFormModal(): void {
    this.showLedgerFormModal.set(false);
  }

  onLedgerTypeChange(): void {
    if (this.ledgerForm.ledgerType === 'CREDIT_CARD') this.ledgerForm.amount = null;
  }

  async saveLedger(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.ledgerSubmitted.set(true);
    if (!this.ledgerForm.ledgerName) return;

    this.ledgerSaving.set(true);
    this.ledgerSaveError.set(null);
    try {
      const payload: CustomerPaymentLedgerForm = { ...this.ledgerForm };
      const id = this.editingLedgerId();
      if (id === null) {
        await this.ledgersService.create(tpId, custId, payload);
      } else {
        await this.ledgersService.update(tpId, custId, id, payload);
      }
      this.showLedgerFormModal.set(false);
      await this.loadLedgers();
    } catch (err) {
      this.ledgerSaveError.set(err instanceof Error ? err.message : 'Failed to save payment ledger.');
    } finally {
      this.ledgerSaving.set(false);
    }
  }

  openDeleteLedgerModal(ledger: CustomerPaymentLedger): void {
    this.deleteLedgerTarget.set(ledger);
    this.showDeleteLedgerModal.set(true);
  }

  closeDeleteLedgerModal(): void {
    this.showDeleteLedgerModal.set(false);
    this.deleteLedgerTarget.set(null);
  }

  async confirmDeleteLedger(): Promise<void> {
    const target = this.deleteLedgerTarget();
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!target || !tpId || !custId) return;
    this.deletingLedger.set(true);
    try {
      await this.ledgersService.remove(tpId, custId, target.ledgerId);
      this.closeDeleteLedgerModal();
      await this.loadLedgers();
    } catch (err) {
      this.ledgersError.set(err instanceof Error ? err.message : 'Delete failed.');
      this.closeDeleteLedgerModal();
    } finally {
      this.deletingLedger.set(false);
    }
  }

  ledgerTypeLabel(type: string): string {
    switch (type) {
      case 'CREDIT_CARD': return 'Credit Card';
      case 'POINTS': return 'Points';
      default: return 'Dollar';
    }
  }

  ledgerAmountLabel(ledger: CustomerPaymentLedger): string {
    if (ledger.ledgerType === 'CREDIT_CARD') return '—';
    if (ledger.amount == null) return 'Unlimited';
    return ledger.ledgerType === 'POINTS' ? `${ledger.amount} pts` : `$${ledger.amount.toFixed(2)}`;
  }

  ledgerStatusBadge(status: string): string {
    return status === 'ACTIVE'
      ? 'badge bg-success-subtle text-success border border-success-subtle'
      : 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
  }

  // ── Permissions tab ──────────────────────────────────────────────────────

  togglePerm(field: 'canOrderSelf' | 'canApprove' | 'canShopForOthers' | 'canManageTeamBalances', value: boolean): void {
    this.permForm[field] = value ? 'Y' : 'N';
  }

  async savePermissions(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    const role = this.role();
    if (!tpId || !custId || roleId == null || !role) return;
    this.permSaving.set(true);
    this.permSaveError.set(null);
    this.permSaved.set(false);
    try {
      const payload: CustomerRoleForm = {
        roleName: role.roleName,
        accessLevel: role.accessLevel,
        allotmentType: role.allotmentType,
        description: role.description ?? '',
        isActive: role.isActive,
        ...this.permForm,
      };
      await this.rolesService.update(tpId, custId, roleId, payload);
      this.role.update(r => r ? { ...r, ...this.permForm } : r);
      this.permSaved.set(true);
      setTimeout(() => this.permSaved.set(false), 2500);
    } catch (err) {
      this.permSaveError.set(err instanceof Error ? err.message : 'Failed to save permissions.');
    } finally {
      this.permSaving.set(false);
    }
  }
}
