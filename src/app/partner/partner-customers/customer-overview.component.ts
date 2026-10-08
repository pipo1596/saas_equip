import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from './customer-mode.service';
import { CustomersService } from './customers.service';
import { Customer } from './customer.model';
import { CustomerAttachmentsService } from './customer-attachments.service';
import { CustomerAttachment } from './customer-attachment.model';
import { ImageUploadService } from '../../shared/image-upload.service';
import { TenantPartnersService } from '../../admin/tenant-partners/tenant-partners.service';

const FILE_ICONS: Record<string, string> = {
  pdf: 'bi-filetype-pdf',
  doc: 'bi-filetype-docx',
  docx: 'bi-filetype-docx',
  xls: 'bi-filetype-xlsx',
  xlsx: 'bi-filetype-xlsx',
  png: 'bi-filetype-png',
  jpg: 'bi-filetype-jpg',
  jpeg: 'bi-filetype-jpg',
};

const FILE_ICON_COLORS: Record<string, string> = {
  pdf: '#dc2626',
  doc: '#2563eb',
  docx: '#2563eb',
  xls: '#16a34a',
  xlsx: '#16a34a',
  png: '#7c3aed',
  jpg: '#7c3aed',
  jpeg: '#7c3aed',
};

@Component({
  selector: 'app-customer-overview',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './customer-overview.component.html',
})
export class CustomerOverviewComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly service = inject(CustomersService);
  private readonly attachmentsService = inject(CustomerAttachmentsService);
  private readonly uploadService = inject(ImageUploadService);
  private readonly tenantPartnersService = inject(TenantPartnersService);
  private readonly route = inject(ActivatedRoute);

  readonly customer = signal<Customer | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly portalBaseDomain = signal<string | null>(null);

  readonly attachments = signal<CustomerAttachment[]>([]);
  readonly loadingAttachments = signal(false);
  readonly uploadingFile = signal(false);
  readonly attachError = signal<string | null>(null);
  readonly dragActive = signal(false);

  readonly showDeleteAttachModal = signal(false);
  readonly deleteAttachTarget = signal<CustomerAttachment | null>(null);
  readonly deletingAttach = signal(false);

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get customerId(): number | null {
    const idParam = this.route.snapshot.paramMap.get('customerId');
    return idParam ? Number(idParam) : null;
  }

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    await this.customerMode.ensure(tpId, custId);
    this.loading.set(true);
    this.error.set(null);
    try {
      this.customer.set(await this.service.get(tpId, custId));
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load customer.');
    } finally {
      this.loading.set(false);
    }
    try {
      const partner = await this.tenantPartnersService.get(tpId);
      this.portalBaseDomain.set(partner.portalBaseDomain);
    } catch { /* non-critical */ }
    await this.loadAttachments();
  }

  fullCustomerUrl(customerUrl: string): string {
    const base = this.portalBaseDomain();
    if (!base) return customerUrl;
    const normalizedSlug = customerUrl;
    const normalizedBase = base;
    return `${normalizedSlug}.${normalizedBase}`;
  }

  async loadAttachments(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.loadingAttachments.set(true);
    try {
      this.attachments.set(await this.attachmentsService.list(tpId, custId));
    } catch (err) {
      this.attachError.set(err instanceof Error ? err.message : 'Failed to load attachments.');
    } finally {
      this.loadingAttachments.set(false);
    }
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (files.length) this.uploadFiles(files);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
    const files = event.dataTransfer?.files;
    if (files?.length) this.uploadFiles(Array.from(files));
  }

  private async uploadFiles(files: File[]): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;

    this.attachError.set(null);
    this.uploadingFile.set(true);
    try {
      for (const file of files) {
        const fileUrl = await this.uploadService.upload(
          'customer_attachment', file, tpId,
          { tpId, custId, subfolder: `customer_attachments-${custId}` },
        );
        await this.attachmentsService.create(tpId, custId, {
          fileName: file.name,
          fileUrl,
          fileSizeBytes: file.size,
          mimeType: file.type || 'application/octet-stream',
        });
      }
      await this.loadAttachments();
    } catch (err) {
      this.attachError.set(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      this.uploadingFile.set(false);
    }
  }

  openDeleteAttachModal(attachment: CustomerAttachment): void {
    this.deleteAttachTarget.set(attachment);
    this.showDeleteAttachModal.set(true);
  }

  closeDeleteAttachModal(): void {
    this.showDeleteAttachModal.set(false);
    this.deleteAttachTarget.set(null);
  }

  async confirmDeleteAttach(): Promise<void> {
    const target = this.deleteAttachTarget();
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!target || !tpId || !custId) return;
    this.deletingAttach.set(true);
    try {
      await this.attachmentsService.remove(tpId, custId, target.attachmentId);
      this.showDeleteAttachModal.set(false);
      this.deleteAttachTarget.set(null);
      await this.loadAttachments();
    } catch (err) {
      this.attachError.set(err instanceof Error ? err.message : 'Delete failed.');
      this.closeDeleteAttachModal();
    } finally {
      this.deletingAttach.set(false);
    }
  }

  private fileExt(fileName: string): string {
    const parts = fileName.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  }

  fileIcon(fileName: string): string {
    return FILE_ICONS[this.fileExt(fileName)] ?? 'bi-file-earmark';
  }

  fileIconColor(fileName: string): string {
    return FILE_ICON_COLORS[this.fileExt(fileName)] ?? '#6b7280';
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  statusBadge(status: string): string {
    return status === 'ACTIVE'
      ? 'badge bg-success-subtle text-success border border-success-subtle'
      : 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
  }

  formatShortDate(ts: string | null): string {
    if (!ts) return '—';
    try {
      return new Date(ts).toISOString().slice(0, 10);
    } catch {
      return ts;
    }
  }
}
