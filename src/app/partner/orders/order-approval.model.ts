// Only custId is required — tpId is just a cross-check, the rest narrow *APPRQ.
export interface AdminApprovalQueueFilters {
  tpId?: number;
  custId: number;
  locationId?: number;
  employeeId?: number;
  search?: string;
  page?: number;
  pageSize?: number;
}

// All fields null for an order placed before multi-level approval.
export interface QueueApprovalStep {
  stepNo: number | null;
  kind: 'LEVEL' | 'OVERRIDE' | null;
  levelNo: number | null;
  roleNames: string | null;
  scope: 'LOCATION' | 'CUSTOMER' | null;
  locationId: number | null;
  waitingSince: string | null;
  dueTs: string | null;
}

export interface AdminQueueThumbnail {
  lineNo: number;
  skuId: number | null;
  productTitle: string;
  imageUrl: string | null;
}

// Entered at checkout, not the employee's current profile.
export interface AdminQueuePlacedBy {
  employeeId: number;
  employeeNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export interface AdminQueueLocation {
  locationId: number | null;
  code: string | null;
  name: string | null;
}

export interface AdminQueueRow {
  orderId: number;
  orderNumber: string;
  status: 'PENDING_APPROVAL';
  placedTs: string;
  itemCount: number;
  lineCount: number;
  moreCount: number;
  subtotal: number;
  orderTotal: number;
  subtotalPoints: number | null;
  allotDollarsUsed: number | null;
  allotPointsUsed: number | null;
  allotUnitsUsed: number | null;
  shipMethodName: string | null;
  thumbnails: AdminQueueThumbnail[];
  placedBy: AdminQueuePlacedBy;
  location: AdminQueueLocation;
  approvalStep: QueueApprovalStep;
  overdue: 'Y' | 'N';
  adminCanAct: 'Y' | 'N';
}

export interface AdminApprovalQueueResponse {
  pagination: { page: number; pageSize: number; totalRows: number; totalPages: number };
  // Absent on an empty page.
  filters?: { locationId: number | null; employeeId: number | null; search: string | null };
  data: AdminQueueRow[];
}

export interface AdminDecisionRequest {
  orderId?: number; // or orderNumber
  orderNumber?: string;
  custId?: number;
  notes: string; // required, 1-500
}

export interface AdminDecisionResponse {
  success: true;
  message: string;
  orderId: number;
  orderNumber: string;
  status: 'PROCESSING' | 'REJECTED';
}
