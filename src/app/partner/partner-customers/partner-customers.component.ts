import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PartnerModeService } from '../partner-mode.service';
import { CustomersService } from './customers.service';
import { CustomerModeService } from './customer-mode.service';
import { Customer } from './customer.model';
import { ImageUploadService } from '../../shared/image-upload.service';
import { CustomerEmployeesService } from '../customer-employees/customer-employees.service';
import { TenantPartnersService } from '../../admin/tenant-partners/tenant-partners.service';

@Component({
  selector: 'app-partner-customers',
  standalone: true,
  imports: [FormsModule, RouterModule],
  templateUrl: './partner-customers.component.html',
})
export class PartnerCustomersComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  private readonly service = inject(CustomersService);
  private readonly customerMode = inject(CustomerModeService);
  private readonly imageUploadService = inject(ImageUploadService);
  private readonly employeesService = inject(CustomerEmployeesService);
  private readonly tenantPartnersService = inject(TenantPartnersService);
  private readonly router = inject(Router);

  readonly customers = signal<Customer[]>([]);
  readonly portalBaseDomain = signal<string | null>(null);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly pageSize = signal(20);
  readonly search = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly showDeleteModal = signal(false);
  readonly deleting = signal(false);
  readonly deleteTarget = signal<Customer | null>(null);

  readonly csvUploading = signal(false);
  readonly csvInducing = signal(false);
  readonly csvError = signal<string | null>(null);
  readonly csvSuccess = signal(false);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  readonly pageWindow = computed(() => {
    const tp = this.totalPages();
    const p = this.page();
    const start = Math.max(1, Math.min(p - 2, tp - 4));
    const end = Math.min(tp, Math.max(p + 2, 5));
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });

  readonly startRecord = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1
  );

  readonly endRecord = computed(() =>
    Math.min(this.page() * this.pageSize(), this.total())
  );

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  ngOnInit(): void {
    this.loadCustomers();
    this.loadPortalBaseDomain();
  }

  private async loadPortalBaseDomain(): Promise<void> {
    const tpId = this.tpId;
    if (!tpId) return;
    try {
      const partner = await this.tenantPartnersService.get(tpId);
      this.portalBaseDomain.set(partner.portalBaseDomain);
    } catch { /* non-critical */ }
  }

  fullCustomerUrl(customerUrl: string): string {
    const base = this.portalBaseDomain();
    if (!base) return customerUrl;
    const normalizedSlug = customerUrl;
    const normalizedBase = base;
    return `${normalizedSlug}.${normalizedBase}`;
  }

  async onCsvSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const tpId = this.tpId;
    if (!tpId) return;

    this.csvError.set(null);
    this.csvSuccess.set(false);
    this.csvUploading.set(true);

    let csvUrl: string;
    try {
      csvUrl = await this.imageUploadService.upload(
        'employee_csv', file, tpId,
        { tpId, subfolder: 'employee_induction' },
        'employees.csv',
      );
    } catch (err) {
      this.csvError.set(err instanceof Error ? err.message : 'CSV upload failed.');
      this.csvUploading.set(false);
      return;
    }

    this.csvUploading.set(false);
    this.csvInducing.set(true);

    try {
      await this.employeesService.inductFromCsv(tpId, csvUrl);
      this.csvSuccess.set(true);
      setTimeout(() => this.csvSuccess.set(false), 6000);
    } catch (err) {
      this.csvError.set(err instanceof Error ? err.message : 'Employee induction failed.');
    } finally {
      this.csvInducing.set(false);
    }
  }

  async loadCustomers(): Promise<void> {
    const tpId = this.tpId;
    if (!tpId) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.service.list(tpId, {
        page: this.page(),
        pageSize: this.pageSize(),
        search: this.search(),
      });
      this.customers.set(result.data);
      this.total.set(result.pagination.totalRows);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load customers.');
    } finally {
      this.loading.set(false);
    }
  }

  onSearchChange(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.page.set(1); this.loadCustomers(); }, 350);
  }

  onPageSizeChange(value: string): void {
    this.pageSize.set(Number(value));
    this.page.set(1);
    this.loadCustomers();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.page()) return;
    this.page.set(p);
    this.loadCustomers();
  }

  manageCustomer(customer: Customer): void {
    this.customerMode.enter({ custId: customer.custId, customerName: customer.customerName, logoUrl: customer.logoUrl });
    this.router.navigate(['/partner', this.tpId, 'customers', customer.custId]);
  }

  openDeleteModal(customer: Customer): void {
    this.deleteTarget.set(customer);
    this.showDeleteModal.set(true);
  }

  closeDeleteModal(): void {
    this.showDeleteModal.set(false);
    this.deleteTarget.set(null);
  }

  async confirmDelete(): Promise<void> {
    const target = this.deleteTarget();
    const tpId = this.tpId;
    if (!target || !tpId) return;
    this.deleting.set(true);
    try {
      await this.service.remove(tpId, target.custId);
      this.showDeleteModal.set(false);
      this.deleteTarget.set(null);
      if (this.customers().length === 1 && this.page() > 1) this.page.update(p => p - 1);
      await this.loadCustomers();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Delete failed.');
      this.closeDeleteModal();
    } finally {
      this.deleting.set(false);
    }
  }

  statusBadge(status: string): string {
    return status === 'ACTIVE'
      ? 'badge bg-success-subtle text-success border border-success-subtle'
      : 'badge bg-secondary-subtle text-secondary border border-secondary-subtle';
  }
}
