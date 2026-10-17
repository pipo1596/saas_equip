import { Component, OnInit, ViewChild, inject, signal } from '@angular/core';
import { NgForm, FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerEmployeesService } from './customer-employees.service';
import { CustomerEmployee, CustomerEmployeeForm, ShopAsResult } from './customer-employee.model';
import { CustomerRolesService } from '../customer-roles/customer-roles.service';
import { CustomerRole } from '../customer-roles/customer-role.model';

@Component({
  selector: 'app-customer-employee-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './customer-employee-form.component.html',
})
export class CustomerEmployeeFormComponent implements OnInit {
  @ViewChild('employeeForm') employeeFormRef!: NgForm;

  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly service = inject(CustomerEmployeesService);
  private readonly rolesService = inject(CustomerRolesService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showPassword = signal(false);
  readonly emailTouched = signal(false);
  readonly emailError = signal(false);
  readonly roles = signal<CustomerRole[]>([]);
  // Kept alongside formData (which only copies the editable fields) so
  // Shop As can check the employee's live status.
  readonly employee = signal<CustomerEmployee | null>(null);

  readonly showShopAsModal = signal(false);
  readonly shopAsLoading = signal(false);
  readonly shopAsError = signal<string | null>(null);
  readonly shopAsToast = signal<string | null>(null);
  readonly shopAsFallbackUrl = signal<string | null>(null);

  isEdit = false;
  empId: number | null = null;
  customerId: number | null = null;

  formData: CustomerEmployeeForm = {
    locIds: [],
    empNum: '', internalId: '', badgeNum: '',
    firstName: '', lastName: '', phoneNumber: '', emailAddress: '',
    role: '', empRank: '', hireDate: '',
    status: 'ACTIVE',
    mfaEnabled: 'Y', mfaMethod: 'EMAIL',
    password: '',
  };

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  togglePassword(): void {
    this.showPassword.update(v => !v);
  }

  formatPhone(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length > 6) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length > 3) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    if (digits.length > 0) return `(${digits}`;
    return '';
  }

  async ngOnInit(): Promise<void> {
    this.customerId = Number(this.route.snapshot.paramMap.get('customerId'));

    const tpId = this.tpId;
    if (tpId && this.customerId) await this.customerMode.ensure(tpId, this.customerId);
    if (tpId && this.customerId) await this.loadRoles();

    const idParam = this.route.snapshot.paramMap.get('employeeId');
    if (!idParam) return;

    this.isEdit = true;
    this.empId = Number(idParam);

    if (!tpId || !this.customerId) return;
    this.loading.set(true);
    try {
      this.prefill(await this.service.get(tpId, this.customerId, this.empId));
    } catch {
      this.error.set('Could not load employee data.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadRoles(): Promise<void> {
    const tpId = this.tpId;
    if (!tpId || !this.customerId) return;
    try {
      this.roles.set(await this.rolesService.listAll(tpId, this.customerId));
    } catch { /* non-critical */ }
  }

  private prefill(employee: CustomerEmployee): void {
    this.employee.set(employee);
    this.formData = {
      locIds:         employee.locIds ?? [],
      empNum:         employee.empNum ?? '',
      internalId:     employee.internalId ?? '',
      badgeNum:       employee.badgeNum ?? '',
      firstName:      employee.firstName ?? '',
      lastName:       employee.lastName ?? '',
      phoneNumber:    employee.phoneNumber ?? '',
      emailAddress:   employee.emailAddress ?? '',
      role:           employee.roleId?.toString() ?? '',
      empRank:        employee.empRank ?? '',
      hireDate:       employee.hireDate ?? '',
      status:         employee.status ?? 'ACTIVE',
      mfaEnabled:     employee.mfaEnabled ?? 'Y',
      mfaMethod:      employee.mfaMethod ?? 'EMAIL',
      password: '',
    };
  }

  cancel(): void {
    this.router.navigate(['/partner', this.tpId, 'customers', this.customerId, 'employees']);
  }

  private validateEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  async save(): Promise<void> {
    this.emailTouched.set(true);
    this.emailError.set(!this.validateEmail(this.formData.emailAddress));

    if (this.employeeFormRef.invalid || this.emailError()) {
      this.employeeFormRef.form.markAllAsTouched();
      return;
    }

    const tpId = this.tpId;
    if (!tpId || !this.customerId) return;

    this.saving.set(true);
    this.error.set(null);
    try {
      if (this.isEdit && this.empId != null) {
        await this.service.update(tpId, this.customerId, this.empId, this.formData);
      } else {
        await this.service.create(tpId, this.customerId, this.formData);
      }
      this.router.navigate(['/partner', tpId, 'customers', this.customerId, 'employees']);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Save failed. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  displayName(employee: CustomerEmployee): string {
    const parts = [employee.firstName, employee.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : '—';
  }

  // ── Shop as ───────────────────────────────────────────────────────────────

  openShopAsModal(): void {
    if (this.employee()?.status !== 'ACTIVE') return;
    this.shopAsError.set(null);
    this.shopAsFallbackUrl.set(null);
    this.showShopAsModal.set(true);
  }

  closeShopAsModal(): void {
    if (this.shopAsLoading()) return;
    this.showShopAsModal.set(false);
    this.shopAsFallbackUrl.set(null);
  }

  async confirmShopAs(): Promise<void> {
    const target = this.employee();
    const tpId = this.tpId;
    if (!target || !tpId || !this.customerId) return;

    this.shopAsLoading.set(true);
    this.shopAsError.set(null);
    this.shopAsFallbackUrl.set(null);
    try {
      const result: ShopAsResult = await this.service.shopAs(tpId, this.customerId, target.empId);
      if (!result.success || !result.url) {
        this.shopAsError.set(result.message || 'Unable to open the portal.');
        if (result.code === 'NFD') {
          this.router.navigate(['/partner', tpId, 'customers', this.customerId, 'employees']);
        }
        return;
      }
      // Only ever opened once we have a real URL — a blocked attempt here
      // (unlike one opened pre-emptively) means the browser genuinely
      // blocked it, not that we closed a blank tab a moment later.
      const win = window.open(result.url, '_blank', 'noopener');
      if (win) {
        this.showShopAsModal.set(false);
        this.shopAsToast.set('Portal opened in a new tab.');
        setTimeout(() => this.shopAsToast.set(null), 4000);
      } else {
        this.shopAsFallbackUrl.set(result.url);
      }
    } catch (err) {
      this.shopAsError.set(err instanceof Error ? err.message : 'Unable to open the portal.');
    } finally {
      this.shopAsLoading.set(false);
    }
  }
}
