import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { repairCp1252MojibakeDeep, decodeWindows1252Text } from '../../shared/cp1252-mojibake.util';
import { parseArrayResponse } from '../../shared/parse-array-response.util';
import {
  CustomerAllotmentRule, CustomerAllotmentRuleForm, CustomerAllotmentRulesPage,
  RuleAssortmentScope, RuleQuotaLimit, RuleQuotaLimitForm,
  RuleFallbackCard, RuleFallbackOptionsResponse,
} from './customer-allotment-rule.model';

@Injectable({ providedIn: 'root' })
export class CustomerAllotmentRulesService {
  private readonly endpoint =
    `${environment.apiBaseUrl}${environment.endpoints.customerAllotmentRules}`;

  async list(tpId: number, custId: number, roleId: number, params: { page: number; pageSize: number; search: string }): Promise<CustomerAllotmentRulesPage> {
    const data = await this.post({ action: '*LIST', tpId, custId, roleId, ...params });
    return data as unknown as CustomerAllotmentRulesPage;
  }

  async listAll(tpId: number, custId: number, roleId: number): Promise<CustomerAllotmentRule[]> {
    const data = await this.post({ action: '*LIST_ALL', tpId, custId, roleId });
    return parseArrayResponse<CustomerAllotmentRule>(data, 'CustomerAllotmentRulesService *LIST_ALL');
  }

  async get(tpId: number, custId: number, roleId: number, ruleId: number): Promise<CustomerAllotmentRule> {
    const data = await this.post({ action: '*GET', tpId, custId, roleId, ruleId });
    return data as unknown as CustomerAllotmentRule;
  }

  async create(tpId: number, custId: number, roleId: number, form: CustomerAllotmentRuleForm): Promise<CustomerAllotmentRule> {
    const data = await this.post({ action: '*CREATE', tpId, custId, roleId, ...form });
    // Tolerate either { rule: {...} } or the created row returned flat at
    // the top level — the real backend's exact shape wasn't confirmed yet.
    return (data['rule'] ?? data) as unknown as CustomerAllotmentRule;
  }

  async update(tpId: number, custId: number, roleId: number, ruleId: number, form: CustomerAllotmentRuleForm): Promise<void> {
    await this.post({ action: '*UPDATE', tpId, custId, roleId, ruleId, ...form });
  }

  async remove(tpId: number, custId: number, roleId: number, ruleId: number): Promise<void> {
    await this.post({ action: '*DELETE', tpId, custId, roleId, ruleId });
  }

  async getScope(tpId: number, custId: number, roleId: number, ruleId: number): Promise<RuleAssortmentScope[]> {
    const data = await this.post({ action: '*SCOPE_GET', tpId, custId, roleId, ruleId });
    return parseArrayResponse<RuleAssortmentScope>(data, 'CustomerAllotmentRulesService *SCOPE_GET');
  }

  // Bulk-replaces the rule's category scope in one call.
  async setScope(tpId: number, custId: number, roleId: number, ruleId: number, items: { progCatId: number; unitQty: number | null }[]): Promise<void> {
    await this.post({ action: '*SCOPE_SET', tpId, custId, roleId, ruleId, items });
  }

  async listQuotas(tpId: number, custId: number, roleId: number, ruleId: number): Promise<RuleQuotaLimit[]> {
    const data = await this.post({ action: '*QUOTA_LIST', tpId, custId, roleId, ruleId });
    return parseArrayResponse<RuleQuotaLimit>(data, 'CustomerAllotmentRulesService *QUOTA_LIST');
  }

  async createQuota(tpId: number, custId: number, roleId: number, ruleId: number, form: RuleQuotaLimitForm): Promise<RuleQuotaLimit> {
    const data = await this.post({ action: '*QUOTA_CREATE', tpId, custId, roleId, ruleId, ...form });
    return (data['quota'] ?? data) as unknown as RuleQuotaLimit;
  }

  async updateQuota(tpId: number, custId: number, roleId: number, ruleId: number, quotaId: number, form: RuleQuotaLimitForm): Promise<void> {
    await this.post({ action: '*QUOTA_UPDATE', tpId, custId, roleId, ruleId, quotaId, ...form });
  }

  async removeQuota(tpId: number, custId: number, roleId: number, ruleId: number, quotaId: number): Promise<void> {
    await this.post({ action: '*QUOTA_DELETE', tpId, custId, roleId, ruleId, quotaId });
  }

  // The Allotment Fallback card's current values — 1st priority is the rule
  // itself (not included in `data`); `data` holds only the 2nd/3rd. Per the
  // API doc, these three fallback actions aren't scoped by roleId (the
  // backend resolves the rule's role from ruleId alone).
  async getFallback(tpId: number, custId: number, ruleId: number): Promise<RuleFallbackCard> {
    const data = await this.post({ action: '*FALLBACK_GET', tpId, custId, ruleId });
    return data as unknown as RuleFallbackCard;
  }

  // Candidate options for the 2nd/3rd priority dropdowns — the role's
  // ACTIVE/DRAFT rules of the same type, excluding this rule itself.
  async getFallbackOptions(tpId: number, custId: number, ruleId: number): Promise<RuleFallbackOptionsResponse> {
    const data = await this.post({ action: '*FALLBACK_OPT', tpId, custId, ruleId });
    return data as unknown as RuleFallbackOptionsResponse;
  }

  // Two flat fields, not an array — 0 clears that slot, both 0 clears the
  // whole list. Only valid against a saved rule (same as *SCOPE_SET): for a
  // new rule, *CREATE first, then this.
  async setFallback(tpId: number, custId: number, ruleId: number, fallback2RuleId: number, fallback3RuleId: number): Promise<void> {
    await this.post({ action: '*FALLBACK_SET', tpId, custId, ruleId, fallback2RuleId, fallback3RuleId });
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
