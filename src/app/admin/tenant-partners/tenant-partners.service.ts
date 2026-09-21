import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { repairCp1252MojibakeDeep, decodeWindows1252Text } from '../../shared/cp1252-mojibake.util';
import { TenantPartner, TenantPartnerForm, TenantPartnersPage } from './tenant-partner.model';

@Injectable({ providedIn: 'root' })
export class TenantPartnersService {
  private readonly endpoint =
    `${environment.apiBaseUrl}${environment.endpoints.tenantPartners}`;

  async list(params: { page: number; pageSize: number; search: string }): Promise<TenantPartnersPage> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: '*LIST', ...params }),
      credentials: 'include',
    });
    const data = await this.parseJson(response);
    if (!response.ok || data['success'] === false) {
      throw new Error(String(data['message']) ?? 'Failed to load tenant partners.');
    }
    return data as unknown as TenantPartnersPage;
  }

  async get(tpId: number): Promise<TenantPartner> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: '*GET', tpId }),
      credentials: 'include',
    });
    const data = await this.parseJson(response);
    if (!response.ok || data['success'] === false) {
      throw new Error(String(data['message']) ?? 'Failed to load tenant partner.');
    }
    // Tolerate either a flat payload or one nested under `data`/`tenantPartner`,
    // since this *GET is exercised far less than *LIST and its exact shape
    // hasn't been confirmed against the live backend.
    const partner = (data['tenantPartner'] ?? data['data'] ?? data) as unknown as TenantPartner;
    if (!partner.logoUrl) {
      console.warn('[TenantPartnersService.get] no logoUrl in *GET response — raw payload:', data);
    }
    return partner;
  }

  async create(form: TenantPartnerForm): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: '*CREATE', ...form }),
      credentials: 'include',
    });
    const data = await this.parseJson(response);
    if (!response.ok || data['success'] === false) {
      throw new Error(String(data['message']) ?? 'Failed to create tenant partner.');
    }
  }

  async update(tpId: number, form: TenantPartnerForm): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: '*UPDATE', tpId, ...form }),
      credentials: 'include',
    });
    const data = await this.parseJson(response);
    if (!response.ok || data['success'] === false) {
      throw new Error(String(data['message']) ?? 'Failed to update tenant partner.');
    }
  }

  async remove(tpId: number): Promise<TenantPartner> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: '*DELETE', tpId }),
      credentials: 'include',
    });
    const data = await this.parseJson(response);
    if (!response.ok || data['success'] === false) {
      throw new Error(String(data['message']) ?? 'Failed to delete tenant partner.');
    }
    return data as unknown as TenantPartner;
  }

  private async parseJson(response: Response): Promise<Record<string, unknown>> {
    try {
      const text = await decodeWindows1252Text(response);
      return repairCp1252MojibakeDeep(JSON.parse(text) as Record<string, unknown>);
    } catch {
      return { success: false, message: 'Invalid server response.' };
    }
  }
}
