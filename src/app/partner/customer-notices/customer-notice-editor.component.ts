import { Component, OnInit, inject, signal, WritableSignal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, NgClass } from '@angular/common';
import { QuillEditorComponent } from 'ngx-quill';
import type { ContentChange } from 'ngx-quill';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerNoticesService } from './customer-notices.service';
import { CustomerNotice, CustomerNoticeForm, CustomerNoticeLocation, CustomerNoticeRule, NoticePubStatus } from './customer-notice.model';
import { CustomerLocationsService } from '../customer-locations/customer-locations.service';
import { CustomerLocation } from '../customer-locations/customer-location.model';
import { CustomerRolesService } from '../customer-roles/customer-roles.service';
import { CustomerAllotmentRulesService } from '../customer-allotment-rules/customer-allotment-rules.service';
import { CustomerAllotmentRule } from '../customer-allotment-rules/customer-allotment-rule.model';
import { CustomerProgramsService } from '../customer-programs/customer-programs.service';
import { CustomerProgramCategoryNode, CustomerProgramSku } from '../customer-programs/customer-program.model';

interface CatalogCategoryOption {
  progCatId: number;
  label: string;
  programName: string;
}

interface CatalogProductOption {
  productPk: number;
  label: string;
  programName: string;
}

const BLANK_FORM: CustomerNoticeForm = {
  internalTitle: '', bannerMessage: '', bannerStyle: 'INFO',
  linkType: 'ANNOUNCE', linkText: '', linkProgCatId: 0, linkProductPk: 0, linkUrl: '',
  showOnHome: 'Y', pubStatus: 'DRAFT',
  headline: '', category: 'Policy', postedBy: '', body: '',
  allLocations: 'Y', locations: [], allRules: 'Y', rules: [],
  startTs: '', endTs: null, priority: 10, keepInArchive: 'Y',
};

@Component({
  selector: 'app-customer-notice-editor',
  standalone: true,
  imports: [FormsModule, RouterModule, QuillEditorComponent, DecimalPipe, NgClass],
  templateUrl: './customer-notice-editor.component.html',
})
export class CustomerNoticeEditorComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly service = inject(CustomerNoticesService);
  private readonly locationsService = inject(CustomerLocationsService);
  private readonly rolesService = inject(CustomerRolesService);
  private readonly rulesService = inject(CustomerAllotmentRulesService);
  private readonly programsService = inject(CustomerProgramsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly notice = signal<CustomerNotice | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly submitted = signal(false);

  readonly allLocationOptions = signal<CustomerLocation[]>([]);
  readonly allotmentGroupOptions = signal<CustomerAllotmentRule[]>([]);
  readonly catalogCategories = signal<CatalogCategoryOption[]>([]);
  readonly catalogProducts = signal<CatalogProductOption[]>([]);

  readonly maxBodyLength = 65000;
  readonly bodyCharCount = signal(0);
  readonly htmlSourceMode = signal(false);

  readonly editorModules = {
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link', 'clean'],
    ],
    clipboard: { matchVisual: false },
    keyboard: {
      bindings: { 'list autofill': { prefix: /^\s{0,30}(1\.|[-*])\s$/, handler: () => false } },
    },
  };

  form: CustomerNoticeForm = { ...BLANK_FORM };
  // Date-only working fields for the <input type="date"> controls — the
  // wire format needs full "YYYY-MM-DD HH:MM:SS" timestamps (date-only
  // start means 00:00, date-only end means 23:59:59), composed only at
  // save time via toStartTs()/toEndTs().
  startDate = '';
  endDate = '';

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get customerId(): number | null {
    const p = this.route.snapshot.paramMap.get('customerId');
    return p ? Number(p) : null;
  }

  protected get noticeId(): number | null {
    const p = this.route.snapshot.paramMap.get('noticeId');
    return p ? Number(p) : null;
  }

  get isEdit(): boolean {
    return this.noticeId !== null;
  }

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);

    await Promise.all([this.loadLocations(), this.loadAllotmentGroups(), this.loadCatalogPickers()]);

    const noticeId = this.noticeId;
    if (noticeId !== null) {
      await this.fetchNotice(noticeId);
    } else {
      this.form = { ...BLANK_FORM };
      this.startDate = new Date().toISOString().slice(0, 10);
      this.endDate = '';
    }
  }

  private async loadLocations(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    try {
      this.allLocationOptions.set(await this.locationsService.listAll(tpId, custId));
    } catch {
      // Non-critical at load time — the Departments picker just shows empty.
    }
  }

  // "Allotment groups" are allotment rules customer-wide, not scoped to one
  // role the way the rules service's own list actions are — merged here
  // across every role (dedup by ruleId) since there's no single
  // role-agnostic list action for them.
  private async loadAllotmentGroups(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    try {
      const roles = await this.rolesService.listAll(tpId, custId);
      const perRole = await Promise.all(
        roles.map(r => this.rulesService.listAll(tpId, custId, r.roleId).catch(() => [] as CustomerAllotmentRule[])),
      );
      const merged = new Map<number, CustomerAllotmentRule>();
      perRole.flat().forEach(rule => merged.set(rule.ruleId, rule));
      this.allotmentGroupOptions.set(Array.from(merged.values()).filter(r => r.status === 'ACTIVE'));
    } catch {
      this.allotmentGroupOptions.set([]);
    }
  }

  // Builds the Catalog category / Product pickers from the customer's own
  // program trees — the same source the Allotment Rule editor's scope
  // picker reads, so "the customer's approved catalog" matches what's
  // actually assigned to them.
  private async loadCatalogPickers(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    try {
      const programs = await this.programsService.listAll(tpId, custId);
      const trees = await Promise.all(programs.map(async p => ({
        program: p,
        tree: await this.programsService.getTree(tpId, custId, p.programId).catch(() => null),
      })));
      const categories: CatalogCategoryOption[] = [];
      const products = new Map<number, CatalogProductOption>();
      trees.forEach(({ program, tree }) => {
        if (!tree) return;
        this.flattenCategories(tree.categories).forEach(c => {
          if (c.isLeaf) categories.push({ progCatId: c.progCatId, label: c.label, programName: program.programName });
          c.skus.forEach(sku => {
            if (!products.has(sku.productPk)) {
              products.set(sku.productPk, { productPk: sku.productPk, label: sku.productTitle, programName: program.programName });
            }
          });
        });
      });
      this.catalogCategories.set(categories);
      this.catalogProducts.set(Array.from(products.values()));
    } catch {
      this.catalogCategories.set([]);
      this.catalogProducts.set([]);
    }
  }

  private flattenCategories(
    nodes: CustomerProgramCategoryNode[], parentPath = '',
  ): { progCatId: number; label: string; isLeaf: boolean; skus: CustomerProgramSku[] }[] {
    const out: { progCatId: number; label: string; isLeaf: boolean; skus: CustomerProgramSku[] }[] = [];
    for (const n of nodes) {
      const label = parentPath ? `${parentPath} > ${n.categoryName}` : n.categoryName;
      out.push({ progCatId: n.progCatId, label, isLeaf: n.children.length === 0, skus: n.skus });
      out.push(...this.flattenCategories(n.children, label));
    }
    return out;
  }

  private async fetchNotice(noticeId: number): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const notice = await this.service.get(tpId, custId, noticeId);
      this.notice.set(notice);
      this.applyNotice(notice);
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load notice.');
    } finally {
      this.loading.set(false);
    }
  }

  private applyNotice(n: CustomerNotice): void {
    this.form = {
      internalTitle: n.internalTitle, bannerMessage: n.bannerMessage, bannerStyle: n.bannerStyle,
      linkType: n.linkType, linkText: n.linkText ?? '', linkProgCatId: n.linkProgCatId ?? 0,
      linkProductPk: n.linkProductPk ?? 0, linkUrl: n.linkUrl ?? '',
      showOnHome: n.showOnHome, pubStatus: n.pubStatus,
      headline: n.headline, category: n.category, postedBy: n.postedBy, body: n.body,
      allLocations: n.allLocations, locations: n.locations, allRules: n.allRules, rules: n.rules,
      startTs: n.startTs, endTs: n.endTs, priority: n.priority, keepInArchive: n.keepInArchive,
    };
    this.startDate = n.startTs ? n.startTs.slice(0, 10) : '';
    this.endDate = n.endTs ? n.endTs.slice(0, 10) : '';
  }

  // ── Link type ────────────────────────────────────────────────────────────

  onLinkTypeChange(): void {
    if (this.form.linkType !== 'CATEGORY') this.form.linkProgCatId = 0;
    if (this.form.linkType !== 'PRODUCT') this.form.linkProductPk = 0;
    if (this.form.linkType !== 'EXTERNAL') this.form.linkUrl = '';
    if (this.form.linkType === 'NONE') this.form.linkText = '';
  }

  // ── Audience: departments (locations) ───────────────────────────────────

  isLocationSelected(locId: number): boolean {
    return this.form.locations.some(l => l.locationId === locId);
  }

  toggleLocation(loc: CustomerLocation): void {
    const entry: CustomerNoticeLocation = { locationId: loc.locId, locationName: loc.locName };
    this.form.locations = this.isLocationSelected(loc.locId)
      ? this.form.locations.filter(l => l.locationId !== loc.locId)
      : [...this.form.locations, entry];
  }

  // ── Audience: allotment groups (rules) ──────────────────────────────────

  isRuleSelected(ruleId: number): boolean {
    return this.form.rules.some(r => r.ruleId === ruleId);
  }

  toggleRule(rule: CustomerAllotmentRule): void {
    const entry: CustomerNoticeRule = { ruleId: rule.ruleId, ruleName: rule.ruleName };
    this.form.rules = this.isRuleSelected(rule.ruleId)
      ? this.form.rules.filter(r => r.ruleId !== rule.ruleId)
      : [...this.form.rules, entry];
  }

  // ── Rich text body ───────────────────────────────────────────────────────

  toggleHtmlSource(): void {
    this.htmlSourceMode.set(!this.htmlSourceMode());
  }

  onEditorCreated(quill: { getLength(): number }, countSignal: WritableSignal<number>): void {
    countSignal.set(Math.max(0, quill.getLength() - 1));
  }

  onContentChanged(event: ContentChange, countSignal: WritableSignal<number>): void {
    const length = event.editor.getLength() - 1;
    if (length > this.maxBodyLength) {
      event.editor.deleteText(this.maxBodyLength, event.editor.getLength());
      countSignal.set(this.maxBodyLength);
    } else {
      countSignal.set(Math.max(0, length));
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async saveDraft(): Promise<void> {
    await this.doSave('DRAFT');
  }

  async savePublish(): Promise<void> {
    await this.doSave('PUBLISHED');
  }

  private async doSave(pubStatus: NoticePubStatus): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;

    this.submitted.set(true);
    if (!this.form.internalTitle.trim()) {
      this.scrollToAndFocus('nf-internalTitle');
      return;
    }
    if (!this.form.bannerMessage.trim()) {
      this.scrollToAndFocus('nf-bannerMessage');
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    try {
      const payload: CustomerNoticeForm = {
        ...this.form,
        pubStatus,
        startTs: this.toStartTs(this.startDate),
        endTs: this.toEndTs(this.endDate),
      };

      const noticeId = this.noticeId;
      if (noticeId === null) {
        const result = await this.service.create(tpId, custId, payload);
        if (!result.noticeId) {
          throw new Error('The server did not return the new notice’s ID — it may not have been created.');
        }
      } else {
        await this.service.update(tpId, custId, noticeId, payload);
      }

      this.router.navigate(['/partner', tpId, 'customers', custId, 'notices']);
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : 'Failed to save notice.');
    } finally {
      this.saving.set(false);
    }
  }

  private toStartTs(dateOnly: string): string {
    return dateOnly ? `${dateOnly} 00:00:00` : '';
  }

  private toEndTs(dateOnly: string): string | null {
    return dateOnly ? `${dateOnly} 23:59:59` : null;
  }

  cancel(): void {
    const tpId = this.tpId;
    const custId = this.customerId;
    this.router.navigate(['/partner', tpId, 'customers', custId, 'notices']);
  }

  statusBadge(status: string): string {
    switch (status) {
      case 'LIVE': return 'badge bg-success-subtle text-success border border-success-subtle';
      case 'SCHEDULED': return 'badge bg-warning-subtle text-warning-emphasis border border-warning-subtle';
      case 'HIDDEN': return 'badge bg-danger-subtle text-danger border border-danger-subtle';
      case 'DRAFT': return 'badge bg-info-subtle text-info-emphasis border border-info-subtle';
      default: return 'badge bg-secondary-subtle text-secondary border border-secondary-subtle'; // ENDED
    }
  }

  // This is a long single-page form — a validation error on a field near
  // the top is otherwise invisible if the user clicked Save from further down.
  private scrollToAndFocus(elementId: string): void {
    const el = document.getElementById(elementId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus();
  }
}
