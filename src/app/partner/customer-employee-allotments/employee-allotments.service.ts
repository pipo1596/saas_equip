import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { repairCp1252MojibakeDeep, decodeWindows1252Text } from '../../shared/cp1252-mojibake.util';
import { parseArrayResponse } from '../../shared/parse-array-response.util';
import { EmployeeAllotmentAdjustmentForm, EmployeeAllotmentBalance, EmployeeAllotmentTransaction } from './employee-allotment.model';

@Injectable({ providedIn: 'root' })
export class EmployeeAllotmentsService {
  private readonly endpoint =
    `${environment.apiBaseUrl}${environment.endpoints.employeeAllotments}`;

  async listBalances(tpId: number, custId: number, empId: number): Promise<EmployeeAllotmentBalance[]> {
    const data = await this.post({ action: '*LIST', tpId, custId, empId });
    return parseArrayResponse<EmployeeAllotmentBalance>(data, 'EmployeeAllotmentsService *LIST');
  }

  async listTransactions(tpId: number, custId: number, empId: number): Promise<EmployeeAllotmentTransaction[]> {
    const data = await this.post({ action: '*TXN_LIST', tpId, custId, empId });
    return parseArrayResponse<EmployeeAllotmentTransaction>(data, 'EmployeeAllotmentsService *TXN_LIST');
  }

  // Posts a manual credit/debit adjustment against one rule's balance for
  // this employee. Backend should insert the resulting TP_EMP_ALLOTMENT_TRANSACTIONS
  // row and update the live balance accordingly.
  async createAdjustment(tpId: number, custId: number, empId: number, ruleId: number, form: EmployeeAllotmentAdjustmentForm): Promise<void> {
    await this.post({ action: '*ADJUST', tpId, custId, empId, ruleId, ...form });
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
