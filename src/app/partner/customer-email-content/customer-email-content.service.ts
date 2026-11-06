import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { repairCp1252MojibakeDeep, decodeWindows1252Text } from '../../shared/cp1252-mojibake.util';
import { htmlEncodeNonAscii } from '../../shared/html-encode-non-ascii.util';
import { EmailContentListResponse, EmailContentStatus, EmailPreviewResponse, EmailType } from './customer-email-content.model';

@Injectable({ providedIn: 'root' })
export class CustomerEmailContentService {
  private readonly endpoint =
    `${environment.apiBaseUrl}${environment.endpoints.customerEmailContent}`;

  async listAll(tpId: number, custId: number): Promise<EmailContentListResponse> {
    const data = await this.post({ action: '*LIST_ALL', tpId, custId });
    return data as unknown as EmailContentListResponse;
  }

  // Same shape as *LIST_ALL, with a single entry in emailTypes.
  async get(tpId: number, custId: number, emailType: EmailType): Promise<EmailContentListResponse> {
    const data = await this.post({ action: '*GET', tpId, custId, emailType });
    return data as unknown as EmailContentListResponse;
  }

  // orderId 0 lets the server pick the customer's latest suitable order.
  async preview(tpId: number, custId: number, emailType: EmailType, orderId = 0): Promise<EmailPreviewResponse> {
    const data = await this.post({ action: '*PREVIEW', tpId, custId, emailType, orderId });
    return data as unknown as EmailPreviewResponse;
  }

  // Blank content clears the slot (same as *CLEAR). Content is HTML-encoded
  // (same backend charset workaround used for every other rich-text field in
  // this app) since the server rejects non-ASCII characters outright.
  async save(
    tpId: number, custId: number, emailType: EmailType, slotCode: string,
    content: string, status?: EmailContentStatus,
  ): Promise<void> {
    await this.post({
      action: '*SAVE', tpId, custId, emailType, slotCode,
      content: htmlEncodeNonAscii(content),
      ...(status ? { status } : {}),
    });
  }

  // Clearing an empty slot succeeds with "Nothing to clear."
  async clear(tpId: number, custId: number, emailType: EmailType, slotCode: string): Promise<void> {
    await this.post({ action: '*CLEAR', tpId, custId, emailType, slotCode });
  }

  private async post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    const data = await this.parseJson(response);
    // A read success (*LIST_ALL/*GET/*PREVIEW) carries no `success` key at
    // all — checking strictly for `=== false` means a real success never
    // false-trips this.
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
