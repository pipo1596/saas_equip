// '*ALL' feeds the four layout slots (TOP/INTRO/BODY_END/FOOTER) of every
// email at once — it isn't itself a sent email.
export type EmailType = '*ALL' | 'ORDER_CONF' | 'APPR_REQUEST' | 'APPR_REMIND' | 'APPROVED' | 'REJECTED';
export type EmailContentStatus = 'ACTIVE' | 'INACTIVE';

export interface EmailContentLimits {
  slotMax: number;
  emailMax: number;
}

export interface EmailContentSlot {
  slotCode: string;
  label: string;
  description: string;
  sortOrder: number;
  // Internal placeholder — not shown in the UI.
  token: string;
  // null = nothing saved for this email type + slot.
  contentId: number | null;
  content: string | null;
  status: EmailContentStatus | null;
  updatedBy: string | null;
  updatedTs: string | null;
  // What the email uses when this type has no ACTIVE content of its own for
  // this slot: 'APPR_REQUEST', '*ALL', or null (blank). Always null on *ALL.
  fallbackFrom: 'APPR_REQUEST' | '*ALL' | null;
}

export interface EmailContentType {
  emailType: EmailType;
  label: string;
  slots: EmailContentSlot[];
}

// Same shape for *LIST_ALL and *GET — *GET just has one entry in emailTypes.
export interface EmailContentListResponse {
  custId: number;
  limits: EmailContentLimits;
  emailTypes: EmailContentType[];
}

export interface EmailPreviewResponse {
  emailType: EmailType;
  orderId: number;
  orderNumber: string | null;
  note: string;
  // The full email exactly as it would be sent, built from saved content —
  // render only in a sandboxed iframe via srcdoc, never with innerHTML.
  html: string;
}
