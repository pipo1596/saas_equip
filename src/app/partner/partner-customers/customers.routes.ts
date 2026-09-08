import { Routes } from '@angular/router';
import { PartnerCustomersComponent } from './partner-customers.component';
import { CustomerFormComponent } from './customer-form.component';
import { CustomerOverviewComponent } from './customer-overview.component';
import { CustomerRolesComponent } from '../customer-roles/customer-roles.component';
import { CustomerRoleDetailComponent } from '../customer-roles/customer-role-detail.component';
import { CustomerAllotmentRuleEditorComponent } from '../customer-allotment-rules/customer-allotment-rule-editor.component';
import { CustomerPaymentLedgersComponent } from '../customer-payment-ledgers/customer-payment-ledgers.component';
import { CustomerEmployeesComponent } from '../customer-employees/customer-employees.component';
import { CustomerEmployeeFormComponent } from '../customer-employees/customer-employee-form.component';
import { CustomerEmployeeAllotmentComponent } from '../customer-employee-allotments/customer-employee-allotment.component';
import { CustomerLocationsComponent } from '../customer-locations/customer-locations.component';
import { CustomerLocationFormComponent } from '../customer-locations/customer-location-form.component';
import { CustomerAddressesComponent } from '../customer-addresses/customer-addresses.component';
import { CustomerContactsComponent } from '../customer-contacts/customer-contacts.component';
import { CustomerShippingMethodsComponent } from '../customer-shipping-methods/customer-shipping-methods.component';
import { CustomerPriceListsComponent } from '../customer-price-lists/customer-price-lists.component';
import { CustomerPriceListFormComponent } from '../customer-price-lists/customer-price-list-form.component';
import { CustomerPriceListItemsComponent } from '../customer-price-lists/customer-price-list-items.component';
import { CustomerProgramsComponent } from '../customer-programs/customer-programs.component';
import { CustomerProgramFormComponent } from '../customer-programs/customer-program-form.component';
import { CustomerProgramTreeComponent } from '../customer-programs/customer-program-tree.component';
import { CustomerProgramViewsComponent } from '../customer-program-views/customer-program-views.component';

// All routes are relative to partner/:id/customers
export const CUSTOMERS_ROUTES: Routes = [
  { path: '', pathMatch: 'full', component: PartnerCustomersComponent },
  { path: 'new', component: CustomerFormComponent },
  { path: ':customerId/edit', component: CustomerFormComponent },
  { path: ':customerId', pathMatch: 'full', redirectTo: ':customerId/overview' },
  { path: ':customerId/overview', component: CustomerOverviewComponent },
  { path: ':customerId/uniform-programs', component: CustomerProgramsComponent },
  { path: ':customerId/uniform-programs/new', component: CustomerProgramFormComponent },
  { path: ':customerId/uniform-programs/:programId/edit', component: CustomerProgramFormComponent },
  { path: ':customerId/uniform-programs/:programId/tree', component: CustomerProgramTreeComponent },
  { path: ':customerId/uniform-programs/:programId/views', component: CustomerProgramViewsComponent },
  { path: ':customerId/roles', component: CustomerRolesComponent },
  { path: ':customerId/roles/:roleId', component: CustomerRoleDetailComponent },
  { path: ':customerId/roles/:roleId/rules/new', component: CustomerAllotmentRuleEditorComponent },
  { path: ':customerId/roles/:roleId/rules/:ruleId', component: CustomerAllotmentRuleEditorComponent },
  { path: ':customerId/payment-ledgers', component: CustomerPaymentLedgersComponent },
  { path: ':customerId/employees', component: CustomerEmployeesComponent },
  { path: ':customerId/employees/new', component: CustomerEmployeeFormComponent },
  { path: ':customerId/employees/:employeeId/edit', component: CustomerEmployeeFormComponent },
  { path: ':customerId/employees/:employeeId/allotment', component: CustomerEmployeeAllotmentComponent },
  { path: ':customerId/locations', component: CustomerLocationsComponent },
  { path: ':customerId/locations/new', component: CustomerLocationFormComponent },
  { path: ':customerId/locations/:locationId/edit', component: CustomerLocationFormComponent },
  { path: ':customerId/addresses', component: CustomerAddressesComponent },
  { path: ':customerId/contacts', component: CustomerContactsComponent },
  { path: ':customerId/shipping-methods', component: CustomerShippingMethodsComponent },
  { path: ':customerId/price-lists', component: CustomerPriceListsComponent },
  { path: ':customerId/price-lists/new', component: CustomerPriceListFormComponent },
  { path: ':customerId/price-lists/:priceListId/edit', component: CustomerPriceListFormComponent },
  { path: ':customerId/price-lists/:priceListId/items', component: CustomerPriceListItemsComponent },
];
