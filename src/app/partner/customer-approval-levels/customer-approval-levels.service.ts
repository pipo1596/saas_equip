import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { repairCp1252MojibakeDeep, decodeWindows1252Text } from '../../shared/cp1252-mojibake.util';
import { ApprovalLadder, LevelSyncItem } from './customer-approval-level.model';

@Injectable({ providedIn: 'root' })
export class CustomerApprovalLevelsService {
  private readonly endpoint =
    `${environment.apiBaseUrl}${environment.endpoints.customerApprovalLevels}`;

  async list(tpId: number, custId: number): Promise<ApprovalLadder> {
    const data = await this.post({ action: '*LIST', tpId, custId });
    return data as unknown as ApprovalLadder;
  }

  // Saves the whole ladder in one call — levels with an existing levelId are
  // updated, levelId: 0 levels are created, and levels on file that aren't
  // sent are deleted. Reload via list() afterwards to get the new levelIds.
  async sync(tpId: number, custId: number, levels: LevelSyncItem[]): Promise<void> {
    await this.post({ action: '*SYNC', tpId, custId, levels });
  }

  // amount is the order subtotal; roleId is the orderer's role (0 = no
  // level, starts at level 1). Returns the same shape as list() plus
  // `simulation`.
  async simulate(tpId: number, custId: number, amount: number, roleId: number): Promise<ApprovalLadder> {
    const data = await this.post({ action: '*SIMULATE', tpId, custId, amount, roleId });
    return data as unknown as ApprovalLadder;
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
