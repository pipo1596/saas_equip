import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, NgClass } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { QuillEditorComponent } from 'ngx-quill';
import type { ContentChange } from 'ngx-quill';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerEmailContentService } from './customer-email-content.service';
import { EmailContentLimits, EmailContentSlot, EmailContentStatus, EmailContentType, EmailType } from './customer-email-content.model';

// The four slots every email type shares and falls back to *ALL for.
const LAYOUT_SLOTS = ['TOP', 'INTRO', 'BODY_END', 'FOOTER'];

interface SlotEditState {
  slotCode: string;
  content: string;
  status: EmailContentStatus;
  charCount: number;
  dirty: boolean;
  saving: boolean;
  clearing: boolean;
  error: string | null;
  htmlSourceMode: boolean;
}

@Component({
  selector: 'app-customer-email-content',
  standalone: true,
  imports: [FormsModule, QuillEditorComponent, DecimalPipe, NgClass],
  templateUrl: './customer-email-content.component.html',
})
export class CustomerEmailContentComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly service = inject(CustomerEmailContentService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);

  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly limits = signal<EmailContentLimits>({ slotMax: 4000, emailMax: 12000 });
  readonly emailTypes = signal<EmailContentType[]>([]);
  // *ALL still exists server-side and still feeds the layout slots of every
  // email, but there's no tab for it — it's not an email of its own, and
  // editing it isn't exposed on this screen.
  readonly visibleTypes = computed(() => this.emailTypes().filter(t => t.emailType !== '*ALL'));
  readonly activeType = signal<EmailType>('*ALL');
  readonly slotEdits = signal<SlotEditState[]>([]);
  readonly savingAll = signal(false);
  readonly saveAllError = signal<string | null>(null);

  readonly editorModules = {
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link', 'clean'],
    ],
    clipboard: { matchVisual: false },
  };

  readonly showPreviewModal = signal(false);
  readonly previewLoading = signal(false);
  readonly previewError = signal<string | null>(null);
  readonly previewHtml = signal<SafeHtml | null>(null);
  readonly previewNote = signal<string | null>(null);
  readonly previewOrderNumber = signal<string | null>(null);

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get customerId(): number | null {
    const p = this.route.snapshot.paramMap.get('customerId');
    return p ? Number(p) : null;
  }

  readonly activeTypeData = computed(() =>
    this.emailTypes().find(t => t.emailType === this.activeType()) ?? null);

  readonly hasUnsavedChanges = computed(() => this.slotEdits().some(e => e.dirty));

  readonly canPreview = computed(() => this.activeType() !== '*ALL' && !this.hasUnsavedChanges());

  readonly anySlotBusy = computed(() => this.slotEdits().some(e => e.saving || e.clearing));
  readonly canSaveAll = computed(() => this.hasUnsavedChanges() && !this.savingAll() && !this.anySlotBusy());

  // Resolved custom content total for the active email type, after fallback
  // — mirrors the server's 12000-character-per-email check.
  readonly activeEmailTotal = computed(() => {
    const type = this.activeTypeData();
    if (!type || type.emailType === '*ALL') return 0;
    return type.slots.reduce((sum, s) => sum + this.resolvedSlotLength(type.emailType, s.slotCode), 0);
  });

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      await this.fetchAndApplyListAll();
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load email content.');
    } finally {
      this.loading.set(false);
    }
  }

  // Used after a save/clear on *ALL (which changes the fallback shown on
  // every other type) — no full-page spinner, since only the active editor
  // actually needs to visibly refresh.
  private async reloadAllSilently(): Promise<void> {
    try {
      await this.fetchAndApplyListAll();
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to reload email content.');
    }
  }

  private async fetchAndApplyListAll(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    const result = await this.service.listAll(tpId, custId);
    this.limits.set(result.limits);
    this.emailTypes.set(result.emailTypes);
    const visible = result.emailTypes.filter(t => t.emailType !== '*ALL');
    if (visible.length > 0 && !visible.some(t => t.emailType === this.activeType())) {
      this.activeType.set(visible[0].emailType);
    }
    this.rebuildSlotEdits();
  }

  private async reloadType(type: EmailType): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    try {
      const result = await this.service.get(tpId, custId, type);
      this.limits.set(result.limits);
      const updated = result.emailTypes[0];
      if (updated) {
        this.emailTypes.update(types => types.map(t => t.emailType === updated.emailType ? updated : t));
      }
      if (this.activeType() === type) this.rebuildSlotEdits();
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to reload email content.');
    }
  }

  private rebuildSlotEdits(): void {
    const slots = this.activeTypeData()?.slots ?? [];
    this.slotEdits.set(slots.map(s => this.toEditState(s)));
  }

  private toEditState(s: EmailContentSlot): SlotEditState {
    const content = s.content ?? '';
    return {
      slotCode: s.slotCode,
      content,
      status: s.status ?? 'ACTIVE',
      charCount: content.length,
      dirty: false,
      saving: false,
      clearing: false,
      error: null,
      htmlSourceMode: false,
    };
  }

  private patchSlotEdit(slotCode: string, patch: Partial<SlotEditState>): void {
    this.slotEdits.update(edits => edits.map(e => e.slotCode === slotCode ? { ...e, ...patch } : e));
  }

  selectType(type: EmailType): void {
    if (type === this.activeType()) return;
    if (this.hasUnsavedChanges() && !confirm('Discard unsaved changes to this email?')) return;
    this.activeType.set(type);
    this.saveAllError.set(null);
    this.rebuildSlotEdits();
  }

  // ── Slot editing ─────────────────────────────────────────────────────────

  toggleSlotHtmlSource(slotCode: string): void {
    const edit = this.slotEdits().find(e => e.slotCode === slotCode);
    if (edit) this.patchSlotEdit(slotCode, { htmlSourceMode: !edit.htmlSourceMode });
  }

  onSlotContentChanged(slotCode: string, event: ContentChange): void {
    const html = event.html ?? '';
    // Quill also fires this when [ngModel] sets the initial value — on tab
    // switch or page load — via setContents(), which uses Quill's default
    // 'api' source. Only a real 'user' edit should mark the slot dirty, or
    // Preview/Save all would wrongly think there were unsaved changes right
    // after opening a tab.
    if (event.source !== 'user') {
      this.patchSlotEdit(slotCode, { content: html, charCount: html.length });
      return;
    }
    this.patchSlotEdit(slotCode, { content: html, charCount: html.length, dirty: true, error: null });
  }

  onSlotSourceChange(slotCode: string, value: string): void {
    this.patchSlotEdit(slotCode, { content: value, charCount: value.length, dirty: true, error: null });
  }

  toggleSlotActive(slotCode: string): void {
    const edit = this.slotEdits().find(e => e.slotCode === slotCode);
    if (!edit) return;
    this.patchSlotEdit(slotCode, { status: edit.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', dirty: true });
  }

  async saveSlot(slotCode: string): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const type = this.activeType();
    const edit = this.slotEdits().find(e => e.slotCode === slotCode);
    if (!tpId || !custId || !edit || !edit.dirty) return;
    if (edit.charCount > this.limits().slotMax) return;

    this.patchSlotEdit(slotCode, { saving: true, error: null });
    try {
      await this.service.save(tpId, custId, type, slotCode, edit.content, edit.status);
      if (type === '*ALL') {
        await this.reloadAllSilently();
      } else {
        await this.reloadType(type);
      }
    } catch (err) {
      this.patchSlotEdit(slotCode, { error: err instanceof Error ? err.message : 'Failed to save.', saving: false });
    }
  }

  async clearSlot(slotCode: string): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const type = this.activeType();
    if (!tpId || !custId) return;

    this.patchSlotEdit(slotCode, { clearing: true, error: null });
    try {
      await this.service.clear(tpId, custId, type, slotCode);
      if (type === '*ALL') {
        await this.reloadAllSilently();
      } else {
        await this.reloadType(type);
      }
    } catch (err) {
      this.patchSlotEdit(slotCode, { error: err instanceof Error ? err.message : 'Failed to clear.', clearing: false });
    }
  }

  async saveAllDirty(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const type = this.activeType();
    const dirty = this.slotEdits().filter(e => e.dirty);
    if (!tpId || !custId || dirty.length === 0) return;

    const overLimit = dirty.find(e => e.charCount > this.limits().slotMax);
    if (overLimit) {
      const label = this.activeTypeData()?.slots.find(s => s.slotCode === overLimit.slotCode)?.label ?? overLimit.slotCode;
      this.saveAllError.set(`"${label}" is over the ${this.limits().slotMax}-character limit — fix it before saving all.`);
      return;
    }

    this.savingAll.set(true);
    this.saveAllError.set(null);
    dirty.forEach(e => this.patchSlotEdit(e.slotCode, { saving: true, error: null }));
    try {
      for (const edit of dirty) {
        await this.service.save(tpId, custId, type, edit.slotCode, edit.content, edit.status);
      }
      if (type === '*ALL') {
        await this.reloadAllSilently();
      } else {
        await this.reloadType(type);
      }
    } catch (err) {
      this.saveAllError.set(err instanceof Error ? err.message : 'Failed to save all changes.');
      dirty.forEach(e => this.patchSlotEdit(e.slotCode, { saving: false }));
    } finally {
      this.savingAll.set(false);
    }
  }

  slotEdit(slotCode: string): SlotEditState | undefined {
    return this.slotEdits().find(e => e.slotCode === slotCode);
  }

  fallbackLabel(slot: EmailContentSlot): string {
    switch (slot.fallbackFrom) {
      case '*ALL': return 'Using the All emails content';
      case 'APPR_REQUEST': return 'Using the Approval request content';
      default: return 'Nothing is shown in this spot';
    }
  }

  showsFallback(slot: EmailContentSlot): boolean {
    return !slot.content || slot.status !== 'ACTIVE';
  }

  // ── Fallback resolution, for the per-email total ────────────────────────

  private liveSlotData(type: EmailType, slotCode: string): { content: string | null; status: EmailContentStatus | null } {
    if (type === this.activeType()) {
      const edit = this.slotEdits().find(e => e.slotCode === slotCode);
      if (edit) return { content: edit.content, status: edit.status };
    }
    const t = this.emailTypes().find(e => e.emailType === type);
    const slot = t?.slots.find(s => s.slotCode === slotCode);
    return { content: slot?.content ?? null, status: slot?.status ?? null };
  }

  private resolvedSlotLength(type: EmailType, slotCode: string): number {
    const own = this.liveSlotData(type, slotCode);
    if (own.status === 'ACTIVE' && own.content) return own.content.length;
    if (type === 'APPR_REMIND') {
      const req = this.liveSlotData('APPR_REQUEST', slotCode);
      if (req.status === 'ACTIVE' && req.content) return req.content.length;
    }
    if (LAYOUT_SLOTS.includes(slotCode)) {
      const all = this.liveSlotData('*ALL', slotCode);
      if (all.status === 'ACTIVE' && all.content) return all.content.length;
    }
    return 0;
  }

  // ── Preview ──────────────────────────────────────────────────────────────

  async openPreview(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    const type = this.activeType();
    if (!tpId || !custId || type === '*ALL' || !this.canPreview()) return;

    this.showPreviewModal.set(true);
    this.previewLoading.set(true);
    this.previewError.set(null);
    this.previewHtml.set(null);
    this.previewNote.set(null);
    this.previewOrderNumber.set(null);
    try {
      const result = await this.service.preview(tpId, custId, type, 0);
      this.previewOrderNumber.set(result.orderNumber);
      const note = result.note?.trim() ?? '';
      this.previewNote.set(/preview built\.?$/i.test(note) ? null : (note || null));
      this.previewHtml.set(this.sanitizer.bypassSecurityTrustHtml(result.html));
    } catch (err) {
      this.previewError.set(err instanceof Error ? err.message : 'Failed to build preview.');
    } finally {
      this.previewLoading.set(false);
    }
  }

  closePreview(): void {
    this.showPreviewModal.set(false);
  }

  typeLabel(type: EmailType): string {
    return this.emailTypes().find(t => t.emailType === type)?.label ?? type;
  }
}
