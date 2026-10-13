export interface ApprovalLevelRoleRef {
  roleId: number;
  roleName: string;
  isActive: 'Y' | 'N';
  canApprove: 'Y' | 'N';
}

// minAmount is the highest amount on any level below this one that has one
// (0 if none) — display only, never sent back on *SYNC.
// maxAmount null + top level      -> final approval, any amount.
// maxAmount null + below the top  -> "always passes up" (passesUp === 'Y').
// Amounts only have to rise among levels that HAVE one — a blank level in
// between doesn't break the ordering.
export interface ApprovalLevel {
  levelId: number;
  levelNo: number;
  minAmount: number;
  maxAmount: number | null;
  passesUp: 'Y' | 'N';
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
