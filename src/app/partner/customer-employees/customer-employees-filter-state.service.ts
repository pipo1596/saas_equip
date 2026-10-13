import { Injectable } from '@angular/core';

export interface CustomerEmployeesFilterState {
  page: number;
  pageSize: number;
  search: string;
  roleFilter: number | null;
  hireFrom: string;
  hireTo: string;
}

// Remembers the employees list's search/filter/page state per customer, so
// navigating away (edit, allotment, delete) and back restores it instead of
// resetting to a blank list. Keyed by custId since an admin can switch
// between customers without this being a per-tab/per-session reset.
@Injectable({ providedIn: 'root' })
export class CustomerEmployeesFilterStateService {
  private readonly byCustomer = new Map<number, CustomerEmployeesFilterState>();

  get(custId: number): CustomerEmployeesFilterState | null {
    return this.byCustomer.get(custId) ?? null;
  }

  set(custId: number, state: CustomerEmployeesFilterState): void {
    this.byCustomer.set(custId, state);
  }
}
