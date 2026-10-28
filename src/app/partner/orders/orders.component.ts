import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe } from '@angular/common';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { AuthService } from '../../auth/auth.service';
import { OrdersService, OrderApiError } from './orders.service';
import {
  OrderListItem, OrdersListResponse, OrderStatus, OrderFulfilmentFilter, OrderDatePreset, OrderSort,
} from './order.model';

type StatusTab = 'ALL' | OrderStatus;

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [FormsModule, RouterModule, CurrencyPipe],
  templateUrl: './orders.component.html',
})
export class OrdersComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly auth = inject(AuthService);
  private readonly service = inject(OrdersService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // ── Orders grid ──────────────────────────────────────────────────────────
  readonly listResponse = signal<OrdersListResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly statusTab = signal<StatusTab>('ALL');
  readonly search = signal('');
  readonly fulfilment = signal<OrderFulfilmentFilter>('');
  readonly datePreset = signal<OrderDatePreset>('');
  readonly dateFrom = signal('');
  readonly dateTo = signal('');
  readonly sort = signal<OrderSort>('NEWEST');
  readonly page = signal(1);
  readonly pageSize = signal(25);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

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

  readonly statusCounts = computed(() => this.listResponse()?.statusCounts ?? {
    all: 0, PENDING_APPROVAL: 0, PROCESSING: 0, PARTIALLY_SHIPPED: 0, SHIPPED: 0, CANCELLED: 0, REJECTED: 0,
  });

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
    this.loadOrders();
  }

  // ── Orders grid ──────────────────────────────────────────────────────────

  async loadOrders(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.service.list({
        tpId, custId,
        search: this.search(),
        status: this.statusTab() === 'ALL' ? 'ALL' : this.statusTab(),
        fulfilment: this.fulfilment(),
        datePreset: this.datePreset(),
        dateFrom: this.datePreset() ? '' : this.dateFrom(),
        dateTo: this.datePreset() ? '' : this.dateTo(),
        sort: this.sort(),
        page: this.page(),
        pageSize: this.pageSize(),
      });
      this.listResponse.set(result);
      // The server echoes what it actually applied — including turning a
      // preset into explicit dates — so the inputs reflect the real filter.
      this.dateFrom.set(result.filters.dateFrom ?? '');
      this.dateTo.set(result.filters.dateTo ?? '');
    } catch (err) {
      this.handleError(err, 'Failed to load orders.');
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

  setStatusTab(tab: StatusTab): void {
    this.statusTab.set(tab);
    this.page.set(1);
    this.loadOrders();
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.page.set(1); this.loadOrders(); }, 350);
  }

  onFulfilmentChange(value: string): void {
    this.fulfilment.set(value as OrderFulfilmentFilter);
    this.page.set(1);
    this.loadOrders();
  }

  onDatePresetChange(value: string): void {
    this.datePreset.set(value as OrderDatePreset);
    if (value) {
      this.dateFrom.set('');
      this.dateTo.set('');
    }
    this.page.set(1);
    this.loadOrders();
  }

  onDateFromChange(value: string): void {
    this.dateFrom.set(value);
    this.datePreset.set('');
    this.page.set(1);
    this.loadOrders();
  }

  onDateToChange(value: string): void {
    this.dateTo.set(value);
    this.datePreset.set('');
    this.page.set(1);
    this.loadOrders();
  }

  onSortChange(value: string): void {
    this.sort.set(value as OrderSort);
    this.loadOrders();
  }

  onPageSizeChange(value: string): void {
    this.pageSize.set(Number(value));
    this.page.set(1);
    this.loadOrders();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.page()) return;
    this.page.set(p);
    this.loadOrders();
  }

  clearFilters(): void {
    this.statusTab.set('ALL');
    this.search.set('');
    this.fulfilment.set('');
    this.datePreset.set('');
    this.dateFrom.set('');
    this.dateTo.set('');
    this.sort.set('NEWEST');
    this.page.set(1);
    this.loadOrders();
  }

  openOrder(order: OrderListItem): void {
    this.router.navigate(['/partner', this.tpId, 'customers', this.customerId, 'orders', order.orderId]);
  }

  canRefund(order: OrderListItem): boolean {
    return order.status === 'SHIPPED' || order.status === 'PARTIALLY_SHIPPED';
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'PENDING_APPROVAL': return 'Pending Approval';
      case 'PROCESSING': return 'Processing';
      case 'PARTIALLY_SHIPPED': return 'Partially Shipped';
      case 'SHIPPED': return 'Shipped';
      case 'CANCELLED': return 'Cancelled';
      case 'REJECTED': return 'Rejected';
      default: return status;
    }
  }

  statusBadge(status: string): string {
    switch (status) {
      case 'SHIPPED': return 'badge bg-success-subtle text-success border border-success-subtle';
      case 'PARTIALLY_SHIPPED': return 'badge bg-info-subtle text-info-emphasis border border-info-subtle';
      case 'PROCESSING': return 'badge bg-warning-subtle text-warning-emphasis border border-warning-subtle';
      case 'PENDING_APPROVAL': return 'badge bg-warning-subtle text-warning-emphasis border border-warning-subtle';
      case 'CANCELLED': return 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
      case 'REJECTED': return 'badge bg-danger-subtle text-danger border border-danger-subtle';
      default: return 'badge bg-light text-dark border';
    }
  }

  fulfilmentLabel(order: OrderListItem): string {
    if (order.fulfilment.sentTs) return 'Sent';
    if (order.fulfilment.lastError) return 'Failed';
    return 'Not sent';
  }

  fulfilmentBadge(order: OrderListItem): string {
    if (order.fulfilment.sentTs) return 'badge bg-success-subtle text-success border border-success-subtle';
    if (order.fulfilment.lastError) return 'badge bg-danger-subtle text-danger border border-danger-subtle';
    return 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
  }

  awaitingApprovalLabel(order: OrderListItem): string | null {
    const a = order.awaitingApprovalFrom;
    if (!a.kind) return null;
    if (a.kind === 'OVERRIDE') return 'Awaiting override approval';
    return `Awaiting Level ${a.levelNo}${a.roleNames ? ' · ' + a.roleNames : ''}`;
  }

  placedByLabel(order: OrderListItem): string {
    const p = order.placedBy;
    return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || '—';
  }

  amountSummary(order: OrderListItem): string {
    const parts: string[] = [];
    if (order.allotDollarsUsed > 0) parts.push(`$${order.allotDollarsUsed.toFixed(2)}`);
    if (order.allotPointsUsed > 0) parts.push(`${order.allotPointsUsed} pts`);
    if (order.allotUnitsUsed > 0) parts.push(`${order.allotUnitsUsed} unit${order.allotUnitsUsed === 1 ? '' : 's'}`);
    if (order.ccOverageAmt > 0) parts.push(`$${order.ccOverageAmt.toFixed(2)} card`);
    return parts.length ? parts.join(' + ') : '—';
  }

  formatDate(ts: string): string {
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}
