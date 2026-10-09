import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerRolesService } from '../customer-roles/customer-roles.service';
import { CustomerRole } from '../customer-roles/customer-role.model';
import { CustomerProgramsService } from '../customer-programs/customer-programs.service';
import { CustomerProgram, CustomerProgramCategoryNode } from '../customer-programs/customer-program.model';
import { CustomerPaymentLedgersService } from '../customer-payment-ledgers/customer-payment-ledgers.service';
import { CustomerPaymentLedger } from '../customer-payment-ledgers/customer-payment-ledger.model';
import { CustomerAllotmentRulesService } from './customer-allotment-rules.service';
import {
  CustomerAllotmentRule, CustomerAllotmentRuleForm, RuleQuotaLimit, RuleQuotaLimitForm,
} from './customer-allotment-rule.model';

const BLANK_FORM: CustomerAllotmentRuleForm = {
  ruleName: '', status: 'DRAFT', allotType: 'DOLLAR', dollarAmount: null, pointsAmount: null,
  scopeAllAssortments: 'Y', renewalBasis: 'FIXED', renewalPeriodMonths: 12, renewalTime: '00:00:00',
  hireDaysOffset: null, cycleStartDate: new Date().toISOString().slice(0, 10), expirationDate: null,
  onExpirationAction: 'SUSPEND', carryoverType: 'FORFEIT', carryoverPct: null,
  autoCreateNewEmp: 'Y', prorateMidCycle: 'Y', notifyNewCycle: 'Y', notifyLowBalance: 'Y', notifyCarryover: 'N',
  requireApproval: 'N', allowCcFallback: 'Y',
};

const BLANK_QUOTA_FORM: RuleQuotaLimitForm = { programId: 0, progCatId: null, limitType: 'UNITS', limitValue: 0, renewalPeriodMonths: 12 };

@Component({
  selector: 'app-customer-allotment-rule-editor',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './customer-allotment-rule-editor.component.html',
})
export class CustomerAllotmentRuleEditorComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly rolesService = inject(CustomerRolesService);
  private readonly programsService = inject(CustomerProgramsService);
  private readonly ledgersService = inject(CustomerPaymentLedgersService);
  private readonly service = inject(CustomerAllotmentRulesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly role = signal<CustomerRole | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly submitted = signal(false);

  readonly allPrograms = signal<CustomerProgram[]>([]);
  readonly allLedgers = signal<CustomerPaymentLedger[]>([]);
  readonly siblingRules = signal<CustomerAllotmentRule[]>([]);

  form: CustomerAllotmentRuleForm = { ...BLANK_FORM };

  // ── Scope (categories covered) ──────────────────────────────────────────
  // Scope is category-level, not whole-assortment — a rule covers specific
  // categories (e.g. "Outerwear") within an assortment, not the entire
  // assortment.
  readonly scopeCategoryIds = signal<Set<number>>(new Set());
  readonly unitQtyByCategory = signal<Record<number, number>>({});
  readonly categoryLookup = signal<Record<number, { progCatId: number; categoryName: string; programId: number; programName: string }>>({});
  readonly showScopeModal = signal(false);
  readonly scopeModalProgramId = signal<number | null>(null);
  readonly scopeModalCategories = signal<{ progCatId: number; label: string; rawName: string; isLeaf: boolean }[]>([]);
  readonly scopeModalCategoryId = signal<number | null>(null);

  // ── Quota limits ─────────────────────────────────────────────────────────
  readonly quotas = signal<RuleQuotaLimit[]>([]);
  readonly showQuotaModal = signal(false);
  readonly editingQuotaId = signal<number | null>(null);
  readonly quotaSaving = signal(false);
  readonly quotaError = signal<string | null>(null);
  readonly quotaCategories = signal<{ progCatId: number | null; label: string; isLeaf: boolean }[]>([]);
  // progCatId -> breadcrumb label ("Outerwear > Jackets"), resolved for
  // every program referenced by the loaded quotas so the list can show full
  // parent > child paths without needing a per-row category fetch.
  readonly categoryPathLookup = signal<Record<number, string>>({});
  quotaForm: RuleQuotaLimitForm = { ...BLANK_QUOTA_FORM };
  readonly showDeleteQuotaModal = signal(false);
  readonly deleteQuotaTarget = signal<RuleQuotaLimit | null>(null);
  readonly deletingQuota = signal(false);

  // ── Payment ledger precedence chain ─────────────────────────────────────
  readonly slots = signal<(number | null)[]>([null, null, null]);

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

  protected get ruleId(): number | null {
    const p = this.route.snapshot.paramMap.get('ruleId');
    return p ? Number(p) : null;
  }

  get isEdit(): boolean {
    return this.ruleId !== null;
  }

  get needsUnitScope(): boolean {
    return this.form.allotType === 'UNITS';
  }

  get allowsPartialCarryover(): boolean {
    return this.form.dollarAmount != null;
  }

  get carryoverCapPreview(): number | null {
    if (this.form.carryoverType !== 'PARTIAL' || this.form.carryoverPct == null || this.form.dollarAmount == null) return null;
    return this.form.dollarAmount * this.form.carryoverPct / 100;
  }

  get scopedCategories(): { progCatId: number; categoryName: string; programId: number; programName: string }[] {
    const lookup = this.categoryLookup();
    return Array.from(this.scopeCategoryIds())
      .map(id => lookup[id])
      .filter((c): c is NonNullable<typeof c> => !!c);
  }

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);

    await Promise.all([this.loadPrograms(), this.loadLedgers()]);
    if (roleId != null) await Promise.all([this.loadRole(roleId), this.loadSiblingRules(roleId)]);

    const ruleId = this.ruleId;
    if (ruleId !== null) {
      const state = window.history.state as { rule?: CustomerAllotmentRule };
      if (state.rule && state.rule.ruleId === ruleId) {
        this.applyRule(state.rule);
      } else {
        await this.fetchRule(ruleId);
      }
      await Promise.all([this.loadScope(ruleId), this.loadQuotas(ruleId), this.loadLedgerChain(ruleId)]);
    } else {
      this.form = { ...BLANK_FORM };
    }
  }

  private async loadRole(roleId: number): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    try {
      this.role.set(await this.rolesService.get(tpId, custId, roleId));
    } catch {
      // Non-critical for the editor itself — only affects the header/back link label.
    }
  }

  // Every other rule already on this role (excluding the one being edited)
  // — used to enforce the role-level allotment-type combination rule:
  // Points can't coexist with a Dollar rule.
  private async loadSiblingRules(roleId: number): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    try {
      const all = await this.service.listAll(tpId, custId, roleId);
      this.siblingRules.set(all.filter(r => r.ruleId !== this.ruleId));
    } catch {
      // Leave empty — worst case the save-time check is skipped and the
      // backend is the final authority.
    }
  }

  // Why `type` can't be selected right now, or null if it's allowed.
  allotTypeConflict(type: CustomerAllotmentRuleForm['allotType']): string | null {
    const siblings = this.siblingRules();
    if (type === 'POINTS' && siblings.some(r => r.allotType === 'DOLLAR')) {
      return 'Points and Dollar allotments can’t exist together on the same role.';
    }
    if (type === 'DOLLAR' && siblings.some(r => r.allotType === 'POINTS')) {
      return 'Points and Dollar allotments can’t exist together on the same role.';
    }
    return null;
  }

  private async loadPrograms(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    try {
      this.allPrograms.set(await this.programsService.listAll(tpId, custId));
    } catch {
      // Non-critical at load time — scope/quota pickers will just show empty lists.
    }
  }

  private async loadLedgers(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    try {
      this.allLedgers.set(await this.ledgersService.listAll(tpId, custId));
    } catch {
      // Non-critical at load time.
    }
  }

  private async fetchRule(ruleId: number): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (!tpId || !custId || roleId == null) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.applyRule(await this.service.get(tpId, custId, roleId, ruleId));
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load rule.');
    } finally {
      this.loading.set(false);
    }
  }

  private applyRule(rule: CustomerAllotmentRule): void {
    this.form = {
      ruleName: rule.ruleName,
      status: rule.status,
      allotType: rule.allotType,
      dollarAmount: rule.dollarAmount,
      pointsAmount: rule.pointsAmount,
      scopeAllAssortments: rule.scopeAllAssortments,
      renewalBasis: rule.renewalBasis,
      renewalPeriodMonths: rule.renewalPeriodMonths,
      renewalTime: rule.renewalTime,
      hireDaysOffset: rule.hireDaysOffset,
      cycleStartDate: rule.cycleStartDate,
      expirationDate: rule.expirationDate,
      onExpirationAction: rule.onExpirationAction,
      carryoverType: rule.carryoverType,
      carryoverPct: rule.carryoverPct,
      autoCreateNewEmp: rule.autoCreateNewEmp,
      prorateMidCycle: rule.prorateMidCycle,
      notifyNewCycle: rule.notifyNewCycle,
      notifyLowBalance: rule.notifyLowBalance,
      notifyCarryover: rule.notifyCarryover,
      requireApproval: rule.requireApproval,
      allowCcFallback: rule.allowCcFallback,
    };
  }

  private async loadScope(ruleId: number): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (!tpId || !custId || roleId == null) return;
    try {
      const scope = await this.service.getScope(tpId, custId, roleId, ruleId);
      this.scopeCategoryIds.set(new Set(scope.map(s => s.progCatId)));
      const qtyMap: Record<number, number> = {};
      const lookup = { ...this.categoryLookup() };
      scope.forEach(s => {
        if (s.unitQty != null) qtyMap[s.progCatId] = s.unitQty;
        lookup[s.progCatId] = {
          progCatId: s.progCatId, categoryName: s.categoryName,
          programId: s.programId, programName: s.programName,
        };
      });
      this.unitQtyByCategory.set(qtyMap);
      this.categoryLookup.set(lookup);
      await this.loadCategoryPaths(Array.from(new Set(scope.map(s => s.programId))));
    } catch {
      // Leave scope empty — editable from scratch.
    }
  }

  // ── Type & amount ────────────────────────────────────────────────────────

  onAllotTypeChange(): void {
    if (this.needsUnitScope) this.form.scopeAllAssortments = 'N';
    if (!this.allowsPartialCarryover && this.form.carryoverType === 'PARTIAL') {
      this.form.carryoverType = 'FORFEIT';
      this.form.carryoverPct = null;
    }
  }

  onDollarAmountChange(): void {
    if (!this.allowsPartialCarryover && this.form.carryoverType === 'PARTIAL') {
      this.form.carryoverType = 'FORFEIT';
      this.form.carryoverPct = null;
    }
  }

  // ── Renewal basis ────────────────────────────────────────────────────────

  onRenewalBasisChange(): void {
    if (this.form.renewalBasis !== 'HIREDAYS') this.form.hireDaysOffset = null;
    if (this.form.renewalBasis !== 'FIXED') this.form.cycleStartDate = null;
    else if (!this.form.cycleStartDate) this.form.cycleStartDate = new Date().toISOString().slice(0, 10);
  }

  // ── Scope chip picker ────────────────────────────────────────────────────

  removeFromScope(progCatId: number): void {
    this.scopeCategoryIds.update(set => {
      const next = new Set(set);
      next.delete(progCatId);
      return next;
    });
    this.unitQtyByCategory.update(map => {
      const { [progCatId]: _removed, ...rest } = map;
      return rest;
    });
  }

  unitQtyFor(progCatId: number): number {
    return this.unitQtyByCategory()[progCatId] ?? 0;
  }

  onUnitQtyChange(progCatId: number, value: string): void {
    const qty = Math.max(0, parseInt(value, 10) || 0);
    this.unitQtyByCategory.update(map => ({ ...map, [progCatId]: qty }));
  }

  openScopeModal(): void {
    this.scopeModalCategoryId.set(null);
    this.scopeModalProgramId.set(this.allPrograms()[0]?.programId ?? null);
    this.loadScopeModalCategories();
    this.showScopeModal.set(true);
  }

  closeScopeModal(): void {
    this.showScopeModal.set(false);
  }

  async onScopeModalProgramChange(): Promise<void> {
    this.scopeModalCategoryId.set(null);
    await this.loadScopeModalCategories();
  }

  private async loadScopeModalCategories(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.scopeModalProgramId();
    if (!tpId || !custId || !programId) {
      this.scopeModalCategories.set([]);
      return;
    }
    try {
      const tree = await this.programsService.getTree(tpId, custId, programId);
      const flat = this.flattenCategories(tree.categories);
      this.scopeModalCategories.set(flat);
      // Merge into the lookup so chips can resolve names for categories
      // that were only just browsed, not yet part of the saved scope.
      const program = this.allPrograms().find(p => p.programId === programId);
      const lookup = { ...this.categoryLookup() };
      const pathLookup = { ...this.categoryPathLookup() };
      flat.forEach(c => {
        lookup[c.progCatId] = {
          progCatId: c.progCatId, categoryName: c.rawName,
          programId, programName: program?.programName ?? '',
        };
        pathLookup[c.progCatId] = c.label;
      });
      this.categoryLookup.set(lookup);
      this.categoryPathLookup.set(pathLookup);
    } catch {
      this.scopeModalCategories.set([]);
    }
  }

  // Leaf categories in the currently-browsed assortment that aren't already
  // in scope — parent/branch categories aren't selectable since they don't
  // directly hold any SKUs.
  availableScopeModalCategories(): { progCatId: number; label: string; rawName: string; isLeaf: boolean }[] {
    const inScope = this.scopeCategoryIds();
    return this.scopeModalCategories().filter(c => c.isLeaf && !inScope.has(c.progCatId));
  }

  // Adds the single selected category to scope immediately, then clears the
  // picker so the next one can be picked without reopening the modal.
  addScopeCategory(): void {
    const progCatId = this.scopeModalCategoryId();
    if (progCatId == null) return;
    this.scopeCategoryIds.update(set => new Set(set).add(progCatId));
    this.unitQtyByCategory.update(map => ({ ...map, [progCatId]: map[progCatId] ?? 0 }));
    this.scopeModalCategoryId.set(null);
  }

  // ── Quota limits ─────────────────────────────────────────────────────────

  private async loadQuotas(ruleId: number): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (!tpId || !custId || roleId == null) return;
    try {
      const quotas = await this.service.listQuotas(tpId, custId, roleId, ruleId);
      this.quotas.set(quotas);
      await this.loadQuotaCategoryPaths(quotas);
    } catch {
      // Non-critical.
    }
  }

  private async loadQuotaCategoryPaths(quotas: RuleQuotaLimit[]): Promise<void> {
    const programIds = Array.from(new Set(quotas.filter(q => q.progCatId != null).map(q => q.programId)));
    await this.loadCategoryPaths(programIds);
  }

  // Shared by Scope and Quota Limits — resolves the full "Parent > Child"
  // breadcrumb for every category in the given assortments and merges it
  // into categoryPathLookup, so both sections can show the full path
  // without needing a per-row category fetch.
  private async loadCategoryPaths(programIds: number[]): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    const lookup = { ...this.categoryPathLookup() };
    await Promise.all(programIds.map(async programId => {
      try {
        const tree = await this.programsService.getTree(tpId, custId, programId);
        this.flattenCategories(tree.categories).forEach(c => { lookup[c.progCatId] = c.label; });
      } catch {
        // Leave unresolved — falls back to the leaf category name.
      }
    }));
    this.categoryPathLookup.set(lookup);
  }

  quotaCategoryLabel(quota: RuleQuotaLimit): string {
    if (quota.progCatId == null) return 'All categories';
    return this.categoryPathLookup()[quota.progCatId] ?? quota.categoryName ?? 'Category';
  }

  scopeCategoryLabel(c: { progCatId: number; categoryName: string }): string {
    return this.categoryPathLookup()[c.progCatId] ?? c.categoryName;
  }

  // Breadcrumb-style labels ("Outerwear > Jackets") instead of indentation,
  // so the parent chain stays legible in a flat <select> list. Includes
  // every node (leaf and parent) since path lookups need the full tree to
  // resolve breadcrumbs — callers building a picker should filter to
  // isLeaf themselves (a rule/quota should target a concrete leaf category,
  // not a parent grouping that doesn't directly hold any SKUs).
  private flattenCategories(
    nodes: CustomerProgramCategoryNode[], parentPath = '',
  ): { progCatId: number; label: string; rawName: string; isLeaf: boolean }[] {
    const out: { progCatId: number; label: string; rawName: string; isLeaf: boolean }[] = [];
    for (const n of nodes) {
      const label = parentPath ? `${parentPath} > ${n.categoryName}` : n.categoryName;
      out.push({ progCatId: n.progCatId, label, rawName: n.categoryName, isLeaf: n.children.length === 0 });
      out.push(...this.flattenCategories(n.children, label));
    }
    return out;
  }

  async onQuotaProgramChange(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId || !this.quotaForm.programId) {
      this.quotaCategories.set([]);
      return;
    }
    try {
      const tree = await this.programsService.getTree(tpId, custId, this.quotaForm.programId);
      // Leaf categories only — a quota should target a concrete category
      // that directly holds SKUs, not a parent grouping.
      this.quotaCategories.set(this.flattenCategories(tree.categories).filter(c => c.isLeaf));
    } catch {
      this.quotaCategories.set([]);
    }
  }

  openAddQuotaModal(): void {
    this.editingQuotaId.set(null);
    this.quotaForm = { ...BLANK_QUOTA_FORM, programId: this.allPrograms()[0]?.programId ?? 0 };
    this.quotaError.set(null);
    this.onQuotaProgramChange();
    this.showQuotaModal.set(true);
  }

  openEditQuotaModal(quota: RuleQuotaLimit): void {
    this.editingQuotaId.set(quota.quotaId);
    this.quotaForm = {
      programId: quota.programId, progCatId: quota.progCatId,
      limitType: quota.limitType, limitValue: quota.limitValue,
      renewalPeriodMonths: quota.renewalPeriodMonths,
    };
    this.quotaError.set(null);
    this.onQuotaProgramChange();
    this.showQuotaModal.set(true);
  }

  closeQuotaModal(): void {
    this.showQuotaModal.set(false);
  }

  async saveQuota(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    const ruleId = this.ruleId;
    if (!tpId || !custId || roleId == null || ruleId == null) return;
    this.quotaSaving.set(true);
    this.quotaError.set(null);
    try {
      const id = this.editingQuotaId();
      if (id === null) {
        await this.service.createQuota(tpId, custId, roleId, ruleId, this.quotaForm);
      } else {
        await this.service.updateQuota(tpId, custId, roleId, ruleId, id, this.quotaForm);
      }
      this.showQuotaModal.set(false);
      await this.loadQuotas(ruleId);
    } catch (err) {
      this.quotaError.set(err instanceof Error ? err.message : 'Failed to save quota limit.');
    } finally {
      this.quotaSaving.set(false);
    }
  }

  openDeleteQuotaModal(quota: RuleQuotaLimit): void {
    this.deleteQuotaTarget.set(quota);
    this.showDeleteQuotaModal.set(true);
  }

  closeDeleteQuotaModal(): void {
    this.showDeleteQuotaModal.set(false);
    this.deleteQuotaTarget.set(null);
  }

  async confirmDeleteQuota(): Promise<void> {
    const target = this.deleteQuotaTarget();
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    const ruleId = this.ruleId;
    if (!target || !tpId || !custId || roleId == null || ruleId == null) return;
    this.deletingQuota.set(true);
    try {
      await this.service.removeQuota(tpId, custId, roleId, ruleId, target.quotaId);
      this.closeDeleteQuotaModal();
      await this.loadQuotas(ruleId);
    } finally {
      this.deletingQuota.set(false);
    }
  }

  // ── Payment ledger chain ─────────────────────────────────────────────────

  private async loadLedgerChain(ruleId: number): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (!tpId || !custId || roleId == null) return;
    try {
      const chain = await this.service.getLedgerChain(tpId, custId, roleId, ruleId);
      const slots: (number | null)[] = [null, null, null];
      chain.forEach(slot => { slots[slot.precedence - 1] = slot.ledgerId; });
      this.slots.set(slots);
    } catch {
      // Leave the chain empty — editable from scratch.
    }
  }

  isLedgerUsedElsewhere(ledgerId: number, excludeIndex: number): boolean {
    return this.slots().some((v, i) => i !== excludeIndex && v === ledgerId);
  }

  activeLedgers(): CustomerPaymentLedger[] {
    return this.allLedgers().filter(l => l.status === 'ACTIVE');
  }

  onSlotChange(index: number, value: string): void {
    const ledgerId = value ? Number(value) : null;
    this.slots.update(slots => {
      const next = [...slots];
      next[index] = ledgerId;
      return next;
    });
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async saveRule(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    if (!tpId || !custId || roleId == null) return;
    this.submitted.set(true);
    if (!this.form.ruleName) {
      this.scrollToAndFocus('rf-ruleName');
      return;
    }

    const conflict = this.allotTypeConflict(this.form.allotType);
    if (conflict) {
      this.saveError.set(conflict);
      this.scrollToAndFocus('rf-allotType');
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    try {
      const scopeItems = Array.from(this.scopeCategoryIds()).map(progCatId => ({
        progCatId,
        unitQty: this.needsUnitScope ? (this.unitQtyByCategory()[progCatId] ?? 0) : null,
      }));
      const ledgerSlots = this.slots()
        .map((ledgerId, i) => ({ precedence: (i + 1) as 1 | 2 | 3, ledgerId }))
        .filter((s): s is { precedence: 1 | 2 | 3; ledgerId: number } => s.ledgerId != null);

      let ruleId = this.ruleId;
      if (ruleId === null) {
        const created = await this.service.create(tpId, custId, roleId, this.form);
        if (!created?.ruleId) {
          throw new Error('The server did not return the new rule’s ID — the rule may not have been created.');
        }
        ruleId = created.ruleId;
      } else {
        await this.service.update(tpId, custId, roleId, ruleId, this.form);
      }

      if (this.form.scopeAllAssortments === 'N') {
        await this.service.setScope(tpId, custId, roleId, ruleId, scopeItems);
      }
      await this.service.setLedgerChain(tpId, custId, roleId, ruleId, ledgerSlots);

      this.router.navigate(['/partner', tpId, 'customers', custId, 'roles', roleId]);
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : 'Failed to save rule.');
    } finally {
      this.saving.set(false);
    }
  }

  cancel(): void {
    const tpId = this.tpId;
    const custId = this.customerId;
    const roleId = this.roleId;
    this.router.navigate(['/partner', tpId, 'customers', custId, 'roles', roleId]);
  }

  // This is a long single-page form — a validation error on a field near
  // the top (Rule Name, Allotment Type) is otherwise invisible if the user
  // clicked Save from further down the page.
  private scrollToAndFocus(elementId: string): void {
    const el = document.getElementById(elementId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus();
  }
}
