import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { PartnerModeService } from '../partner-mode.service';
import { CustomerModeService } from '../partner-customers/customer-mode.service';
import { AuthService } from '../../auth/auth.service';

@Component({
  selector: 'app-partner-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './partner-sidebar.component.html',
})
export class PartnerSidebarComponent {
  protected readonly partnerMode = inject(PartnerModeService);
  protected readonly customerMode = inject(CustomerModeService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly inSettingsMode = signal(this.checkSettingsMode());
  readonly inCustomerMode = signal(this.checkCustomerMode());

  constructor() {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => {
        this.inSettingsMode.set(this.checkSettingsMode());
        this.inCustomerMode.set(this.checkCustomerMode());
      });
  }

  private checkSettingsMode(): boolean {
    return this.router.url.includes('/settings/') || this.router.url.endsWith('/settings');
  }

  private checkCustomerMode(): boolean {
    return /\/customers\/\d+\/(overview|uniform-programs|roles|employees|locations|addresses|contacts|shipping-methods|payment-ledgers|price-lists)(\/|$|\?)/.test(this.router.url);
  }

  exitSettingsMode(): void {
    const partner = this.partnerMode.activePartner();
    if (partner) {
      this.router.navigate(['/partner', partner.tpId, 'dashboard']);
    }
  }

  exitCustomerMode(): void {
    const partner = this.partnerMode.activePartner();
    this.customerMode.exit();
    if (partner) {
      this.router.navigate(['/partner', partner.tpId, 'customers']);
    }
  }

  exitPartnerMode(): void {
    this.partnerMode.exit();
    this.router.navigate(['/admin/tenant-partners']);
  }
}
