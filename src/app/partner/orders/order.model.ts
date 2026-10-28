export type OrderStatus = 'PENDING_APPROVAL' | 'PROCESSING' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'CANCELLED' | 'REJECTED';
export type OrderFulfilmentFilter = 'ALL' | 'SENT' | 'NOT_SENT' | 'FAILED' | '';
export type OrderDatePreset = 'ALL' | 'LAST30' | 'LAST90' | 'CUSTOM' | '';
export type OrderSort = 'NEWEST' | 'OLDEST';

// Only custId is required — every other field narrows the *LIST result.
export interface OrderListFilters {
  tpId?: number;
  custId: number;
  locationId?: number | null;
  employeeId?: number | null;
  search?: string;
  status?: OrderStatus | 'ALL' | '';
  fulfilment?: OrderFulfilmentFilter;
  dateFrom?: string;
  dateTo?: string;
  datePreset?: OrderDatePreset;
  sort?: OrderSort;
  page?: number;
  pageSize?: number;
}

export interface OrderTenantPartnerRef { tpId: number; name: string }
export interface OrderCustomerRef { custId: number; name: string; number: string }
export interface OrderLocationRef { locationId: number; code: string; name: string }

// Entered at checkout — not the employee's current profile, which may since
// have changed name/email.
export interface OrderPlacedBy {
  employeeId: number;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface OrderFulfilmentInfo {
  sentTs: string | null;
  attempts: number;
  lastError: string | null;
}

// Filled only for orders waiting on an approval step.
export interface OrderAwaitingApproval {
  kind: 'LEVEL' | 'OVERRIDE' | null;
  levelNo: number | null;
  roleNames: string | null;
}

export interface OrderListItem {
  orderId: number;
  orderNumber: string;
  status: OrderStatus;
  placedTs: string;
  tenantPartner: OrderTenantPartnerRef;
  customer: OrderCustomerRef;
  location: OrderLocationRef;
  placedBy: OrderPlacedBy;
  itemCount: number;
  lineCount: number;
  currency: string;
  orderTotal: number;
  subtotalPoints: number;
  allotDollarsUsed: number;
  allotPointsUsed: number;
  allotUnitsUsed: number;
  ccOverageAmt: number;
  shipMethodName: string;
  trackingCount: number;
  fulfilment: OrderFulfilmentInfo;
  awaitingApprovalFrom: OrderAwaitingApproval;
}

// statusCounts applies every filter except `status` itself, so each chip
// shows what it would return if selected; `all` backs the "All" chip.
export interface OrderStatusCounts {
  all: number;
  PENDING_APPROVAL: number;
  PROCESSING: number;
  PARTIALLY_SHIPPED: number;
  SHIPPED: number;
  CANCELLED: number;
  REJECTED: number;
}

// Echoes what the server actually applied — after a datePreset, dateFrom/
// dateTo come back filled in so the date inputs can display them; datePreset
// comes back CUSTOM when explicit dates were used instead of a preset.
export interface OrderListAppliedFilters {
  scope: 'L1' | 'L2';
  tpId: number;
  custId: number;
  locationId: number | null;
  employeeId: number | null;
  search: string | null;
  status: string;
  fulfilment: string;
  dateFrom: string | null;
  dateTo: string | null;
  datePreset: string;
  sort: OrderSort;
}

export interface OrdersListResponse {
  pagination: { page: number; pageSize: number; totalRows: number; totalPages: number };
  statusCounts: OrderStatusCounts;
  filters: OrderListAppliedFilters;
  data: OrderListItem[];
}

export interface OrderDetailContext {
  tenantPartner: OrderTenantPartnerRef;
  customer: OrderCustomerRef;
  location: OrderLocationRef;
  program: { programId: number; name: string };
}

// `order` is the same JSON the customer portal's order detail page gets, and
// isn't fully specified in the admin API doc — kept loose here, read
// defensively by the detail screen, rather than guessing at an exact shape
// that doesn't exist in this codebase to confirm against.
export interface OrderLine {
  orderLineId: number;
  lineNo: number;
  skuCode?: string | null;
  title?: string;
  qtyOrdered: number;
  qtyShipped: number;
  qtyCancelled: number;
  // A line is refundable up to qtyShipped − qtyRefunded.
  qtyRefunded: number;
  imageUrl?: string | null;
  [key: string]: unknown;
}

// One entry per refunded line per refund, oldest first. Entries sharing the
// same refundKey came from the same *REFUND call. units/dollars/points/
// taxToAllotment went back to the allotment; taxOffBill came off the
// customer's bill; cardAmt/cardTax are the card-paid share, which was never
// refunded.
export interface OrderRefundEntry {
  refundId: number;
  refundKey: string;
  orderLineId: number;
  lineNo: number;
  qty: number;
  units: number;
  dollars: number;
  points: number;
  taxToAllotment: number;
  taxOffBill: number;
  cardAmt: number;
  cardTax: number;
  reason: string;
  ts: string;
  by: string;
}

export interface OrderPaidFromEntry {
  ruleId?: number;
  ruleName?: string;
  amountType?: string;
  amount?: number;
  [key: string]: unknown;
}

export interface OrderShipment {
  carrier?: string;
  trackingNumber?: string;
  lineNos?: number[];
  [key: string]: unknown;
}

export interface OrderDetail {
  orderId: number;
  orderNumber: string;
  status: OrderStatus;
  placedTs: string;
  contact?: Record<string, unknown>;
  shipTo?: Record<string, unknown>;
  shipMethod?: Record<string, unknown>;
  totals?: Record<string, unknown>;
  lines: OrderLine[];
  paidFrom: OrderPaidFromEntry[];
  shipments: OrderShipment[];
  refunds: OrderRefundEntry[];
  approvals: unknown[];
  history: unknown[];
  // Always "N" for admins — Approve/Reject must stay hidden here even if
  // the portal's shared order-detail rendering would otherwise show them.
  viewerCanAct: 'Y' | 'N';
  [key: string]: unknown;
}

export interface OrderGetResponse {
  context: OrderDetailContext;
  order: OrderDetail;
}

export interface RefundLineInput {
  lineNo: number;
  qty: number;
}

export interface RefundRequest {
  orderId?: number;
  orderNumber?: string;
  custId?: number;
  refundKey: string;
  reason: string;
  lines: RefundLineInput[];
}

export interface RefundResponse {
  success: true;
  message: string;
  orderId: number;
  refundKey: string;
}
