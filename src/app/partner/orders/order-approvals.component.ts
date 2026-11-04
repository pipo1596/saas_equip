import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe } from '@angular/common';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { AuthService } from '../../auth/auth.service';
import { OrdersService, OrderApiError } from './orders.service';
import { AdminApprovalQueueResponse, AdminQueueRow } from './order-approval.model';
import { CustomerLocationsService } from '../customer-locations/customer-locations.service';
import { CustomerLocation } from '../customer-locations/customer-location.model';
import { CustomerEmployeesService } from '../customer-employees/customer-employees.service';
import { CustomerEmployee } from '../customer-employees/customer-employee.model';

type DecisionAction = 'APPROVE' | 'REJECT';

@Component({
  selector: 'app-order-approvals',
  standalone: true,
  imports: [FormsModule, RouterModule, CurrencyPipe],
  templateUrl: './order-approvals.component.html',
})
export class OrderApprovalsComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly auth = inject(AuthService);
  private readonly service = inject(OrdersService);
  private readonly locationsService = inject(CustomerLocationsService);
  private readonly employeesService = inject(CustomerEmployeesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly listResponse = signal<AdminApprovalQueueResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly search = signal('');
  readonly locationId = signal<number | null>(null);
  readonly employeeId = signal<number | null>(null);
  readonly page = signal(1);
  readonly pageSize = signal(25);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly locations = signal<CustomerLocation[]>([]);
  readonly employees = signal<CustomerEmployee[]>([]);

  readonly showDecisionModal = signal(false);
  readonly decisionAction = signal<DecisionAction>('APPROVE');
  readonly decisionTarget = signal<AdminQueueRow | null>(null);
  readonly decisionNotes = signal('');
  readonly decisionSubmitted = signal(false);
  readonly decisionSaving = signal(false);
  readonly decisionError = signal<string | null>(null);

  readonly total = computed(() => this.listResponse()?.pagination.totalRows ?? 0);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly pageWindow = computed(() => {
    const tp = this.totalPages();
    const p = this.page();
    const start = Math.max(1, Math.min(p - 2, tp - 4));
    const end = Math.min(tp, Math.max(p + 2, 5));
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });

  readonly startRecord = computed(() => this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1);
  readonly endRecord = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get customerId(): number | null {
    const p = this.route.snapshot.paramMap.get('customerId');
    return p ? Number(p) : null;
  }

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);
    this.loadFilterOptions();
    this.loadQueue();
  }

  private async loadFilterOptions(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    try {
      this.locations.set(await this.locationsService.listAll(tpId, custId));
    } catch { /* non-critical */ }
    try {
      this.employees.set(await this.employeesService.listAll(tpId, custId));
    } catch { /* non-critical */ }
  }

  async loadQueue(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.service.approvalQueue({
        tpId, custId,
        locationId: this.locationId() ?? undefined,
        employeeId: this.employeeId() ?? undefined,
        search: this.search(),
        page: this.page(),
        pageSize: this.pageSize(),
      });
      this.listResponse.set(result);
    } catch (err) {
      this.handleError(err, 'Failed to load the approval queue.');
    } finally {
      this.loading.set(false);
    }
  }

  private handleError(err: unknown, fallback: string): void {
    if (err instanceof OrderApiError && err.code === 'AUT') {
      this.auth.logout();
      this.router.navigate(['/login']);
      return;
    }
    this.error.set(err instanceof Error ? err.message : fallback);
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.page.set(1); this.loadQueue(); }, 350);
  }

  onLocationFilterChange(value: number | null): void {
    this.locationId.set(value);
    this.page.set(1);
    this.loadQueue();
  }

  onEmployeeFilterChange(value: number | null): void {
    this.employeeId.set(value);
    this.page.set(1);
    this.loadQueue();
  }

  clearFilters(): void {
    this.search.set('');
    this.locationId.set(null);
    this.employeeId.set(null);
    this.page.set(1);
    this.loadQueue();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.page()) return;
    this.page.set(p);
    this.loadQueue();
  }

  openOrder(row: AdminQueueRow): void {
    this.router.navigate(['/partner', this.tpId, 'customers', this.customerId, 'orders', row.orderId], {
      queryParams: { from: 'approvals' },
    });
  }

  employeeName(emp: CustomerEmployee): string {
    const parts = [emp.firstName, emp.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : emp.emailAddress;
  }

  waitingOnLabel(row: AdminQueueRow): string {
    const step = row.approvalStep;
    if (!step.kind) return 'No approval step';
    if (step.kind === 'OVERRIDE') return 'Waiting on an administrator';
    return `Waiting on ${step.roleNames || 'Level ' + step.levelNo}${step.roleNames ? ' (level ' + step.levelNo + ')' : ''}`;
  }

  placedByLabel(row: AdminQueueRow): string {
    const p = row.placedBy;
    return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || '—';
  }

  amountSummary(row: AdminQueueRow): string {
    const parts: string[] = [];
    if ((row.allotDollarsUsed ?? 0) > 0) parts.push(`$${row.allotDollarsUsed!.toFixed(2)}`);
    if ((row.allotPointsUsed ?? 0) > 0) parts.push(`${row.allotPointsUsed} pts`);
    if ((row.allotUnitsUsed ?? 0) > 0) parts.push(`${row.allotUnitsUsed} unit${row.allotUnitsUsed === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' + ') : '—';
  }

  formatDate(ts: string | null): string {
    if (!ts) return '—';
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // ── Approve / Reject ────────────────────────────────────────────────────

  openDecisionModal(row: AdminQueueRow, action: DecisionAction): void {
    this.decisionTarget.set(row);
    this.decisionAction.set(action);
    this.decisionNotes.set('');
    this.decisionSubmitted.set(false);
    this.decisionError.set(null);
    this.showDecisionModal.set(true);
  }

  closeDecisionModal(): void {
    if (this.decisionSaving()) return;
    this.showDecisionModal.set(false);
  }

  async confirmDecision(): Promise<void> {
    const target = this.decisionTarget();
    const tpId = this.tpId;
    const custId = this.customerId;
    this.decisionSubmitted.set(true);
    if (!target || !tpId || !custId) return;
    const notes = this.decisionNotes().trim();
    if (!notes) return;

    this.decisionSaving.set(true);
    this.decisionError.set(null);
    try {
      const request = { orderId: target.orderId, custId, notes };
      const result = this.decisionAction() === 'APPROVE'
        ? await this.service.approve(request)
        : await this.service.reject(request);
      this.showDecisionModal.set(false);
      this.successMessage.set(result.message);
      this.listResponse.update(r => r ? {
        ...r,
        data: r.data.filter(row => row.orderId !== target.orderId),
        pagination: { ...r.pagination, totalRows: Math.max(0, r.pagination.totalRows - 1) },
      } : r);
    } catch (err) {
      if (err instanceof OrderApiError && err.code === 'AUT') {
        this.auth.logout();
        this.router.navigate(['/login']);
        return;
      }
      this.decisionError.set(err instanceof Error ? err.message : 'Failed to record the decision.');
      await this.loadQueue();
    } finally {
      this.decisionSaving.set(false);
    }
  }
}
