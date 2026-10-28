import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { repairCp1252MojibakeDeep, decodeWindows1252Text } from '../../shared/cp1252-mojibake.util';
import { OrderGetResponse, OrderListFilters, OrdersListResponse, RefundRequest, RefundResponse } from './order.model';

// Carries the error envelope's `code` (BOP/NFD/AUT/ERR) alongside the
// user-facing message, so callers can special-case AUT (send the admin back
// to login) without re-parsing the message text.
export class OrderApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly endpoint =
    `${environment.apiBaseUrl}${environment.endpoints.orders}`;

  async list(filters: OrderListFilters): Promise<OrdersListResponse> {
    const data = await this.post({ action: '*LIST', ...filters });
    return data as unknown as OrdersListResponse;
  }

  // Returns the full order — the same JSON the customer portal's order
  // detail page gets, plus tenant partner/customer/location/program context
  // and every refund made on it.
  async get(params: { orderId?: number; orderNumber?: string; custId?: number }): Promise<OrderGetResponse> {
    const data = await this.post({ action: '*GET', ...params });
    return data as unknown as OrderGetResponse;
  }

  async refund(request: RefundRequest): Promise<RefundResponse> {
    const data = await this.post({ action: '*REFUND', ...request });
    return data as unknown as RefundResponse;
  }

  private async post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    const data = await this.parseJson(response);
    // *LIST/*GET successes carry no `success` field at all (only *REFUND
    // does) — checking strictly for `=== false` means a real success never
    // false-trips this.
    if (!response.ok || data['success'] === false) {
      const message = String(data['message'] ?? 'Request failed.');
      const code = typeof data['code'] === 'string' ? data['code'] : 'ERR';
      throw new OrderApiError(message, code);
    }
    return data;
  }

  private async parseJson(response: Response): Promise<Record<string, unknown>> {
    try {
      return repairCp1252MojibakeDeep(JSON.parse(await decodeWindows1252Text(response)) as Record<string, unknown>);
    } catch {
      return { success: false, message: 'Invalid server response.', code: 'ERR' };
    }
  }
}
