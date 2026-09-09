import { Routes } from '@angular/router';
import { AuthGuard } from './auth/auth.guard';
import { GuestGuard } from './auth/guest.guard';
import { ShellComponent } from './shell/shell.component';
import { partnerModeGuard } from './partner/partner-mode.guard';
import { partnerTenantGuard } from './partner/partner-tenant.guard';
import { LoginComponent } from './auth/login/login.component';
import { MfaComponent } from './auth/mfa/mfa.component';
import { ForgotPasswordComponent } from './auth/forgot-password/forgot-password.component';
import { PartnerShellComponent } from './partner/partner-shell/partner-shell.component';

export const routes: Routes = [
  { path: 'login', canMatch: [GuestGuard], canActivate: [GuestGuard], component: LoginComponent },
  { path: 'mfa', canMatch: [GuestGuard], canActivate: [GuestGuard], component: MfaComponent },
  { path: 'forgot-password', canMatch: [GuestGuard], canActivate: [GuestGuard], component: ForgotPasswordComponent },
  {
    path: 'partner',
    component: PartnerShellComponent,
    canMatch: [AuthGuard],
    canActivate: [AuthGuard],
    canActivateChild: [partnerTenantGuard],
    loadChildren: () => import('./partner/partner.routes').then(m => m.PARTNER_ROUTES),
  },
  {
    path: '',
    component: ShellComponent,
    canMatch: [AuthGuard],
    canActivate: [AuthGuard],
    canActivateChild: [partnerModeGuard],
    children: [
      { path: '', redirectTo: 'admin', pathMatch: 'full' },
      { path: 'reports', loadChildren: () => import('./reports/reports.module').then((m) => m.ReportsModule) },
      { path: 'settings', loadChildren: () => import('./settings/settings.module').then((m) => m.SettingsModule) },
      { path: 'admin', loadChildren: () => import('./admin/admin.module').then((m) => m.AdminModule) },
      { path: '**', redirectTo: 'admin' },
    ],
  },
];
