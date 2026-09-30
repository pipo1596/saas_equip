export interface CustomerRole {
  roleId: number;
  tpId: number;
  custId: number;
  roleName: string;
  accessLevel: 'EMPLOYEE' | 'APPROVER' | 'ADMIN';
  allotmentType: 'NONE' | 'DOLLAR' | 'POINT' | 'ITEM' | 'COMBO';
  description: string | null;
  isActive: 'Y' | 'N';
  canOrderSelf: 'Y' | 'N';
  canApprove: 'Y' | 'N';
  canShopForOthers: 'Y' | 'N';
  canManageTeamBalances: 'Y' | 'N';
  allotExclTaxFreight: 'Y' | 'N';
  createdTs: string;
  createdBy: string | null;
  updatedTs: string;
  updatedBy: string | null;
}

export interface CustomerRoleForm {
  roleName: string;
  accessLevel: 'EMPLOYEE' | 'APPROVER' | 'ADMIN';
  allotmentType: 'NONE' | 'DOLLAR' | 'POINT' | 'ITEM' | 'COMBO';
  description: string;
  isActive: 'Y' | 'N';
  canOrderSelf: 'Y' | 'N';
  canApprove: 'Y' | 'N';
  canShopForOthers: 'Y' | 'N';
  canManageTeamBalances: 'Y' | 'N';
  allotExclTaxFreight: 'Y' | 'N';
}

export interface CustomerRolesPage {
  data: CustomerRole[];
  pagination: { totalRows: number; page: number; pageSize: number };
}
