import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { repairCp1252MojibakeDeep, decodeWindows1252Text } from '../../shared/cp1252-mojibake.util';
import { DataResidencyService, DataResidencyRegion } from '../../shared/data-residency.service';
import { CustomerEmployee, CustomerEmployeeForm, CustomerEmployeesPage, ShopAsResult } from './customer-employee.model';

@Injectable({ providedIn: 'root' })
export class CustomerEmployeesService {
  private readonly dataResidency = inject(DataResidencyService);

  async regionFor(tpId: number): Promise<DataResidencyRegion> {
    return this.dataResidency.resolve(tpId);
  }

  async list(tpId: number, custId: number, params: {
    page: number; pageSize: number; search: string;
    roleId?: number | null; hireFrom?: string; hireTo?: string;
  }): Promise<CustomerEmployeesPage> {
    const data = await this.post(tpId, { action: '*LIST', tpId, custId, ...params });
    return data as unknown as CustomerEmployeesPage;
  }

  async listAll(tpId: number, custId: number): Promise<CustomerEmployee[]> {
    const data = await this.post(tpId, { action: '*LIST_ALL', tpId, custId });
    return this.parseListData<CustomerEmployee>(data['data']);
  }

  // Defensive against the double-JSON-encoding quirk seen elsewhere in this
  // API (e.g. APITPCLCEM *GET) where `data` comes back as a JSON-encoded
  // string instead of a real array.
  private parseListData<T>(raw: unknown): T[] {
    if (Array.isArray(raw)) return raw as T[];
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed as T[] : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  async get(tpId: number, custId: number, empId: number): Promise<CustomerEmployee> {
    const data = await this.post(tpId, { action: '*GET', tpId, custId, empId });
    return data as unknown as CustomerEmployee;
  }

  async create(tpId: number, custId: number, form: CustomerEmployeeForm): Promise<CustomerEmployee> {
    const data = await this.post(tpId, { action: '*CREATE', tpId, custId, ...form });
    return data['employee'] as unknown as CustomerEmployee;
  }

  async update(tpId: number, custId: number, empId: number, form: CustomerEmployeeForm): Promise<void> {
    await this.post(tpId, { action: '*UPDATE', tpId, custId, empId, ...form });
  }

  async remove(tpId: number, custId: number, empId: number): Promise<void> {
    await this.post(tpId, { action: '*DELETE', tpId, custId, empId });
  }

  async inductFromCsv(tpId: number, csvUrl: string): Promise<void> {
    await this.post(tpId, { action: '*INDUCT', tpId, csvUrl });
  }

  // Returns the raw result instead of throwing on failure — the caller
  // branches on `code` (AUT/NFD/ERR/BOP) per the UI treatment table, and a
  // failure here is a normal, expected outcome (e.g. someone else just
  // changed the employee's status), not an exceptional one.
  async shopAs(tpId: number, custId: number, empId: number): Promise<ShopAsResult> {
    const endpoint = await this.endpointFor(tpId);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: '*SHOPAS', empId, custId, tpId }),
      credentials: 'include',
    });
    const data = await this.parseJson(response);
    return data as unknown as ShopAsResult;
  }

  // Two IBM i programs serve the same TP_CUST_EMPLOYEES data, split by the
  // tenant partner's data residency setting (partner-settings-mfa.component.ts)
  // — US-resident partners must hit APITPCEMP, Canadian ones APITPCEMCA.
  private async endpointFor(tpId: number): Promise<string> {
    const region = await this.dataResidency.resolve(tpId);
    const program = region === 'CA' ? environment.endpoints.customerEmployeesCa : environment.endpoints.customerEmployeesUs;
    return `${environment.apiBaseUrl}${program}`;
  }

  private async post(tpId: number, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const endpoint = await this.endpointFor(tpId);
    const response = await fetch(endpoint, {
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
