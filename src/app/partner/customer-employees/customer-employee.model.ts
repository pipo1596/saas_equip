export interface CustomerEmployeeLocation {
  locationId: number;
  locationName: string;
}

export interface CustomerEmployee {
  empId: number;
  tpId: number;
  custId: number;
  locIds: number[];
  empNum: string | null;
  internalId: string | null;
  badgeNum: string | null;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  emailAddress: string;
  role: string | null;
  roleId: number | null;
  roleName: string | null;
  empRank: string | null;
  locations: CustomerEmployeeLocation[];
  hireDate: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'TERMINATED' | 'ON-LEAVE';
  mfaEnabled: 'Y' | 'N';
  mfaMethod: string | null;
  lastLoginTs: string | null;
  lastLoginIp: string | null;
  failedLoginCt: number;
  lockedUntilTs: string | null;
  createdTs: string;
  createdBy: string | null;
  updatedTs: string;
  updatedBy: string | null;
}

export interface CustomerEmployeeForm {
  locIds: number[];
  empNum: string;
  internalId: string;
  badgeNum: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  emailAddress: string;
  role: string;
  empRank: string;
  hireDate: string;
  status: 'ACTIVE' | 'INACTIVE' | 'TERMINATED' | 'ON-LEAVE';
  mfaEnabled: 'Y' | 'N';
  mfaMethod: string;
  password: string;
}

export interface CustomerEmployeesPage {
  data: CustomerEmployee[];
  pagination: { totalRows: number; page: number; pageSize: number };
}

// *SHOPAS — returned as-is (not thrown as an Error like the other actions on
// this service) so the caller can branch on `code` per the UI treatment
// table, and so a failure's message reaches the UI without ever touching
// `url`. The link is single-use and expires in 120s — never log, store, or
// display it as text.
export interface ShopAsResult {
  success: boolean;
  message: string;
  code?: 'AUT' | 'NFD' | 'ERR' | 'BOP';
  url?: string;
  impId?: number;
  expiresInSeconds?: number;
}
