export interface CustomerNoticeLocation {
  locationId: number;
  locationName: string;
}

export interface CustomerNoticeRule {
  ruleId: number;
  ruleName: string;
}

export type NoticeBannerStyle = 'INFO' | 'IMPORTANT' | 'URGENT';
export type NoticeLinkType = 'ANNOUNCE' | 'CATEGORY' | 'PRODUCT' | 'EXTERNAL' | 'NONE';
export type NoticePubStatus = 'DRAFT' | 'PUBLISHED';
export type NoticeDisplayStatus = 'LIVE' | 'SCHEDULED' | 'HIDDEN' | 'ENDED' | 'DRAFT';

// The full Notice object — same keys read by *LIST_ALL/*GET and written by
// *CREATE/*UPDATE, except `body`, which *LIST_ALL never includes (see
// CustomerNoticeListItem).
export interface CustomerNotice {
  noticeId: number;
  tpId: number;
  custId: number;
  internalTitle: string;
  bannerMessage: string;
  bannerStyle: NoticeBannerStyle;
  linkType: NoticeLinkType;
  linkText: string | null;
  linkProgCatId: number | null;
  linkProductPk: number | null;
  linkUrl: string | null;
  // Read-only: category name or product title, resolved server-side.
  linkTargetName: string | null;
  showOnHome: 'Y' | 'N';
  pubStatus: NoticePubStatus;
  // Read-only, computed on every read — see displayStatus rules in the
  // editor/list components.
  displayStatus: NoticeDisplayStatus;
  headline: string;
  category: string;
  postedBy: string;
  body: string;
  allLocations: 'Y' | 'N';
  locations: CustomerNoticeLocation[];
  allRules: 'Y' | 'N';
  rules: CustomerNoticeRule[];
  startTs: string;
  endTs: string | null;
  priority: number;
  keepInArchive: 'Y' | 'N';
  createdBy: string | null;
  createdTs: string;
  updatedBy: string | null;
  updatedTs: string;
}

// *LIST_ALL row — body is never included in the list.
export type CustomerNoticeListItem = Omit<CustomerNotice, 'body'>;

export interface CustomerNoticesListResponse {
  liveNoticeId: number | null;
  counts: { all: number; live: number; scheduled: number; hidden: number; ended: number; draft: number };
  data: CustomerNoticeListItem[];
}

// Sent to *CREATE/*UPDATE. `body` here is the full, unchunked editor HTML —
// the service splits it into body/body2.../body7 at send time (see
// notice-body-chunk.util.ts), since the backend's JSON parser caps each key
// at 10,000 characters.
export interface CustomerNoticeForm {
  internalTitle: string;
  bannerMessage: string;
  bannerStyle: NoticeBannerStyle;
  linkType: NoticeLinkType;
  linkText: string;
  linkProgCatId: number;
  linkProductPk: number;
  linkUrl: string;
  showOnHome: 'Y' | 'N';
  pubStatus: NoticePubStatus;
  headline: string;
  category: string;
  postedBy: string;
  body: string;
  allLocations: 'Y' | 'N';
  locations: CustomerNoticeLocation[];
  allRules: 'Y' | 'N';
  rules: CustomerNoticeRule[];
  startTs: string;
  endTs: string | null;
  priority: number;
  keepInArchive: 'Y' | 'N';
}

export interface CustomerNoticeSaveResult {
  success: boolean;
  message: string;
  noticeId?: number;
}
