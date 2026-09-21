import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerRolesService } from './customer-roles.service';
import { CustomerRole, CustomerRoleForm } from './customer-role.model';

interface RoleForm {
  roleName: string;
  accessLevel: 'EMPLOYEE' | 'APPROVER' | 'ADMIN';
  // Not shown in this form anymore (allotment is fully managed via the
  // role's Allotment Rules tab) — always carried through as-is so saving
  // here never blanks out a role's existing allotment type.
  allotmentType: 'NONE' | 'DOLLAR' | 'POINT' | 'ITEM' | 'COMBO';
  description: string;
  isActive: 'Y' | 'N';
  canOrderSelf: 'Y' | 'N';
  canApprove: 'Y' | 'N';
  canShopForOthers: 'Y' | 'N';
  canManageTeamBalances: 'Y' | 'N';
}

const BLANK_FORM: RoleForm = {
  roleName: '', accessLevel: 'EMPLOYEE', allotmentType: 'NONE', description: '', isActive: 'Y',
  canOrderSelf: 'Y', canApprove: 'N', canShopForOthers: 'N', canManageTeamBalances: 'N',
};

@Component({
  selector: 'app-customer-roles',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './customer-roles.component.html',
})
export class CustomerRolesComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly service = inject(CustomerRolesService);
  private readonly route = inject(ActivatedRoute);

  readonly roles = signal<CustomerRole[]>([]);
  readonly roleEmployeeCounts = signal<Record<number, number>>({});
  readonly total = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly search = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly showFormModal = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly submitted = signal(false);

  readonly showDeleteModal = signal(false);
  readonly deleting = signal(false);
  readonly deleteTarget = signal<CustomerRole | null>(null);

  form: RoleForm = { ...BLANK_FORM };

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
    this.loadRoles();
    this.loadRoleEmployeeCounts();
  }

  async loadRoleEmployeeCounts(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    try {
      this.roleEmployeeCounts.set(await this.service.getRoleEmployeeCounts(tpId, custId));
    } catch {
      // Non-critical — the column just falls back to 0 for every role.
    }
  }

  employeeCountFor(roleId: number): number {
    return this.roleEmployeeCounts()[roleId] ?? 0;
  }

  async loadRoles(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.service.list(tpId, custId, {
        page: this.page(),
        pageSize: this.pageSize(),
        search: this.search(),
      });
      this.roles.set(result.data);
      this.total.set(result.pagination.totalRows);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load roles.');
    } finally {
      this.loading.set(false);
    }
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.page.set(1); this.loadRoles(); }, 350);
  }

  onPageSizeChange(value: string): void {
    this.pageSize.set(Number(value));
    this.page.set(1);
    this.loadRoles();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.page()) return;
    this.page.set(p);
    this.loadRoles();
  }

  openAddModal(): void {
    this.editingId.set(null);
    this.form = { ...BLANK_FORM };
    this.saveError.set(null);
    this.submitted.set(false);
    this.showFormModal.set(true);
  }

  openEditModal(role: CustomerRole): void {
    this.editingId.set(role.roleId);
    this.form = {
      roleName:      role.roleName,
      accessLevel:   role.accessLevel,
      allotmentType: role.allotmentType,
      description:   role.description ?? '',
      isActive:      role.isActive,
      // Carried through even though this modal doesn't show them — a save
      // here must not blank out permissions set on the role detail page.
      canOrderSelf:          role.canOrderSelf,
      canApprove:            role.canApprove,
      canShopForOthers:      role.canShopForOthers,
      canManageTeamBalances: role.canManageTeamBalances,
    };
    this.saveError.set(null);
    this.submitted.set(false);
    this.showFormModal.set(true);
  }

  closeFormModal(): void {
    this.showFormModal.set(false);
  }

  async saveRole(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.submitted.set(true);
    if (!this.form.roleName) return;

    this.saving.set(true);
    this.saveError.set(null);
    try {
      const payload: CustomerRoleForm = { ...this.form };
      const id = this.editingId();
      if (id === null) {
        await this.service.create(tpId, custId, payload);
      } else {
        await this.service.update(tpId, custId, id, payload);
      }
      this.showFormModal.set(false);
      await this.loadRoles();
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : 'Failed to save role.');
    } finally {
      this.saving.set(false);
    }
  }

  openDeleteModal(role: CustomerRole): void {
    this.deleteTarget.set(role);
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
      await this.service.remove(tpId, custId, target.roleId);
      this.showDeleteModal.set(false);
      this.deleteTarget.set(null);
      if (this.roles().length === 1 && this.page() > 1) this.page.update(p => p - 1);
      await this.loadRoles();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Delete failed.');
      this.closeDeleteModal();
    } finally {
      this.deleting.set(false);
    }
  }

  accessLevelBadge(level: string): string {
    switch (level) {
      case 'ADMIN': return 'badge border border-primary-subtle text-primary bg-primary-subtle';
      case 'APPROVER': return 'badge border border-info-subtle text-info bg-info-subtle';
      default: return 'badge border bg-light text-dark';
    }
  }

  statusBadge(active: string): string {
    return active === 'Y'
      ? 'badge bg-success-subtle text-success border border-success-subtle'
      : 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
  }
}
