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
  // Orders placed by this role need approval — nothing else. The approval
  // chain itself is customer-wide levels (see customer-approval-level.model),
  // not a per-role approver; this role only needs requiresApproval to flag
  // that its own orders enter that ladder.
  requiresApproval: 'Y' | 'N';
  // The level this role approves at (meaningful only when canApprove==='Y').
  // null = not in the ladder. approvalLevelNo is read-only — never send it.
  approvalLevelId: number | null;
  approvalLevelNo: number | null;
  // Admin override: approves any pending order at any step, outside the
  // level ladder entirely. Mutually exclusive with approvalLevelId.
  canOverride: 'Y' | 'N';
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
  requiresApproval: 'Y' | 'N';
  canOverride: 'Y' | 'N';
  // Send 0 to clear the level — the server treats null/"" as "leave
  // unchanged" on *UPDATE, not as a clear.
  approvalLevelId: number;
}

export interface CustomerRolesPage {
  data: CustomerRole[];
  pagination: { totalRows: number; page: number; pageSize: number };
}
