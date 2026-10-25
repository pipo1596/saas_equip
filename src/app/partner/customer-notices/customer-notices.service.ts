import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { repairCp1252MojibakeDeep, decodeWindows1252Text } from '../../shared/cp1252-mojibake.util';
import { htmlEncodeNonAscii } from '../../shared/html-encode-non-ascii.util';
import { chunkNoticeBody } from '../../shared/notice-body-chunk.util';
import { CustomerNotice, CustomerNoticeForm, CustomerNoticeSaveResult, CustomerNoticesListResponse } from './customer-notice.model';

@Injectable({ providedIn: 'root' })
export class CustomerNoticesService {
  private readonly endpoint =
    `${environment.apiBaseUrl}${environment.endpoints.customerNotices}`;

  // Returns every notice for the customer plus tab counts and the
  // highest-priority Live notice — SELMTPCNTC's JSON as-is, no envelope.
  async listAll(tpId: number, custId: number): Promise<CustomerNoticesListResponse> {
    const data = await this.post({ action: '*LIST_ALL', tpId, custId });
    return data as unknown as CustomerNoticesListResponse;
  }

  // Returns one Notice object with `body` — the only action that includes it.
  async get(tpId: number, custId: number, noticeId: number): Promise<CustomerNotice> {
    const data = await this.post({ action: '*GET', tpId, custId, noticeId });
    return data as unknown as CustomerNotice;
  }

  async create(tpId: number, custId: number, form: CustomerNoticeForm): Promise<CustomerNoticeSaveResult> {
    const data = await this.post({ action: '*CREATE', tpId, custId, ...this.toPayload(form) });
    return data as unknown as CustomerNoticeSaveResult;
  }

  // Always resends the full form — omitting a key can clear it (per field,
  // see the API doc's "blank on *UPDATE" table), so the caller must pass a
  // complete, current form, not a partial diff.
  async update(tpId: number, custId: number, noticeId: number, form: CustomerNoticeForm): Promise<void> {
    await this.post({ action: '*UPDATE', tpId, custId, noticeId, ...this.toPayload(form) });
  }

  // Deletes the notice and its audience rows — it also disappears from the
  // shopper archive. To keep it archived, hide it instead (setShow 'N').
  async remove(tpId: number, custId: number, noticeId: number): Promise<void> {
    await this.post({ action: '*DELETE', tpId, custId, noticeId });
  }

  // 'N' hides the banner immediately. 'Y' shows it and publishes a draft at
  // the same time — refused when the notice has ended, its link is
  // incomplete, or it has no audience; the caller should revert its own
  // optimistic UI state and surface the thrown message on failure.
  async setShow(tpId: number, custId: number, noticeId: number, showOnHome: 'Y' | 'N'): Promise<void> {
    await this.post({ action: '*SET_SHOW', tpId, custId, noticeId, showOnHome });
  }

  // Locations/rules are sent as [{locationId}]/[{ruleId}] — ids only, not
  // the display names the form also carries for its own chip/checkbox
  // labels. `body` is HTML-encoded (same backend charset workaround used
  // for every other rich-text field in this app) then chunked into
  // body/body2.../body7.
  private toPayload(form: CustomerNoticeForm): Record<string, unknown> {
    const { body, locations, rules, ...rest } = form;
    return {
      ...rest,
      locations: locations.map(l => ({ locationId: l.locationId })),
      rules: rules.map(r => ({ ruleId: r.ruleId })),
      ...chunkNoticeBody(htmlEncodeNonAscii(body)),
    };
  }

  private async post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    const data = await this.parseJson(response);
    if (!response.ok || data['success'] === false) {
      throw new Error(String(data['message'] ?? 'Request failed.'));
    }
    return data;
  }

  private async parseJson(response: Response): Promise<Record<string, unknown>> {
    try {
      return repairCp1252MojibakeDeep(JSON.parse(await decodeWindows1252Text(response)) as Record<string, unknown>);
    } catch {
      return { success: false, message: 'Invalid server response.' };
    }
  }
}
