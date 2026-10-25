import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerNoticesService } from './customer-notices.service';
import { CustomerNoticeListItem, CustomerNoticesListResponse } from './customer-notice.model';

type NoticeTab = 'all' | 'live' | 'scheduled' | 'hidden' | 'ended';

@Component({
  selector: 'app-customer-notices',
  standalone: true,
  imports: [FormsModule, RouterModule, TitleCasePipe],
  templateUrl: './customer-notices.component.html',
})
export class CustomerNoticesComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly service = inject(CustomerNoticesService);
  private readonly route = inject(ActivatedRoute);

  readonly listResponse = signal<CustomerNoticesListResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly toggleError = signal<string | null>(null);
  readonly togglingIds = signal<Set<number>>(new Set());

  readonly activeTab = signal<NoticeTab>('all');
  readonly search = signal('');

  readonly showDeleteModal = signal(false);
  readonly deleteTarget = signal<CustomerNoticeListItem | null>(null);
  readonly deleting = signal(false);

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get customerId(): number | null {
    const p = this.route.snapshot.paramMap.get('customerId');
    return p ? Number(p) : null;
  }

  readonly counts = computed(() =>
    this.listResponse()?.counts ?? { all: 0, live: 0, scheduled: 0, hidden: 0, ended: 0, draft: 0 });

  // The highest-priority Live notice, ignoring audience — what the "Shoppers
  // see right now" panel previews. null when nothing is live.
  readonly liveNotice = computed(() => {
    const resp = this.listResponse();
    if (!resp?.liveNoticeId) return null;
    return resp.data.find(n => n.noticeId === resp.liveNoticeId) ?? null;
  });

  // Drafts have no tab of their own — they surface under Hidden, per the
  // API doc ("the design has no Draft tab; counts.draft lets the front end
  // decide where drafts appear, e.g. under Hidden").
  readonly filteredNotices = computed(() => {
    const resp = this.listResponse();
    if (!resp) return [];
    const tab = this.activeTab();
    const term = this.search().trim().toLowerCase();
    return resp.data.filter(n => {
      const inTab = tab === 'all'
        || (tab === 'hidden' && (n.displayStatus === 'HIDDEN' || n.displayStatus === 'DRAFT'))
        || n.displayStatus.toLowerCase() === tab;
      if (!inTab) return false;
      if (!term) return true;
      return n.internalTitle.toLowerCase().includes(term)
        || n.bannerMessage.toLowerCase().includes(term)
        || n.headline.toLowerCase().includes(term);
    });
  });

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);
    await this.loadNotices();
  }

  async loadNotices(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      this.listResponse.set(await this.service.listAll(tpId, custId));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load notices.');
    } finally {
      this.loading.set(false);
    }
  }

  setTab(tab: NoticeTab): void {
    this.activeTab.set(tab);
  }

  isToggling(noticeId: number): boolean {
    return this.togglingIds().has(noticeId);
  }

  // Optimistic — flips immediately, reverted on failure per the API doc's
  // own guidance for this toggle ("on error, flip the switch back and show
  // the message"). Reloads the full list on success since showing/hiding a
  // notice can change status, counts and liveNoticeId all at once.
  async toggleShowOnHome(n: CustomerNoticeListItem): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId || this.isToggling(n.noticeId)) return;
    const next: 'Y' | 'N' = n.showOnHome === 'Y' ? 'N' : 'Y';
    const previous = n.showOnHome;
    this.setLocalShowOnHome(n.noticeId, next);
    this.togglingIds.update(s => new Set(s).add(n.noticeId));
    this.toggleError.set(null);
    try {
      await this.service.setShow(tpId, custId, n.noticeId, next);
      await this.loadNotices();
    } catch (err) {
      this.setLocalShowOnHome(n.noticeId, previous);
      this.toggleError.set(err instanceof Error ? err.message : 'Unable to update this notice.');
    } finally {
      this.togglingIds.update(s => {
        const updated = new Set(s);
        updated.delete(n.noticeId);
        return updated;
      });
    }
  }

  private setLocalShowOnHome(noticeId: number, value: 'Y' | 'N'): void {
    this.listResponse.update(resp => resp
      ? { ...resp, data: resp.data.map(x => x.noticeId === noticeId ? { ...x, showOnHome: value } : x) }
      : resp);
  }

  audienceLabel(n: CustomerNoticeListItem): string {
    const dept = n.allLocations === 'Y' ? 'All departments' : `${n.locations.length} department${n.locations.length === 1 ? '' : 's'}`;
    const groups = n.allRules === 'Y' ? 'all allotments' : `${n.rules.length} allotment group${n.rules.length === 1 ? '' : 's'}`;
    return `${dept} · ${groups}`;
  }

  linkTargetLabel(n: CustomerNoticeListItem): string {
    switch (n.linkType) {
      case 'ANNOUNCE': return 'Announcement page';
      case 'CATEGORY': return n.linkTargetName ?? 'Catalog category';
      case 'PRODUCT': return n.linkTargetName ?? 'Product';
      case 'EXTERNAL': return n.linkUrl ?? 'External URL';
      default: return '—';
    }
  }

  scheduleLabel(n: CustomerNoticeListItem): string {
    const start = this.formatDate(n.startTs);
    const end = n.endTs ? this.formatDate(n.endTs) : 'No end';
    return `${start} – ${end}`;
  }

  private formatDate(ts: string): string {
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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

  openDeleteModal(n: CustomerNoticeListItem): void {
    this.deleteTarget.set(n);
    this.showDeleteModal.set(true);
  }

  closeDeleteModal(): void {
    this.showDeleteModal.set(false);
    this.deleteTarget.set(null);
  }

  async confirmDelete(): Promise<void> {
    const target = this.deleteTarget();
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!target || !tpId || !custId) return;
    this.deleting.set(true);
    try {
      await this.service.remove(tpId, custId, target.noticeId);
      this.closeDeleteModal();
      await this.loadNotices();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Delete failed.');
      this.closeDeleteModal();
    } finally {
      this.deleting.set(false);
    }
  }
}
