import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerRolesService } from './customer-roles.service';
import { CustomerRole, CustomerRoleForm } from './customer-role.model';
import { CustomerAllotmentRulesService } from '../customer-allotment-rules/customer-allotment-rules.service';
import { CustomerAllotmentRule, RuleAssortmentScope } from '../customer-allotment-rules/customer-allotment-rule.model';
import { CustomerApprovalLevelsService } from '../customer-approval-levels/customer-approval-levels.service';
import { ApprovalLadder, ApprovalLevel, ApprovalSimulation } from '../customer-approval-levels/customer-approval-level.model';

type RoleDetailTab = 'rules' | 'permissions';

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
  private readonly approvalLevelsService = inject(CustomerApprovalLevelsService);
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
  // Other rules that name the delete target as their own fallback — fetched
  // via *FALLBACK_GET's usedBy so the confirm dialog can warn about them.
  readonly deleteRuleUsedBy = signal<string[]>([]);
  readonly deleteRuleUsedByLoading = signal(false);
  readonly deleteRuleSuccessMessage = signal<string | null>(null);
  readonly roleEmployeeCount = signal(0);
  readonly ruleScopes = signal<Record<number, RuleAssortmentScope[]>>({});
  readonly expandedRuleIds = signal<Set<number>>(new Set());

  // ── Permissions tab ──────────────────────────────────────────────────────
  readonly permSaving = signal(false);
  readonly permSaveError = signal<string | null>(null);
  readonly permSaved = signal(false);
  permForm: {
    canOrderSelf: 'Y' | 'N'; canApprove: 'Y' | 'N'; canShopForOthers: 'Y' | 'N'; canManageTeamBalances: 'Y' | 'N';
    canOverride: 'Y' | 'N'; approvalLevelId: number; allowCcOverage: 'Y' | 'N';
  } = {
    canOrderSelf: 'Y', canApprove: 'N', canShopForOthers: 'N', canManageTeamBalances: 'N',
    canOverride: 'N', approvalLevelId: 0, allowCcOverage: 'N',
  };

  // Approval ladder (customer-wide), loaded lazily the first time the
  // Permissions tab is opened — drives the level picker, the chain strip,
  // and the "Test an order" panel.
  readonly ladder = signal<ApprovalLadder | null>(null);
  readonly ladderLoading = signal(false);
  readonly ladderError = signal<string | null>(null);

  readonly simAmount = signal<number | null>(null);
  // Simplification: this page is already scoped to one role, so "placed by
  // role" is either this role or no particular role (0) — not a full
  // cross-customer role picker.
  readonly simAsThisRole = signal(true);
  readonly simResult = signal<ApprovalSimulation | null>(null);
  // The *SIMULATE response's own levels (not the ladder's), guaranteed in
  // sync with simResult() — used only to look up each path step's passesUp
  // flag for the sentence below.
  readonly simLevels = signal<ApprovalLevel[]>([]);
  readonly simLoading = signal(false);
  readonly simError = signal<string | null>(null);

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
      canOverride: role.canOverride, approvalLevelId: role.approvalLevelId ?? 0,
      allowCcOverage: role.allowCcOverage,
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
    if (tab === 'permissions' && this.ladder() === null) this.loadLadder();
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
    } else {
      expanded.add(ruleId);
    }
    this.expandedRuleIds.set(expanded);
  }

  scopeFor(ruleId: number): RuleAssortmentScope[] {
    return this.ruleScopes()[ruleId] ?? [];
  }

  // ── Rules summary stat cards ─────────────────────────────────────────────

  private unitsForRule(ruleId: number): number {
    return (this.ruleScopes()[ruleId] ?? []).reduce((sum, s) => sum + (s.unitQty ?? 0), 0);
  }

  private get totalDollar(): number {
    return this.rules()
      .filter(r => r.allotType === 'DOLLAR')
      .reduce((sum, r) => sum + (r.dollarAmount ?? 0), 0);
  }

  private get totalPoints(): number {
    return this.rules()
      .filter(r => r.allotType === 'POINTS')
      .reduce((sum, r) => sum + (r.pointsAmount ?? 0), 0);
  }

  private get totalUnits(): number {
    return this.rules()
      .filter(r => r.allotType === 'UNITS')
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
    this.deleteRuleUsedBy.set([]);
    this.showDeleteRuleModal.set(true);
    // UNITS rules can never be another rule's fallback target
    // (fallbackAvailable is always 'N' for them), so skip the fetch.
    if (rule.allotType !== 'UNITS') this.loadDeleteRuleUsedBy(rule.ruleId);
  }

  private async loadDeleteRuleUsedBy(ruleId: number): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.deleteRuleUsedByLoading.set(true);
    try {
      const card = await this.rulesService.getFallback(tpId, custId, ruleId);
      this.deleteRuleUsedBy.set(card.usedBy.map(u => u.ruleName));
    } catch {
      // Non-critical — the dialog just won't show the usedBy warning.
    } finally {
      this.deleteRuleUsedByLoading.set(false);
    }
  }

  closeDeleteRuleModal(): void {
    this.showDeleteRuleModal.set(false);
    this.deleteRuleTarget.set(null);
    this.deleteRuleUsedBy.set([]);
  }

  async confirmDeleteRule(): Promise<void> {
    const target = this.deleteRuleTarget();
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (!target || !tpId || !custId || roleId == null) return;
    this.deletingRule.set(true);
    try {
      const usedBy = this.deleteRuleUsedBy();
      await this.rulesService.remove(tpId, custId, roleId, target.ruleId);
      this.closeDeleteRuleModal();
      await this.loadRules();
      if (usedBy.length > 0) {
        this.deleteRuleSuccessMessage.set(`Removed from the fallback list of: ${usedBy.join(', ')}.`);
        setTimeout(() => this.deleteRuleSuccessMessage.set(null), 5000);
      }
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
      case 'POINTS': return 'Points';
      default: return type;
    }
  }

  amountSummary(rule: CustomerAllotmentRule): string {
    switch (rule.allotType) {
      case 'DOLLAR':
        return rule.dollarAmount != null ? `$${rule.dollarAmount.toFixed(2)}` : '—';
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

  // ── Permissions tab ──────────────────────────────────────────────────────

  togglePerm(field: 'canOrderSelf' | 'canApprove' | 'canShopForOthers' | 'canManageTeamBalances', value: boolean): void {
    this.permForm[field] = value ? 'Y' : 'N';
    // Turning Can approve off must also clear override/level in the same
    // save — the server rejects a level/override set without canApprove.
    if (field === 'canApprove' && !value) {
      this.permForm.canOverride = 'N';
      this.permForm.approvalLevelId = 0;
    }
  }

  toggleAllowCcOverage(value: boolean): void {
    this.permForm.allowCcOverage = value ? 'Y' : 'N';
  }

  toggleOverride(value: boolean): void {
    this.permForm.canOverride = value ? 'Y' : 'N';
    // Override and a level are mutually exclusive — turning override on
    // always clears the level picker.
    if (value) this.permForm.approvalLevelId = 0;
  }

  onApprovalLevelChange(levelId: number): void {
    this.permForm.approvalLevelId = levelId;
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
        allotExclTaxFreight: role.allotExclTaxFreight,
        requiresApproval: role.requiresApproval,
        ...this.permForm,
      };
      await this.rolesService.update(tpId, custId, roleId, payload);
      this.permSaved.set(true);
      // approvalLevelNo is read-only/server-computed — refetch rather than
      // merge permForm locally, so the chain strip highlights correctly.
      await this.fetchRole(roleId);
      setTimeout(() => this.permSaved.set(false), 2500);
    } catch (err) {
      this.permSaveError.set(err instanceof Error ? err.message : 'Failed to save permissions.');
    } finally {
      this.permSaving.set(false);
    }
  }

  // ── Approval ladder (chain strip / level picker / simulate) ─────────────

  async loadLadder(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.ladderLoading.set(true);
    this.ladderError.set(null);
    try {
      this.ladder.set(await this.approvalLevelsService.list(tpId, custId));
    } catch (err) {
      this.ladderError.set(err instanceof Error ? err.message : 'Failed to load approval levels.');
    } finally {
      this.ladderLoading.set(false);
    }
  }

  get sortedLevels(): ApprovalLevel[] {
    return (this.ladder()?.levels ?? []).slice().sort((a, b) => a.levelNo - b.levelNo);
  }

  levelOptionLabel(level: ApprovalLevel): string {
    const range = level.passesUp === 'Y'
      ? 'always passes up'
      : level.maxAmount == null
        ? `over $${level.minAmount.toFixed(0)}, final approval any amount`
        : `over $${level.minAmount.toFixed(0)}, up to $${level.maxAmount.toFixed(0)}`;
    return `Level ${level.levelNo} — ${range} · ${level.escalationDays} day${level.escalationDays === 1 ? '' : 's'}`;
  }

  levelRangeLabel(level: ApprovalLevel): string {
    if (level.passesUp === 'Y') return 'Always passes up';
    if (level.maxAmount == null) return `$${level.minAmount.toFixed(0)}+ (final)`;
    return `$${level.minAmount.toFixed(0)} – $${level.maxAmount.toFixed(0)}`;
  }

  levelRoleNames(level: ApprovalLevel): string {
    return level.roles.length ? level.roles.map(r => r.roleName).join(', ') : 'No roles assigned';
  }

  overrideRoleNames(ladder: ApprovalLadder): string {
    return ladder.overrideRoles.map(r => r.roleName).join(', ') || 'No roles';
  }

  isCurrentLevel(level: ApprovalLevel): boolean {
    return this.permForm.canApprove === 'Y' && this.permForm.canOverride === 'N' && this.permForm.approvalLevelId === level.levelId;
  }

  async runSimulation(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const amount = this.simAmount();
    if (!tpId || !custId || !amount || amount <= 0) return;
    this.simLoading.set(true);
    this.simError.set(null);
    try {
      const roleId = this.simAsThisRole() ? (this.roleId ?? 0) : 0;
      const result = await this.approvalLevelsService.simulate(tpId, custId, amount, roleId);
      this.simResult.set(result.simulation ?? null);
      this.simLevels.set(result.levels);
    } catch (err) {
      this.simError.set(err instanceof Error ? err.message : 'Failed to simulate.');
    } finally {
      this.simLoading.set(false);
    }
  }

  simulationSentence(): string {
    const sim = this.simResult();
    if (!sim) return '';
    const passesUpByLevelId = new Map(this.simLevels().map(l => [l.levelId, l.passesUp === 'Y']));
    const steps = sim.path.map(s => {
      if (s.willSkip === 'Y') return `${s.roleNames ?? 'Level ' + s.levelNo} (skipped, nobody assigned)`;
      if (passesUpByLevelId.get(s.levelId)) return `${s.roleNames ?? 'Level ' + s.levelNo} (${s.escalationDays}d, passes up)`;
      return `${s.roleNames ?? 'Level ' + s.levelNo} (${s.escalationDays}d)`;
    });
    const prefix = `A $${sim.amount.toFixed(2)} order needs: `;
    if (sim.endsWith === 'NONE') return `${prefix}nobody can approve this order.`;
    const suffix = sim.endsWith === 'OVERRIDE' ? ' → an administrator (override)' : '';
    return `${prefix}${steps.join(' → ')}${suffix}.`;
  }
}
