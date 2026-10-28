import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { AuthService } from '../../auth/auth.service';
import { OrdersService, OrderApiError } from './orders.service';
import { OrderDetailContext, OrderDetail, OrderLine, RefundLineInput } from './order.model';

interface RefundLineRow {
  line: OrderLine;
  refundableQty: number;
  qty: number;
}

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './order-detail.component.html',
})
export class OrderDetailComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly auth = inject(AuthService);
  private readonly service = inject(OrdersService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly context = signal<OrderDetailContext | null>(null);
  readonly order = signal<OrderDetail | null>(null);

  readonly showRefundModal = signal(false);
  readonly refundKey = signal('');
  readonly refundReason = signal('');
  readonly refundLines = signal<RefundLineRow[]>([]);
  readonly refundSubmitted = signal(false);
  readonly refundSaving = signal(false);
  readonly refundError = signal<string | null>(null);
  readonly refundSuccessMessage = signal<string | null>(null);

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get orderId(): number | null {
    const p = this.route.snapshot.paramMap.get('orderId');
    return p ? Number(p) : null;
  }

  protected get custId(): number | null {
    const p = this.route.snapshot.paramMap.get('customerId');
    return p ? Number(p) : null;
  }

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.custId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);
    this.loadOrder();
  }

  async loadOrder(): Promise<void> {
    const orderId = this.orderId;
    if (orderId == null) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const result = await this.service.get({ orderId, custId: this.custId ?? undefined });
      this.context.set(result.context);
      this.order.set(result.order);
    } catch (err) {
      if (err instanceof OrderApiError && err.code === 'AUT') {
        this.auth.logout();
        this.router.navigate(['/login']);
        return;
      }
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load order.');
    } finally {
      this.loading.set(false);
    }
  }

  back(): void {
    this.router.navigate(['/partner', this.tpId, 'customers', this.custId, 'orders']);
  }

  canRefund(): boolean {
    const o = this.order();
    return !!o && (o.status === 'SHIPPED' || o.status === 'PARTIALLY_SHIPPED');
  }

  // ── Refund ───────────────────────────────────────────────────────────────

  openRefundModal(): void {
    const o = this.order();
    if (!o) return;
    // A fresh key per dialog open — reused across retries of the same
    // dialog so a timeout/double-click doesn't refund twice.
    this.refundKey.set(crypto.randomUUID());
    this.refundReason.set('');
    this.refundSubmitted.set(false);
    this.refundError.set(null);
    // A line is refundable up to qtyShipped − qtyRefunded; lines with
    // nothing left to refund (or nothing ever shipped) are hidden.
    this.refundLines.set(o.lines
      .map(line => ({ line, refundableQty: Math.max(0, line.qtyShipped - line.qtyRefunded), qty: 0 }))
      .filter(row => row.refundableQty > 0));
    this.showRefundModal.set(true);
  }

  closeRefundModal(): void {
    if (this.refundSaving()) return;
    this.showRefundModal.set(false);
  }

  onRefundQtyChange(row: RefundLineRow, value: string): void {
    const qty = Math.max(0, Math.min(row.refundableQty, parseInt(value, 10) || 0));
    this.refundLines.update(rows => rows.map(r => r === row ? { ...r, qty } : r));
  }

  get refundHasAnyQty(): boolean {
    return this.refundLines().some(r => r.qty > 0);
  }

  async submitRefund(): Promise<void> {
    const o = this.order();
    if (!o) return;
    this.refundSubmitted.set(true);
    if (!this.refundReason().trim() || !this.refundHasAnyQty) return;

    const lines: RefundLineInput[] = this.refundLines()
      .filter(r => r.qty > 0)
      .map(r => ({ lineNo: r.line.lineNo, qty: r.qty }));

    this.refundSaving.set(true);
    this.refundError.set(null);
    try {
      const result = await this.service.refund({
        orderId: o.orderId,
        custId: this.custId ?? undefined,
        refundKey: this.refundKey(),
        reason: this.refundReason().trim(),
        lines,
      });
      this.showRefundModal.set(false);
      this.refundSuccessMessage.set(result.message);
      await this.loadOrder();
    } catch (err) {
      this.refundError.set(err instanceof Error ? err.message : 'Failed to process refund.');
    } finally {
      this.refundSaving.set(false);
    }
  }
}
