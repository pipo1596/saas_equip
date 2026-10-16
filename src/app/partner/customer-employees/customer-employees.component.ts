import { Component, OnInit, HostListener, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerEmployeesService } from './customer-employees.service';
import { CustomerEmployee, ShopAsResult } from './customer-employee.model';
import { DataResidencyRegion } from '../../shared/data-residency.service';
import { ImageUploadService } from '../../shared/image-upload.service';
import { CustomerRolesService } from '../customer-roles/customer-roles.service';
import { CustomerRole } from '../customer-roles/customer-role.model';
import { CustomerEmployeesFilterStateService } from './customer-employees-filter-state.service';

@Component({
  selector: 'app-customer-employees',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './customer-employees.component.html',
})
export class CustomerEmployeesComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly service = inject(CustomerEmployeesService);
  private readonly imageUploadService = inject(ImageUploadService);
  private readonly rolesService = inject(CustomerRolesService);
  private readonly filterState = inject(CustomerEmployeesFilterStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly employees = signal<CustomerEmployee[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly search = signal('');
  readonly roleFilter = signal<number | null>(null);
  readonly hireFrom = signal('');
  readonly hireTo = signal('');
  readonly roleOptions = signal<CustomerRole[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly showDeleteModal = signal(false);
  readonly deleting = signal(false);
  readonly deleteTarget = signal<CustomerEmployee | null>(null);

  readonly showShopAsModal = signal(false);
  readonly shopAsTarget = signal<CustomerEmployee | null>(null);
  readonly shopAsLoading = signal(false);
  readonly shopAsError = signal<string | null>(null);
  readonly shopAsToast = signal<string | null>(null);
  // Set only when the browser blocked window.open() after a successful
  // *SHOPAS call — lets the admin open the already-issued link with one
  // more (manual, so never blocked) click instead of losing it.
  readonly shopAsFallbackUrl = signal<string | null>(null);

  // Only one row's "+N more locations" popover open at a time — a floating
  // panel rather than an inline-expanding row, so it doesn't shift the page
  // layout underneath it when there are many assigned locations.
  readonly openLocationsPopoverEmpId = signal<number | null>(null);

  readonly region = signal<DataResidencyRegion | null>(null);

  readonly csvUploading = signal(false);
  readonly csvInducing = signal(false);
  readonly csvError = signal<string | null>(null);
  readonly csvSuccess = signal(false);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly pageWindow = computed(() => {
    const tp = this.totalPages();
    const p = this.page();
    const start = Math.max(1, Math.min(p - 2, tp - 4));
    const end = Math.min(tp, Math.max(p + 2, 5));
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });

  readonly startRecord = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1
  );

  readonly endRecord = computed(() =>
    Math.min(this.page() * this.pageSize(), this.total())
  );

  readonly hasActiveFilters = computed(() =>
    !!this.search() || this.roleFilter() !== null || !!this.hireFrom() || !!this.hireTo()
  );

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get customerId(): number | null {
    const idParam = this.route.snapshot.paramMap.get('customerId');
    return idParam ? Number(idParam) : null;
  }

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);
    if (custId) this.restoreFilterState(custId);
    if (tpId) this.region.set(await this.service.regionFor(tpId));
    if (tpId && custId) this.loadRoleOptions(tpId, custId);
    this.loadEmployees();
  }

  private restoreFilterState(custId: number): void {
    const saved = this.filterState.get(custId);
    if (!saved) return;
    this.page.set(saved.page);
    this.pageSize.set(saved.pageSize);
    this.search.set(saved.search);
    this.roleFilter.set(saved.roleFilter);
    this.hireFrom.set(saved.hireFrom);
    this.hireTo.set(saved.hireTo);
  }

  private async loadRoleOptions(tpId: number, custId: number): Promise<void> {
    try {
      this.roleOptions.set(await this.rolesService.listAll(tpId, custId));
    } catch { /* non-critical — role filter just shows no options */ }
  }

  // Saves the current filter/page state immediately — called on every
  // filter change (not just once loadEmployees() finishes its debounce), so
  // navigating away a moment after typing a search (e.g. straight to "New
  // Employee" before the 350ms debounce fires) doesn't lose the just-typed
  // text.
  private persistFilterState(): void {
    const custId = this.customerId;
    if (!custId) return;
    this.filterState.set(custId, {
      page: this.page(), pageSize: this.pageSize(), search: this.search(),
      roleFilter: this.roleFilter(), hireFrom: this.hireFrom(), hireTo: this.hireTo(),
    });
  }

  async loadEmployees(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.persistFilterState();
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.service.list(tpId, custId, {
        page: this.page(),
        pageSize: this.pageSize(),
        search: this.search(),
        roleId: this.roleFilter(),
        hireFrom: this.hireFrom(),
        hireTo: this.hireTo(),
      });
      this.employees.set(result.data);
      this.total.set(result.pagination.totalRows);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load employees.');
    } finally {
      this.loading.set(false);
    }
  }

  async onCsvSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const tpId = this.tpId;
    if (!tpId) return;

    this.csvError.set(null);
    this.csvSuccess.set(false);
    this.csvUploading.set(true);

    let csvUrl: string;
    try {
      csvUrl = await this.imageUploadService.upload(
        'employee_csv', file, tpId,
        { tpId, subfolder: 'employee_induction' },
        'employees.csv',
      );
    } catch (err) {
      this.csvError.set(err instanceof Error ? err.message : 'CSV upload failed.');
      this.csvUploading.set(false);
      return;
    }

    this.csvUploading.set(false);
    this.csvInducing.set(true);

    try {
      await this.service.inductFromCsv(tpId, csvUrl);
      this.csvSuccess.set(true);
      setTimeout(() => this.csvSuccess.set(false), 6000);
    } catch (err) {
      this.csvError.set(err instanceof Error ? err.message : 'Employee induction failed.');
    } finally {
      this.csvInducing.set(false);
    }
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    this.persistFilterState();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.page.set(1); this.loadEmployees(); }, 350);
  }

  onRoleFilterChange(value: string): void {
    this.roleFilter.set(value === 'ALL' ? null : Number(value));
    this.page.set(1);
    this.loadEmployees();
  }

  onHireFromChange(value: string): void {
    this.hireFrom.set(value);
    this.page.set(1);
    this.loadEmployees();
  }

  onHireToChange(value: string): void {
    this.hireTo.set(value);
    this.page.set(1);
    this.loadEmployees();
  }

  clearFilters(): void {
    this.search.set('');
    this.roleFilter.set(null);
    this.hireFrom.set('');
    this.hireTo.set('');
    this.page.set(1);
    this.loadEmployees();
  }

  onPageSizeChange(value: string): void {
    this.pageSize.set(Number(value));
    this.page.set(1);
    this.loadEmployees();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.page()) return;
    this.page.set(p);
    this.loadEmployees();
  }

  editEmployee(employee: CustomerEmployee): void {
    this.router.navigate(
      ['/partner', this.tpId, 'customers', this.customerId, 'employees', employee.empId, 'edit'],
      { state: { employee } },
    );
  }

  openAllotment(employee: CustomerEmployee): void {
    this.router.navigate(
      ['/partner', this.tpId, 'customers', this.customerId, 'employees', employee.empId, 'allotment'],
      { state: { employee } },
    );
  }

  openDeleteModal(employee: CustomerEmployee): void {
    this.deleteTarget.set(employee);
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
    if (!target || !tpId || !custId) return;
    this.deleting.set(true);
    try {
      await this.service.remove(tpId, custId, target.empId);
      this.showDeleteModal.set(false);
      this.deleteTarget.set(null);
      if (this.employees().length === 1 && this.page() > 1) this.page.update(p => p - 1);
      await this.loadEmployees();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Delete failed.');
      this.closeDeleteModal();
    } finally {
      this.deleting.set(false);
    }
  }

  // ── Shop as ───────────────────────────────────────────────────────────────

  openShopAsModal(employee: CustomerEmployee): void {
    if (employee.status !== 'ACTIVE') return;
    this.shopAsTarget.set(employee);
    this.shopAsError.set(null);
    this.shopAsFallbackUrl.set(null);
    this.showShopAsModal.set(true);
  }

  closeShopAsModal(): void {
    if (this.shopAsLoading()) return;
    this.shopAsFallbackUrl.set(null);
    this.showShopAsModal.set(false);
    this.shopAsTarget.set(null);
  }

  async confirmShopAs(): Promise<void> {
    const target = this.shopAsTarget();
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!target || !tpId || !custId) return;

    this.shopAsLoading.set(true);
    this.shopAsError.set(null);
    this.shopAsFallbackUrl.set(null);
    try {
      const result: ShopAsResult = await this.service.shopAs(tpId, custId, target.empId);
      if (!result.success || !result.url) {
        this.shopAsError.set(result.message || 'Unable to open the portal.');
        if (result.code === 'NFD') await this.loadEmployees();
        return;
      }
      // Only ever opened once we have a real URL — a blocked attempt here
      // (unlike one opened pre-emptively) means the browser genuinely
      // blocked it, not that we closed a blank tab a moment later.
      const win = window.open(result.url, '_blank', 'noopener');
      if (win) {
        this.showShopAsModal.set(false);
        this.shopAsTarget.set(null);
        this.shopAsToast.set('Portal opened in a new tab.');
        setTimeout(() => this.shopAsToast.set(null), 4000);
      } else {
        // Keep the link available for one manual click — the single-use
        // token hasn't been redeemed yet, just not auto-opened.
        this.shopAsFallbackUrl.set(result.url);
        this.shopAsError.set('Your browser blocked the pop-up. Use the link below to open the portal.');
      }
    } catch (err) {
      this.shopAsError.set(err instanceof Error ? err.message : 'Unable to open the portal.');
    } finally {
      this.shopAsLoading.set(false);
    }
  }

  displayName(employee: CustomerEmployee): string {
    const parts = [employee.firstName, employee.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : '—';
  }

  initials(employee: CustomerEmployee): string {
    const f = employee.firstName?.[0] ?? '';
    const l = employee.lastName?.[0] ?? '';
    return (f + l).toUpperCase() || '?';
  }

  private readonly avatarColors = [
    '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#14b8a6', '#06b6d4', '#3b82f6', '#64748b',
  ];

  avatarColor(employee: CustomerEmployee): string {
    const hash = (employee.empId ?? 0) % this.avatarColors.length;
    return this.avatarColors[hash];
  }

  regionLabel(): string {
    return this.region() === 'CA' ? 'Canada' : 'United States';
  }

  regionCountryShort(): string {
    return this.region() === 'CA' ? 'Canada' : 'USA';
  }

  toggleLocationsPopover(empId: number): void {
    this.openLocationsPopoverEmpId.update(current => current === empId ? null : empId);
  }

  @HostListener('document:click')
  closeLocationsPopover(): void {
    this.openLocationsPopoverEmpId.set(null);
  }

  statusBadgeClass(status: string): string {
    switch (status) {
      case 'ACTIVE': return 'badge bg-success-subtle text-success border border-success-subtle';
      case 'ON-LEAVE': return 'badge bg-warning-subtle text-warning border border-warning-subtle';
      case 'TERMINATED': return 'badge bg-danger-subtle text-danger border border-danger-subtle';
      case 'INACTIVE': return 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
      default: return 'badge bg-light text-dark';
    }
  }
}
