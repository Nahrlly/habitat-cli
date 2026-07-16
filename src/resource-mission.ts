export type ResourceMissionStatus = "idle" | "running" | "stopping" | "completed" | "failed";

export type ResourceMissionStopReason =
  | "operator-requested"
  | "capacity-reached"
  | "low-battery"
  | "low-oxygen"
  | "no-safe-action"
  | "dependency-failure"
  | "timeout"
  | "completed";

export type ResourceMissionEvaSnapshot = Record<string, unknown>;

export type ResourceMissionCollectedResource = {
  resourceId: string;
  quantityKg: number;
  displayName?: string;
};

export type ResourceMission = {
  id: string;
  humanId: string;
  status: ResourceMissionStatus;
  currentAction: string | null;
  stopReason: ResourceMissionStopReason | null;
  error: string | null;
  finalEvaSnapshot: ResourceMissionEvaSnapshot | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ResourceMissionIteration = {
  id: string;
  missionId: string;
  sequence: number;
  action: string;
  actionInput: Record<string, unknown>;
  scan: Record<string, unknown> | null;
  collectedResources: ResourceMissionCollectedResource[];
  error: string | null;
  evaSnapshot: ResourceMissionEvaSnapshot | null;
  createdAt: string;
};

export type ResourceMissionReport = ResourceMission & {
  iterations: ResourceMissionIteration[];
  scans: Record<string, unknown>[];
  collectedResources: ResourceMissionCollectedResource[];
  errors: string[];
};
