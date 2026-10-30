import { Component, OnInit, HostListener, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerProgramsService } from '../customer-programs/customer-programs.service';
import { CustomerProgram, CustomerProgramCategoryNode, CustomerProgramSku } from '../customer-programs/customer-program.model';
import { CustomerProgramViewsService } from './customer-program-views.service';
import { CustomerProgramView, CustomerProgramViewForm } from './customer-program-view.model';
import { CustomerLocationsService } from '../customer-locations/customer-locations.service';
import { CustomerLocation } from '../customer-locations/customer-location.model';
import { isDisplayableImageUrl } from '../../shared/image-url.util';

interface ProductGroup {
  key: string;
  progCatId: number;
  productPk: number;
  productId: number;
  productTitle: string;
  productImageUrl: string | null;
  skus: CustomerProgramSku[];
}

interface TreeRow {
  kind: 'CATEGORY' | 'PRODUCT_GROUP' | 'SKU';
  level: number;
  key: string;
  category?: CustomerProgramCategoryNode;
  group?: ProductGroup;
  sku?: CustomerProgramSku;
}

@Component({
  selector: 'app-customer-program-views',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './customer-program-views.component.html',
})
export class CustomerProgramViewsComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly service = inject(CustomerProgramViewsService);
  private readonly programsService = inject(CustomerProgramsService);
  private readonly locationsService = inject(CustomerLocationsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly isDisplayableImageUrl = isDisplayableImageUrl;

  readonly program = signal<CustomerProgram | null>(null);
  readonly views = signal<CustomerProgramView[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly search = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  // Only one row's "+N more locations" popover open at a time — a floating
  // panel rather than an inline-expanding row, so it doesn't shift the page
  // layout underneath it when there are many assigned locations.
  readonly openLocationsPopoverViewId = signal<number | null>(null);

  readonly showFormModal = signal(false);
  readonly savingForm = signal(false);
  readonly formError = signal<string | null>(null);
  readonly editTarget = signal<CustomerProgramView | null>(null);
  readonly copySourceView = signal<CustomerProgramView | null>(null);
  readonly form = signal<CustomerProgramViewForm>({ viewName: '', description: '', status: 'ACTIVE' });

  readonly showDeleteModal = signal(false);
  readonly deleting = signal(false);
  readonly deleteTarget = signal<CustomerProgramView | null>(null);

  // ── Assign Locations modal ─────────────────────────────────────────────────

  readonly showAssignLocationsModal = signal(false);
  readonly assignLocationsView = signal<CustomerProgramView | null>(null);
  readonly assignLocationsLoading = signal(false);
  readonly assignLocationsError = signal<string | null>(null);
  readonly allLocationsForAssign = signal<CustomerLocation[]>([]);
  readonly assignLocationsSearch = signal('');
  readonly assignLocationsTogglingIds = signal<Set<number>>(new Set());
  private assignLocationsSearchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly filteredAssignLocations = computed(() => {
    const term = this.assignLocationsSearch().trim().toLowerCase();
    if (!term) return this.allLocationsForAssign();
    return this.allLocationsForAssign().filter(loc =>
      loc.locName.toLowerCase().includes(term) ||
      loc.locCode.toLowerCase().includes(term) ||
      loc.city.toLowerCase().includes(term)
    );
  });

  readonly assignedLocationsCount = computed(() => {
    const viewId = this.assignLocationsView()?.viewId;
    if (viewId == null) return 0;
    return this.allLocationsForAssign().filter(loc => loc.viewId === viewId).length;
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  readonly startRecord = computed(() => this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1);
  readonly endRecord = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Selections modal (the simplified assortment tree + checkboxes) ────────

  readonly showSelectionsModal = signal(false);
  readonly selectionsView = signal<CustomerProgramView | null>(null);
  readonly selectionsLoading = signal(false);
  readonly selectionsError = signal<string | null>(null);
  readonly selectionsSynced = signal(false);
  private syncedTimer: ReturnType<typeof setTimeout> | null = null;
  readonly bulkActionLoading = signal(false);

  readonly treeCategories = signal<CustomerProgramCategoryNode[]>([]);
  readonly directCategoryIds = signal<Set<number>>(new Set());
  readonly directProgProdIds = signal<Set<number>>(new Set());
  readonly togglingKeys = signal<Set<string>>(new Set());
  // Used only to walk up to a category's ancestors when auto-checking them —
  // not used to infer "included via ancestor" display state anymore.
  private readonly parentOf = new Map<number, number | null>();

  readonly treeSearch = signal('');
  readonly expandedIds = signal<Set<number>>(new Set());
  readonly expandedGroupKeys = signal<Set<string>>(new Set());
  private treeSearchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly treeRows = computed(() => {
    const term = this.treeSearch().trim().toLowerCase();
    const expandedCats = this.expandedIds();
    const expandedGroups = this.expandedGroupKeys();
    const filtering = term.length > 0;
    const rows: TreeRow[] = [];

    const matches = (text: string | null) => !!text && text.toLowerCase().includes(term);
    const skuMatches = (sku: CustomerProgramSku) => matches(sku.productTitle) || matches(sku.skuCode);

    const categoryMatches = (cat: CustomerProgramCategoryNode): boolean =>
      matches(cat.categoryName) ||
      cat.skus.some(skuMatches) ||
      cat.children.some(categoryMatches);

    const groupSkusByProduct = (skus: CustomerProgramSku[]): ProductGroup[] => {
      const byProduct = new Map<number, ProductGroup>();
      const order: ProductGroup[] = [];
      for (const sku of skus) {
        let group = byProduct.get(sku.productPk);
        if (!group) {
          group = { key: `g${sku.progCatId}-${sku.productPk}`, progCatId: sku.progCatId, productPk: sku.productPk, productId: sku.productId, productTitle: sku.productTitle, productImageUrl: sku.productImageUrl, skus: [] };
          byProduct.set(sku.productPk, group);
          order.push(group);
        }
        group.skus.push(sku);
      }
      return order;
    };

    const visit = (cat: CustomerProgramCategoryNode, level: number) => {
      if (filtering && !categoryMatches(cat)) return;
      rows.push({ kind: 'CATEGORY', level, key: 'c' + cat.progCatId, category: cat });
      const isCatOpen = filtering || expandedCats.has(cat.progCatId);
      if (!isCatOpen) return;
      for (const child of cat.children) visit(child, level + 1);

      for (const group of groupSkusByProduct(cat.skus)) {
        const visibleSkus = filtering ? group.skus.filter(skuMatches) : group.skus;
        if (filtering && visibleSkus.length === 0) continue;
        rows.push({ kind: 'PRODUCT_GROUP', level: level + 1, key: group.key, group: { ...group, skus: visibleSkus } });
        const isGroupOpen = filtering || expandedGroups.has(group.key);
        if (!isGroupOpen) continue;
        for (const sku of visibleSkus) {
          rows.push({ kind: 'SKU', level: level + 2, key: 's' + sku.progProdId, sku });
        }
      }
    };

    for (const cat of this.treeCategories()) visit(cat, 0);
    return rows;
  });

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get customerId(): number | null {
    const idParam = this.route.snapshot.paramMap.get('customerId');
    return idParam ? Number(idParam) : null;
  }

  protected get programId(): number | null {
    const idParam = this.route.snapshot.paramMap.get('programId');
    return idParam ? Number(idParam) : null;
  }

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);

    const state = window.history.state as { program?: CustomerProgram };
    if (state.program && state.program.programId === this.programId) {
      this.program.set(state.program);
    } else {
      await this.loadProgram();
    }

    await this.loadViews();
  }

  private async loadProgram(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.programId;
    if (!tpId || !custId || !programId) return;
    try {
      this.program.set(await this.programsService.get(tpId, custId, programId));
    } catch {
      this.error.set('Could not load program.');
    }
  }

  async loadViews(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.programId;
    if (!tpId || !custId || !programId) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.service.list(tpId, custId, programId, {
        page: this.page(),
        pageSize: this.pageSize(),
        search: this.search(),
      });
      this.views.set(result.data);
      this.total.set(result.pagination.totalRows);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load views.');
    } finally {
      this.loading.set(false);
    }
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.page.set(1); this.loadViews(); }, 350);
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.page()) return;
    this.page.set(p);
    this.loadViews();
  }

  toggleLocationRow(viewId: number): void {
    this.openLocationsPopoverViewId.update(current => current === viewId ? null : viewId);
  }

  @HostListener('document:click')
  closeLocationsPopover(): void {
    this.openLocationsPopoverViewId.set(null);
  }

  backToPrograms(): void {
    this.router.navigate(['/partner', this.tpId, 'customers', this.customerId, 'uniform-programs']);
  }

  goToTree(): void {
    this.router.navigate(['/partner', this.tpId, 'customers', this.customerId, 'uniform-programs', this.programId, 'tree']);
  }

  openCreateModal(): void {
    this.editTarget.set(null);
    this.copySourceView.set(null);
    this.form.set({ viewName: '', description: '', status: 'ACTIVE' });
    this.formError.set(null);
    this.showFormModal.set(true);
  }

  openEditModal(view: CustomerProgramView): void {
    this.editTarget.set(view);
    this.copySourceView.set(null);
    this.form.set({ viewName: view.viewName, description: view.description ?? '', status: view.status });
    this.formError.set(null);
    this.showFormModal.set(true);
  }

  openCopyModal(view: CustomerProgramView): void {
    this.editTarget.set(null);
    this.copySourceView.set(view);
    this.form.set({ viewName: `${view.viewName} (Copy)`, description: view.description ?? '', status: 'ACTIVE' });
    this.formError.set(null);
    this.showFormModal.set(true);
  }

  closeFormModal(): void {
    this.showFormModal.set(false);
    this.editTarget.set(null);
    this.copySourceView.set(null);
  }

  assignLocationsFromForm(): void {
    const target = this.editTarget();
    if (!target) return;
    this.closeFormModal();
    this.openAssignLocationsModal(target);
  }

  async saveForm(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.programId;
    const form = this.form();
    if (!tpId || !custId || !programId) return;
    if (!form.viewName.trim()) {
      this.formError.set('Please enter a name for this view.');
      return;
    }
    this.savingForm.set(true);
    this.formError.set(null);
    try {
      const target = this.editTarget();
      const copySource = this.copySourceView();
      if (target) {
        await this.service.update(tpId, custId, programId, target.viewId, form);
      } else if (copySource) {
        await this.service.copyView(tpId, custId, programId, copySource.viewId, form);
      } else {
        await this.service.create(tpId, custId, programId, form);
      }
      this.closeFormModal();
      await this.loadViews();
    } catch (err) {
      this.formError.set(err instanceof Error ? err.message : 'Failed to save view.');
    } finally {
      this.savingForm.set(false);
    }
  }

  openDeleteModal(view: CustomerProgramView): void {
    this.deleteTarget.set(view);
    this.showDeleteModal.set(true);
  }

  closeDeleteModal(): void {
    this.showDeleteModal.set(false);
    this.deleteTarget.set(null);
  }

  async confirmDelete(): Promise<void> {
    const target = this.deleteTarget();
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.programId;
    if (!target || !tpId || !custId || !programId) return;
    this.deleting.set(true);
    try {
      await this.service.remove(tpId, custId, programId, target.viewId);
      this.showDeleteModal.set(false);
      this.deleteTarget.set(null);
      if (this.views().length === 1 && this.page() > 1) this.page.update(p => p - 1);
      await this.loadViews();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Delete failed.');
      this.closeDeleteModal();
    } finally {
      this.deleting.set(false);
    }
  }

  // ── Assign Locations modal ─────────────────────────────────────────────────

  async openAssignLocationsModal(view: CustomerProgramView): Promise<void> {
    this.assignLocationsView.set(view);
    this.assignLocationsSearch.set('');
    this.assignLocationsError.set(null);
    this.allLocationsForAssign.set([]);
    this.showAssignLocationsModal.set(true);
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.assignLocationsLoading.set(true);
    try {
      this.allLocationsForAssign.set(await this.locationsService.listAll(tpId, custId));
    } catch (err) {
      this.assignLocationsError.set(err instanceof Error ? err.message : 'Failed to load locations.');
    } finally {
      this.assignLocationsLoading.set(false);
    }
  }

  closeAssignLocationsModal(): void {
    this.showAssignLocationsModal.set(false);
    this.assignLocationsView.set(null);
    this.loadViews();
  }

  onAssignLocationsSearchChange(value: string): void {
    if (this.assignLocationsSearchTimer) clearTimeout(this.assignLocationsSearchTimer);
    this.assignLocationsSearchTimer = setTimeout(() => this.assignLocationsSearch.set(value), 200);
  }

  isLocationTogglingView(locId: number): boolean {
    return this.assignLocationsTogglingIds().has(locId);
  }

  async toggleLocationView(loc: CustomerLocation): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const view = this.assignLocationsView();
    if (!tpId || !custId || !view) return;
    if (this.isLocationTogglingView(loc.locId)) return;
    this.assignLocationsTogglingIds.update(set => new Set(set).add(loc.locId));
    this.assignLocationsError.set(null);
    const isCurrentlyThisView = loc.viewId === view.viewId;
    const newViewId = isCurrentlyThisView ? null : view.viewId;
    try {
      await this.locationsService.updateLocationView(tpId, custId, loc.locId, newViewId);
      this.allLocationsForAssign.update(list => list.map(l =>
        l.locId === loc.locId ? { ...l, viewId: newViewId, viewName: newViewId != null ? view.viewName : null } : l
      ));
    } catch (err) {
      this.assignLocationsError.set(err instanceof Error ? err.message : 'Failed to update location.');
    } finally {
      this.assignLocationsTogglingIds.update(set => {
        const next = new Set(set);
        next.delete(loc.locId);
        return next;
      });
    }
  }

  statusBadge(status: string): string {
    return status === 'ACTIVE'
      ? 'badge bg-success-subtle text-success border border-success-subtle'
      : 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
  }

  // ── Selections modal ───────────────────────────────────────────────────────

  async openSelectionsModal(view: CustomerProgramView): Promise<void> {
    this.selectionsView.set(view);
    this.selectionsError.set(null);
    this.treeSearch.set('');
    this.treeCategories.set([]);
    this.directCategoryIds.set(new Set());
    this.directProgProdIds.set(new Set());
    this.expandedIds.set(new Set());
    this.expandedGroupKeys.set(new Set());
    if (this.syncedTimer) clearTimeout(this.syncedTimer);
    this.selectionsSynced.set(false);
    this.showSelectionsModal.set(true);
    await this.loadSelections();
  }

  closeSelectionsModal(): void {
    this.showSelectionsModal.set(false);
    this.selectionsView.set(null);
    if (this.syncedTimer) clearTimeout(this.syncedTimer);
    this.selectionsSynced.set(false);
    this.loadViews();
  }

  assignLocationsFromSelections(): void {
    const view = this.selectionsView();
    if (!view) return;
    this.closeSelectionsModal();
    this.openAssignLocationsModal(view);
  }

  private async loadSelections(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.programId;
    const view = this.selectionsView();
    if (!tpId || !custId || !programId || !view) return;
    this.selectionsLoading.set(true);
    this.selectionsError.set(null);
    try {
      const [tree, selections] = await Promise.all([
        this.programsService.getTree(tpId, custId, programId),
        this.service.getSelections(tpId, custId, programId, view.viewId),
      ]);
      this.treeCategories.set(tree.categories);
      this.buildParentMap(tree.categories);
      this.directCategoryIds.set(new Set(selections.categoryIds));
      this.directProgProdIds.set(new Set(selections.progProdIds));
    } catch (err) {
      this.selectionsError.set(err instanceof Error ? err.message : 'Failed to load view selections.');
    } finally {
      this.selectionsLoading.set(false);
    }
  }

  // Re-fetches just the selection state (not the tree) — used after a bulk
  // *SEL_SEL/*SEL_CLR call to sync local state with the server's result,
  // rather than assuming what "all" resolved to.
  private async refreshSelections(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.programId;
    const view = this.selectionsView();
    if (!tpId || !custId || !programId || !view) return;
    const selections = await this.service.getSelections(tpId, custId, programId, view.viewId);
    this.directCategoryIds.set(new Set(selections.categoryIds));
    this.directProgProdIds.set(new Set(selections.progProdIds));
  }

  async selectAllSelections(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.programId;
    const view = this.selectionsView();
    if (!tpId || !custId || !programId || !view) return;
    this.bulkActionLoading.set(true);
    this.selectionsError.set(null);
    try {
      await this.service.selectAll(tpId, custId, programId, view.viewId);
      await this.refreshSelections();
      this.flashSynced();
    } catch (err) {
      this.selectionsError.set(err instanceof Error ? err.message : 'Failed to select all.');
    } finally {
      this.bulkActionLoading.set(false);
    }
  }

  async clearAllSelections(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.programId;
    const view = this.selectionsView();
    if (!tpId || !custId || !programId || !view) return;
    this.bulkActionLoading.set(true);
    this.selectionsError.set(null);
    try {
      await this.service.clearAll(tpId, custId, programId, view.viewId);
      await this.refreshSelections();
      this.flashSynced();
    } catch (err) {
      this.selectionsError.set(err instanceof Error ? err.message : 'Failed to clear all.');
    } finally {
      this.bulkActionLoading.set(false);
    }
  }

  private buildParentMap(cats: CustomerProgramCategoryNode[]): void {
    this.parentOf.clear();
    const visit = (cat: CustomerProgramCategoryNode) => {
      this.parentOf.set(cat.progCatId, cat.parentProgCatId);
      cat.children.forEach(visit);
    };
    cats.forEach(visit);
  }

  // Walks up from progCatId's parent (or from progCatId itself when
  // startInclusive) and checks any ancestor not already included — used so
  // checking a child category or a SKU also checks its parent chain.
  private async checkAncestors(progCatId: number | null, startInclusive = false): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.programId;
    const view = this.selectionsView();
    if (!tpId || !custId || !programId || !view) return;
    const toAdd: number[] = [];
    let current = startInclusive ? progCatId : (progCatId != null ? this.parentOf.get(progCatId) ?? null : null);
    while (current != null) {
      if (!this.directCategoryIds().has(current)) toAdd.push(current);
      current = this.parentOf.get(current) ?? null;
    }
    if (toAdd.length === 0) return;
    await this.service.addCategory(tpId, custId, programId, view.viewId, toAdd);
    this.directCategoryIds.update(set => {
      const next = new Set(set);
      toAdd.forEach(id => next.add(id));
      return next;
    });
  }

  // Every category id in cat's subtree, not including cat itself.
  private descendantCategoryIds(cat: CustomerProgramCategoryNode): number[] {
    const ids: number[] = [];
    const visit = (node: CustomerProgramCategoryNode) => {
      for (const child of node.children) {
        ids.push(child.progCatId);
        visit(child);
      }
    };
    visit(cat);
    return ids;
  }

  // Every SKU's progProdId in cat's subtree, including cat's own directly
  // attached SKUs (not just descendant categories' SKUs).
  private descendantProgProdIds(cat: CustomerProgramCategoryNode): number[] {
    const ids: number[] = [];
    const visit = (node: CustomerProgramCategoryNode) => {
      for (const sku of node.skus) ids.push(sku.progProdId);
      for (const child of node.children) visit(child);
    };
    visit(cat);
    return ids;
  }

  private allCategoryIds(): number[] {
    const ids: number[] = [];
    const visit = (cat: CustomerProgramCategoryNode) => { ids.push(cat.progCatId); cat.children.forEach(visit); };
    this.treeCategories().forEach(visit);
    return ids;
  }

  private allGroupKeys(): string[] {
    const keys: string[] = [];
    const visit = (cat: CustomerProgramCategoryNode) => {
      const seen = new Set<number>();
      for (const sku of cat.skus) {
        if (seen.has(sku.productPk)) continue;
        seen.add(sku.productPk);
        keys.push(`g${cat.progCatId}-${sku.productPk}`);
      }
      cat.children.forEach(visit);
    };
    this.treeCategories().forEach(visit);
    return keys;
  }

  onTreeSearchChange(value: string): void {
    if (this.treeSearchTimer) clearTimeout(this.treeSearchTimer);
    this.treeSearchTimer = setTimeout(() => this.treeSearch.set(value), 200);
  }

  toggleExpand(progCatId: number): void {
    this.expandedIds.update(set => {
      const next = new Set(set);
      next.has(progCatId) ? next.delete(progCatId) : next.add(progCatId);
      return next;
    });
  }

  toggleGroupExpand(key: string): void {
    this.expandedGroupKeys.update(set => {
      const next = new Set(set);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  expandAllTree(): void {
    this.expandedIds.set(new Set(this.allCategoryIds()));
    this.expandedGroupKeys.set(new Set(this.allGroupKeys()));
  }

  collapseAllTree(): void {
    this.expandedIds.set(new Set());
    this.expandedGroupKeys.set(new Set());
  }

  // ── Inclusion state ───────────────────────────────────────────────────────
  // Every category and SKU is still its own explicit, independently-editable
  // selection (no rolled-up "included via an ancestor category" state, so
  // nothing here is ever disabled) — toggling a category just also writes
  // that same explicit state to everything in its subtree in one action
  // (see toggleCategory()), rather than being computed from it afterward.

  isCategoryIncluded(progCatId: number): boolean {
    return this.directCategoryIds().has(progCatId);
  }

  isSkuIncluded(sku: CustomerProgramSku): boolean {
    return this.directProgProdIds().has(sku.progProdId);
  }

  isToggling(key: string): boolean {
    return this.togglingKeys().has(key);
  }

  // Not itself persisted anywhere — purely a convenience that checks/unchecks
  // every SKU under one product in a single click, reusing the same per-SKU
  // add/remove calls.
  isGroupFullyIncluded(group: ProductGroup): boolean {
    return group.skus.length > 0 && group.skus.every(s => this.isSkuIncluded(s));
  }

  isGroupPartiallyIncluded(group: ProductGroup): boolean {
    const includedCount = group.skus.filter(s => this.isSkuIncluded(s)).length;
    return includedCount > 0 && includedCount < group.skus.length;
  }

  // "n out of x SKUs selected" at the product level.
  groupSkuSelection(group: ProductGroup): { selected: number; total: number } {
    return { selected: group.skus.filter(s => this.isSkuIncluded(s)).length, total: group.skus.length };
  }

  // "n out of x products selected" at the category level — rolled up across
  // this category's whole subtree. A product counts as selected when every
  // one of its SKUs at that placement is included.
  categoryProductSelection(cat: CustomerProgramCategoryNode): { selected: number; total: number } {
    const totalIds = new Set<number>();
    const selectedIds = new Set<number>();
    const visit = (node: CustomerProgramCategoryNode) => {
      const byProduct = new Map<number, CustomerProgramSku[]>();
      for (const sku of node.skus) {
        const list = byProduct.get(sku.productPk) ?? [];
        list.push(sku);
        byProduct.set(sku.productPk, list);
      }
      for (const [productPk, skus] of byProduct) {
        totalIds.add(productPk);
        if (skus.every(s => this.isSkuIncluded(s))) selectedIds.add(productPk);
      }
      node.children.forEach(visit);
    };
    visit(cat);
    return { selected: selectedIds.size, total: totalIds.size };
  }

  async toggleGroupSkus(group: ProductGroup): Promise<void> {
    if (this.isToggling('g' + group.key)) return;
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.programId;
    const view = this.selectionsView();
    if (!tpId || !custId || !programId || !view) return;
    const key = 'g' + group.key;
    this.setToggling(key, true);
    this.selectionsError.set(null);
    const turningOff = this.isGroupFullyIncluded(group);
    if (!turningOff && group.skus.length > 0) {
      this.expandedGroupKeys.update(set => new Set(set).add(group.key));
    }
    try {
      const progProdIds = turningOff
        ? group.skus.filter(s => this.isSkuIncluded(s)).map(s => s.progProdId)
        : group.skus.filter(s => !this.isSkuIncluded(s)).map(s => s.progProdId);
      if (progProdIds.length > 0) {
        if (turningOff) {
          await this.service.removeSku(tpId, custId, programId, view.viewId, progProdIds);
          this.directProgProdIds.update(set => {
            const next = new Set(set);
            progProdIds.forEach(id => next.delete(id));
            return next;
          });
        } else {
          await this.service.addSku(tpId, custId, programId, view.viewId, progProdIds);
          this.directProgProdIds.update(set => {
            const next = new Set(set);
            progProdIds.forEach(id => next.add(id));
            return next;
          });
        }
      }
      if (!turningOff) {
        await this.checkAncestors(group.progCatId, true);
      }
      this.flashSynced();
    } catch (err) {
      this.selectionsError.set(err instanceof Error ? err.message : 'Failed to update selection.');
    } finally {
      this.setToggling(key, false);
    }
  }

  async toggleCategory(cat: CustomerProgramCategoryNode): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.programId;
    const view = this.selectionsView();
    if (!tpId || !custId || !programId || !view) return;
    const key = 'c' + cat.progCatId;
    if (this.isToggling(key)) return;
    this.setToggling(key, true);
    this.selectionsError.set(null);
    try {
      if (this.isCategoryIncluded(cat.progCatId)) {
        // Uncheck cascades down: this category, every descendant category,
        // and every SKU anywhere in the subtree all come off together.
        const descendantCatIds = this.descendantCategoryIds(cat).filter(id => this.directCategoryIds().has(id));
        const descendantSkuIds = this.descendantProgProdIds(cat).filter(id => this.directProgProdIds().has(id));
        const catIdsToRemove = [cat.progCatId, ...descendantCatIds];
        await this.service.removeCategory(tpId, custId, programId, view.viewId, catIdsToRemove);
        if (descendantSkuIds.length > 0) {
          await this.service.removeSku(tpId, custId, programId, view.viewId, descendantSkuIds);
        }
        this.directCategoryIds.update(set => {
          const next = new Set(set);
          catIdsToRemove.forEach(id => next.delete(id));
          return next;
        });
        this.directProgProdIds.update(set => {
          const next = new Set(set);
          descendantSkuIds.forEach(id => next.delete(id));
          return next;
        });
      } else {
        // Check cascades down the same way: this category, every descendant
        // category, and every SKU in the subtree all get included together.
        const descendantCatIds = this.descendantCategoryIds(cat).filter(id => !this.directCategoryIds().has(id));
        const descendantSkuIds = this.descendantProgProdIds(cat).filter(id => !this.directProgProdIds().has(id));
        const catIdsToAdd = [cat.progCatId, ...descendantCatIds];
        await this.service.addCategory(tpId, custId, programId, view.viewId, catIdsToAdd);
        if (descendantSkuIds.length > 0) {
          await this.service.addSku(tpId, custId, programId, view.viewId, descendantSkuIds);
        }
        this.directCategoryIds.update(set => {
          const next = new Set(set);
          catIdsToAdd.forEach(id => next.add(id));
          return next;
        });
        this.directProgProdIds.update(set => {
          const next = new Set(set);
          descendantSkuIds.forEach(id => next.add(id));
          return next;
        });
        // Reveal what just got included — expand only this one level, not
        // the whole subtree (sub-assortments for a parent, product groups
        // for a leaf).
        if (cat.children.length > 0 || cat.skus.length > 0) {
          this.expandedIds.update(set => new Set(set).add(cat.progCatId));
        }
        await this.checkAncestors(cat.progCatId);
      }
      this.flashSynced();
    } catch (err) {
      this.selectionsError.set(err instanceof Error ? err.message : 'Failed to update selection.');
    } finally {
      this.setToggling(key, false);
    }
  }

  async toggleSku(sku: CustomerProgramSku): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const programId = this.programId;
    const view = this.selectionsView();
    if (!tpId || !custId || !programId || !view) return;
    const key = 's' + sku.progProdId;
    if (this.isToggling(key)) return;
    this.setToggling(key, true);
    this.selectionsError.set(null);
    try {
      if (this.isSkuIncluded(sku)) {
        await this.service.removeSku(tpId, custId, programId, view.viewId, [sku.progProdId]);
        this.directProgProdIds.update(set => {
          const next = new Set(set);
          next.delete(sku.progProdId);
          return next;
        });
      } else {
        await this.service.addSku(tpId, custId, programId, view.viewId, [sku.progProdId]);
        this.directProgProdIds.update(set => new Set(set).add(sku.progProdId));
        await this.checkAncestors(sku.progCatId, true);
      }
      this.flashSynced();
    } catch (err) {
      this.selectionsError.set(err instanceof Error ? err.message : 'Failed to update selection.');
    } finally {
      this.setToggling(key, false);
    }
  }

  private setToggling(key: string, value: boolean): void {
    this.togglingKeys.update(set => {
      const next = new Set(set);
      if (value) next.add(key); else next.delete(key);
      return next;
    });
  }

  private flashSynced(): void {
    if (this.syncedTimer) clearTimeout(this.syncedTimer);
    this.selectionsSynced.set(true);
    this.syncedTimer = setTimeout(() => this.selectionsSynced.set(false), 2000);
  }

  truncateTitle(text: string, max = 30): string {
    return text.length > max ? text.slice(0, max) + '…' : text;
  }
}
