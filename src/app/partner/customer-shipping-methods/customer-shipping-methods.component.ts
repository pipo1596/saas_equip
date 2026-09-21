import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { CustomerShippingMethodsService } from './customer-shipping-methods.service';
import { CustomerShippingMethod, CustomerShippingMethodForm } from './customer-shipping-method.model';

interface ShippingMethodForm {
  methodName: string;
  carrier: string;
  serviceCode: string;
  estimatedDelivery: string;
  rateType: string;
  flatAmount: number | null;
  paidBy: string;
  minOrderAmount: number | null;
  isDefault: boolean;
  active: boolean;
  requireApproval: boolean;
}

const BLANK_FORM: ShippingMethodForm = {
  methodName: '', carrier: '', serviceCode: '', estimatedDelivery: '',
  rateType: 'FLAT', flatAmount: null, paidBy: '', minOrderAmount: null,
  isDefault: false, active: true, requireApproval: false,
};

@Component({
  selector: 'app-customer-shipping-methods',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './customer-shipping-methods.component.html',
})
export class CustomerShippingMethodsComponent implements OnInit {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  private readonly service = inject(CustomerShippingMethodsService);
  private readonly route = inject(ActivatedRoute);

  readonly methods = signal<CustomerShippingMethod[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly showFormModal = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly submitted = signal(false);

  readonly showDeleteModal = signal(false);
  readonly deleteTarget = signal<CustomerShippingMethod | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  form: ShippingMethodForm = { ...BLANK_FORM };

  readonly carrierOptions: string[] = [
    'Canada Post', 'Purolator', 'UPS', 'FedEx', 'Manitoulin', 'Local pickup',
  ];

  readonly rateTypeOptions: { value: string; label: string }[] = [
    { value: 'FLAT', label: 'Flat rate' },
    { value: 'CALCULATED', label: 'Calculated (live)' },
    { value: 'QUOTED', label: 'Quoted' },
    { value: 'FREE', label: 'Free' },
  ];

  readonly paidByOptions: { value: string; label: string }[] = [
    { value: 'EMPLOYEE', label: 'Employee' },
    { value: 'COMPANY', label: 'Company' },
    { value: 'SPLIT', label: 'Split' },
  ];

  protected get tpId(): number | undefined {
    return this.partnerMode.activePartner()?.tpId;
  }

  protected get customerId(): number | null {
    const idParam = this.route.snapshot.paramMap.get('customerId');
    return idParam ? Number(idParam) : null;
  }

  get defaultConflict(): boolean {
    if (!this.form.isDefault) return false;
    const id = this.editingId();
    return this.methods().some(m => m.isDefault === 'Y' && m.shipMethodId !== id);
  }

  async ngOnInit(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (tpId && custId) await this.customerMode.ensure(tpId, custId);
    await this.loadMethods();
  }

  async loadMethods(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.methods.set(await this.service.list(tpId, custId));
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load shipping methods.');
    } finally {
      this.loading.set(false);
    }
  }

  openAddModal(): void {
    this.editingId.set(null);
    this.form = { ...BLANK_FORM };
    this.saveError.set(null);
    this.submitted.set(false);
    this.showFormModal.set(true);
  }

  openEditModal(method: CustomerShippingMethod): void {
    this.editingId.set(method.shipMethodId);
    this.form = {
      methodName:        method.methodName,
      carrier:            method.carrier ?? '',
      serviceCode:        method.serviceCode ?? '',
      estimatedDelivery:  method.estimatedDelivery ?? '',
      rateType:           method.rateType,
      flatAmount:         method.flatAmount,
      paidBy:             method.paidBy ?? '',
      minOrderAmount:     method.minOrderAmount,
      isDefault:          method.isDefault === 'Y',
      active:             method.status === 'ACTIVE',
      requireApproval:    method.reqApproval === 'Y',
    };
    this.saveError.set(null);
    this.submitted.set(false);
    this.showFormModal.set(true);
  }

  closeFormModal(): void {
    this.showFormModal.set(false);
  }

  async saveMethod(): Promise<void> {
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!tpId || !custId) return;
    this.submitted.set(true);
    const f = this.form;
    if (!f.methodName || !f.rateType) return;
    if (this.defaultConflict) {
      this.saveError.set('Another shipping method is already set as default.');
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);
    try {
      const payload: CustomerShippingMethodForm = {
        methodName:        this.form.methodName,
        carrier:            this.form.carrier,
        serviceCode:        this.form.serviceCode,
        estimatedDelivery:  this.form.estimatedDelivery,
        rateType:           this.form.rateType,
        flatAmount:         this.form.rateType === 'FLAT' ? this.form.flatAmount : null,
        paidBy:             this.form.paidBy,
        minOrderAmount:     this.form.minOrderAmount,
        isDefault:          this.form.isDefault ? 'Y' : 'N',
        status:             this.form.active ? 'ACTIVE' : 'INACTIVE',
        reqApproval:        this.form.requireApproval ? 'Y' : 'N',
      };
      const id = this.editingId();
      if (id === null) {
        await this.service.create(tpId, custId, payload);
      } else {
        await this.service.update(tpId, custId, id, payload);
      }
      this.showFormModal.set(false);
      await this.loadMethods();
    } catch (err) {
      this.saveError.set(err instanceof Error ? err.message : 'Failed to save shipping method.');
    } finally {
      this.saving.set(false);
    }
  }

  openDeleteModal(method: CustomerShippingMethod): void {
    this.deleteTarget.set(method);
    this.deleteError.set(null);
    this.showDeleteModal.set(true);
  }

  closeDeleteModal(): void {
    this.showDeleteModal.set(false);
    this.deleteTarget.set(null);
  }

  async confirmDelete(): Promise<void> {
    const method = this.deleteTarget();
    const tpId = this.tpId;
    const custId = this.customerId;
    if (!method || !tpId || !custId) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      await this.service.remove(tpId, custId, method.shipMethodId);
      this.showDeleteModal.set(false);
      this.deleteTarget.set(null);
      await this.loadMethods();
    } catch (err) {
      this.deleteError.set(err instanceof Error ? err.message : 'Failed to delete shipping method.');
    } finally {
      this.deleting.set(false);
    }
  }

  rateLabel(method: CustomerShippingMethod): string {
    if (method.rateType === 'FLAT') {
      return method.flatAmount != null ? `$${method.flatAmount.toFixed(2)} flat` : 'Flat rate';
    }
    const preset = this.rateTypeOptions.find(o => o.value === method.rateType);
    return preset ? preset.label : method.rateType;
  }
}
