export interface ApprovalLevelRoleRef {
  roleId: number;
  roleName: string;
  isActive: 'Y' | 'N';
  canApprove: 'Y' | 'N';
}

// minAmount is the level below's maxAmount (0 for level 1) — display only,
// never sent back on *SYNC. maxAmount null = no limit (top level only).
export interface ApprovalLevel {
  levelId: number;
  levelNo: number;
  minAmount: number;
  maxAmount: number | null;
  escalationDays: number;
  approverCount: number;
  roles: ApprovalLevelRoleRef[];
}

export interface ApprovalOverrideRole {
  roleId: number;
  roleName: string;
  isActive: 'Y' | 'N';
}

export interface ApprovalSimulationStep {
  levelId: number;
  levelNo: number;
  roleNames: string | null;
  escalationDays: number;
  approverCount: number;
  willSkip: 'Y' | 'N';
  final: 'Y' | 'N';
}

export interface ApprovalSimulation {
  amount: number;
  ordererRoleId: number;
  startAfterLevel: number;
  path: ApprovalSimulationStep[];
  endsWith: 'LEVEL' | 'OVERRIDE' | 'NONE';
}

export interface ApprovalLadder {
  levels: ApprovalLevel[];
  overrideRoles: ApprovalOverrideRole[];
  warnings: string[];
  simulation?: ApprovalSimulation;
}

// *SYNC body — every key required on every level, every time (the server
// pairs the four lists by position, so a missing key shifts values between
// levels). 0 = new level (levelId) / no limit (maxAmount).
export interface LevelSyncItem {
  levelId: number;
  levelNo: number;
  maxAmount: number;
  escalationDays: number;
}
