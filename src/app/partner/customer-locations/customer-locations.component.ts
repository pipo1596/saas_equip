import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerLocationsService } from './customer-locations.service';
import { CustomerLocation } from './customer-location.model';
import { CustomerEmployeesService } from '../customer-employees/customer-employees.service';
import { CustomerEmployee } from '../customer-employees/customer-employee.model';
import { CustomerRolesService } from '../customer-roles/customer-roles.service';
import { CustomerRole } from '../customer-roles/customer-role.model';

interface LocationRow extends CustomerLocation {
  level: number;
}

type TypeFilter = 'ALL' | 'REGION' | 'STATION' | 'DEPOT' | 'DEPARTMENT' | 'BRANCH';
type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

@Component({
  selector: 'app-customer-locations',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './customer-locations.component.html',
})
export class CustomerLocationsComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly service = inject(CustomerLocationsService);
  private readonly employeesService = inject(CustomerEmployeesService);
  private readonly rolesService = inject(CustomerRolesService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly locations = signal<CustomerLocation[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly search = signal('');
  readonly typeFilter = signal<TypeFilter>('ALL');
  readonly statusFilter = signal<StatusFilter>('ALL');
  readonly expandedIds = signal<Set<number>>(new Set());

  readonly showDeleteModal = signal(false);
  readonly deleting = signal(false);
  readonly deleteTarget = signal<CustomerLocation | null>(null);

  readonly showAssignModal = signal(false);
  readonly assignTarget = signal<CustomerLocation | null>(null);
  readonly loadingEmployees = signal(false);
  readonly savingAssignments = signal(false);
  readonly assignError = signal<string | null>(null);
  readonly allEmployees = signal<CustomerEmployee[]>([]);
  readonly roleOptions = signal<CustomerRole[]>([]);
  readonly assignedIds = signal<Set<number>>(new Set());
  readonly assignSearch = signal('');
  readonly assignRoleFilter = signal('ALL');
  readonly assignStatusFilter = signal<'ALL' | 'ASSIGNED' | 'UNASSIGNED'>('ASSIGNED');

  private assignSearchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private employeesPromise: Promise<void> | null = null;
  private rolesPromise: Promise<void> | null = null;

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get customerId(): number | null {
    const idParam = this.route.snapshot.paramMap.get('customerId');
    return idParam ? Number(idParam) : null;
  }

  readonly filtered = computed(() => {
    const type = this.typeFilter();
    const status = this.statusFilter();
    const term = this.search().trim().toLowerCase();
    return this.locations().filter(loc => {
      if (type !== 'ALL' && loc.locType !== type) return false;
      if (status !== 'ALL' && loc.status !== status) return false;
      if (term && !(
        loc.locName.toLowerCase().includes(term) ||
        loc.locCode.toLowerCase().includes(term) ||
        loc.city.toLowerCase().includes(term)
      )) return false;
      return true;
    });
  });

  readonly hasChildrenSet = computed(() => {
    const s = new Set<number>();
    for (const loc of this.filtered()) {
      if (loc.parentId != null) s.add(loc.parentId);
    }
    return s;
  });

  readonly flatTree = computed(() =>
    this.search() || this.typeFilter() !== 'ALL' || this.statusFilter() !== 'ALL'
      ? this.buildFlatTree(this.filtered(), null)
      : this.buildFlatTree(this.filtered(), this.expandedIds())
  );

  readonly regionCount = computed(() => this.locations().filter(l => l.locType === 'REGION').length);
  readonly siteCount = computed(() => this.locations().filter(l => l.locType !== 'REGION').length);
  readonly employeeTotal = computed(() =>
    this.locations().reduce((sum, l) => sum + (l.employeeCount ?? 0), 0)
  );

  readonly filteredAssignEmployees = computed(() => {
    const term = this.assignSearch().trim().toLowerCase();
    const role = this.assignRoleFilter();
    const status = this.assignStatusFilter();
    const assignedIds = this.assignedIds();
    return this.allEmployees().filter(emp => {
      if (role !== 'ALL' && String(emp.roleId ?? '') !== role) return false;
      if (status === 'ASSIGNED' && !assignedIds.has(emp.empId)) return false;
      if (status === 'UNASSIGNED' && assignedIds.has(emp.empId)) return false;
      if (term) {
        const name = `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.toLowerCase();
        if (!name.includes(term) && !emp.emailAddress.toLowerCase().includes(term)) return false;
      }
      return true;
    });
  });

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);
    this.loadLocations();
    this.prefetchEmployees();
    this.prefetchRoles();
  }

  private prefetchEmployees(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return Promise.resolve();
    if (!this.employeesPromise) {
      this.employeesPromise = this.employeesService.listAll(tpId, custId)
        .then(employees => { this.allEmployees.set(employees); })
        .catch(() => { this.employeesPromise = null; });
    }
    return this.employeesPromise;
  }

  private prefetchRoles(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return Promise.resolve();
    if (!this.rolesPromise) {
      this.rolesPromise = this.rolesService.listAll(tpId, custId)
        .then(roles => { this.roleOptions.set(roles); })
        .catch(() => { this.rolesPromise = null; });
    }
    return this.rolesPromise;
  }

  async loadLocations(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      this.locations.set(await this.service.listAll(tpId, custId));
      this.expandAll();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load locations.');
    } finally {
      this.loading.set(false);
    }
  }

  onSearchChange(value: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.search.set(value), 200);
  }

  clearFilters(): void {
    this.search.set('');
    this.typeFilter.set('ALL');
    this.statusFilter.set('ALL');
  }

  toggleExpand(locId: number): void {
    this.expandedIds.update(set => {
      const next = new Set(set);
      next.has(locId) ? next.delete(locId) : next.add(locId);
      return next;
    });
  }

  collapseAll(): void {
    this.expandedIds.set(new Set());
  }

  expandAll(): void {
    this.expandedIds.set(new Set(this.locations().map(l => l.locId)));
  }

  buildFlatTree(locs: CustomerLocation[], expandedIds: Set<number> | null): LocationRow[] {
    const map = new Map<number, LocationRow>(
      locs.map(l => [l.locId, { ...l, level: 0 }])
    );

    for (const loc of map.values()) {
      if (!loc.parentId || !map.has(loc.parentId)) loc.level = 0;
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const loc of map.values()) {
        if (loc.parentId && map.has(loc.parentId)) {
          const parentLevel = map.get(loc.parentId)!.level;
          if (loc.level !== parentLevel + 1) {
            loc.level = parentLevel + 1;
            changed = true;
          }
        }
      }
    }

    const result: LocationRow[] = [];
    const visited = new Set<number>();

    const visit = (locId: number) => {
      if (visited.has(locId)) return;
      const node = map.get(locId);
      if (!node) return;
      visited.add(locId);
      result.push(node);
      if (!expandedIds || expandedIds.has(locId)) {
        for (const child of map.values()) {
          if (child.parentId === locId) visit(child.locId);
        }
      }
    };

    for (const loc of map.values()) {
      if (!loc.parentId || !map.has(loc.parentId)) visit(loc.locId);
    }
    // Show true orphans only (parent not present in this data set at all) —
    // a child whose parent exists but is simply collapsed must stay hidden,
    // not get appended here.
    for (const loc of map.values()) {
      if (!visited.has(loc.locId) && loc.parentId != null && !map.has(loc.parentId)) {
        result.push(loc);
      }
    }
    return result;
  }

  newLocation(): void {
    this.router.navigate(['/partner', this.tpId, 'customers', this.customerId, 'locations', 'new']);
  }

  addChildLocation(parent: CustomerLocation): void {
    this.router.navigate(['/partner', this.tpId, 'customers', this.customerId, 'locations', 'new'], {
      state: { parentId: parent.locId },
    });
  }

  editLocation(location: CustomerLocation): void {
    this.router.navigate(
      ['/partner', this.tpId, 'customers', this.customerId, 'locations', location.locId, 'edit'],
      { state: { location } },
    );
  }

  openDeleteModal(location: CustomerLocation): void {
    this.deleteTarget.set(location);
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
      await this.service.remove(tpId, custId, target.locId);
      this.showDeleteModal.set(false);
      this.deleteTarget.set(null);
      await this.loadLocations();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Delete failed.');
      this.closeDeleteModal();
    } finally {
      this.deleting.set(false);
    }
  }

  async openAssignModal(location: CustomerLocation): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.assignTarget.set(location);
    this.assignSearch.set('');
    this.assignRoleFilter.set('ALL');
    this.assignStatusFilter.set('ASSIGNED');
    this.assignError.set(null);
    this.showAssignModal.set(true);
    this.loadingEmployees.set(true);
    try {
      const [, , assignedEmpIds] = await Promise.all([
        this.prefetchEmployees(),
        this.prefetchRoles(),
        this.service.getAssignedEmployeeIds(tpId, custId, location.locId),
      ]);
      this.assignedIds.set(new Set(assignedEmpIds));
    } catch (err) {
      this.assignError.set(err instanceof Error ? err.message : 'Failed to load employees.');
    } finally {
      this.loadingEmployees.set(false);
    }
  }

  closeAssignModal(): void {
    this.showAssignModal.set(false);
    this.assignTarget.set(null);
    this.assignedIds.set(new Set());
  }

  onAssignSearchChange(value: string): void {
    if (this.assignSearchTimer) clearTimeout(this.assignSearchTimer);
    this.assignSearchTimer = setTimeout(() => this.assignSearch.set(value), 200);
  }

  clearAssignFilters(): void {
    this.assignSearch.set('');
    this.assignRoleFilter.set('ALL');
    this.assignStatusFilter.set('ASSIGNED');
  }

  toggleAssign(empId: number): void {
    this.assignedIds.update(set => {
      const next = new Set(set);
      next.has(empId) ? next.delete(empId) : next.add(empId);
      return next;
    });
  }

  employeeName(emp: CustomerEmployee): string {
    const parts = [emp.firstName, emp.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : emp.emailAddress;
  }

  employeeSubtitle(emp: CustomerEmployee): string {
    return [emp.role, emp.empRank, emp.emailAddress].filter(Boolean).join(' · ');
  }

  async saveAssignments(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const target = this.assignTarget();
    if (!tpId || !custId || !target) return;

    this.savingAssignments.set(true);
    this.assignError.set(null);
    try {
      await this.service.assignEmployees(tpId, custId, target.locId, Array.from(this.assignedIds()));
      this.closeAssignModal();
      await this.loadLocations();
    } catch (err) {
      this.assignError.set(err instanceof Error ? err.message : 'Failed to save assignments.');
    } finally {
      this.savingAssignments.set(false);
    }
  }

  typeBadge(type: string): string {
    switch (type) {
      case 'REGION': return 'badge bg-primary-subtle text-primary border border-primary-subtle';
      case 'STATION': return 'badge bg-success-subtle text-success border border-success-subtle';
      case 'DEPOT': return 'badge bg-info-subtle text-info border border-info-subtle';
      case 'DEPARTMENT': return 'badge bg-warning-subtle text-warning border border-warning-subtle';
      case 'BRANCH': return 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
      default: return 'badge bg-light text-dark';
    }
  }

  typeIcon(type: string): string {
    switch (type) {
      case 'REGION': return 'bi bi-map';
      case 'STATION': return 'bi bi-building';
      case 'DEPOT': return 'bi bi-house-gear';
      case 'DEPARTMENT': return 'bi bi-diagram-3';
      case 'BRANCH': return 'bi bi-signpost-split';
      default: return 'bi bi-geo-alt';
    }
  }

  canDelete(location: CustomerLocation): boolean {
    return !this.hasChildrenSet().has(location.locId) && !(location.employeeCount ?? 0);
  }

  deleteTitle(location: CustomerLocation): string {
    if (this.hasChildrenSet().has(location.locId)) return 'Cannot delete — has child locations';
    if (location.employeeCount ?? 0) return 'Cannot delete — has employees assigned';
    return 'Delete';
  }

  statusBadge(status: string): string {
    return status === 'ACTIVE'
      ? 'badge bg-success-subtle text-success border border-success-subtle'
      : 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
  }
}
