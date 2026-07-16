import { randomUUID } from "node:crypto";
import { withDatabase } from "./sqlite-state.js";
import type {
  ResourceMission,
  ResourceMissionCollectedResource,
  ResourceMissionEvaSnapshot,
  ResourceMissionIteration,
  ResourceMissionReport,
  ResourceMissionStatus,
  ResourceMissionStopReason,
} from "./resource-mission.js";

type ResourceMissionRow = {
  id: string;
  humanId: string;
  status: ResourceMissionStatus;
  currentAction: string | null;
  stopReason: ResourceMissionStopReason | null;
  error: string | null;
  finalEvaJson: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type ResourceMissionIterationRow = {
  id: string;
  missionId: string;
  sequence: number;
  action: string;
  actionInputJson: string;
  scanJson: string | null;
  collectedResourcesJson: string;
  error: string | null;
  evaSnapshotJson: string | null;
  createdAt: string;
};

export type StartResourceMissionInput = {
  id?: string;
  humanId: string;
  startedAt?: string;
  currentAction?: string | null;
};

export type UpdateResourceMissionInput = {
  status?: "running" | "stopping";
  currentAction?: string | null;
  stopReason?: ResourceMissionStopReason | null;
  error?: string | null;
};

export type AppendResourceMissionIterationInput = {
  id?: string;
  missionId: string;
  action: string;
  actionInput?: Record<string, unknown>;
  scan?: Record<string, unknown>;
  collectedResources?: ResourceMissionCollectedResource[];
  error?: string;
  evaSnapshot?: ResourceMissionEvaSnapshot;
  createdAt?: string;
};

export type FinishResourceMissionInput = {
  status: "completed" | "failed";
  stopReason: ResourceMissionStopReason;
  error?: string;
  finalEvaSnapshot: ResourceMissionEvaSnapshot;
  completedAt?: string;
};

export class ResourceMissionAlreadyActiveError extends Error {
  constructor() {
    super("A resource mission is already active.");
    this.name = "ResourceMissionAlreadyActiveError";
  }
}

export function loadActiveResourceMission(): ResourceMission | null {
  return withDatabase((db) => {
    const row = db.query(resourceMissionSelect("WHERE active_key = 'active'")).get() as ResourceMissionRow | null;
    return row ? toMission(row) : null;
  });
}

export function startResourceMission(input: StartResourceMissionInput): ResourceMission {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const mission: ResourceMission = {
    id: input.id ?? randomUUID(),
    humanId: input.humanId,
    status: "running",
    currentAction: input.currentAction ?? null,
    stopReason: null,
    error: null,
    finalEvaSnapshot: null,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
  };

  return withDatabase((db) => inImmediateTransaction(db, () => {
    const active = db.query("SELECT id FROM resource_missions WHERE active_key = 'active'").get() as { id: string } | null;
    if (active) throw new ResourceMissionAlreadyActiveError();

    try {
      db.query(`INSERT INTO resource_missions (
        id, human_id, status, active_key, current_action, stop_reason, error,
        final_eva_json, started_at, updated_at, completed_at
      ) VALUES (?, ?, ?, 'active', ?, NULL, NULL, NULL, ?, ?, NULL)`).run(
        mission.id,
        mission.humanId,
        mission.status,
        mission.currentAction,
        mission.startedAt,
        mission.updatedAt,
      );
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ResourceMissionAlreadyActiveError();
      throw error;
    }

    return mission;
  }));
}

export function updateResourceMission(missionId: string, input: UpdateResourceMissionInput): ResourceMission {
  return withDatabase((db) => inImmediateTransaction(db, () => {
    const current = loadMissionRow(db, missionId);
    if (!isActiveStatus(current.status)) throw new Error(`Resource mission is not active: ${missionId}.`);

    const updatedAt = new Date().toISOString();
    const next = {
      status: input.status ?? current.status,
      currentAction: input.currentAction === undefined ? current.currentAction : input.currentAction,
      stopReason: input.stopReason === undefined ? current.stopReason : input.stopReason,
      error: input.error === undefined ? current.error : input.error,
    };
    db.query(`UPDATE resource_missions
      SET status = ?, current_action = ?, stop_reason = ?, error = ?, updated_at = ?
      WHERE id = ?`).run(next.status, next.currentAction, next.stopReason, next.error, updatedAt, missionId);

    return toMission({ ...current, ...next, updatedAt });
  }));
}

export function appendResourceMissionIteration(input: AppendResourceMissionIterationInput): ResourceMissionIteration {
  return withDatabase((db) => inImmediateTransaction(db, () => {
    const mission = loadMissionRow(db, input.missionId);
    if (!isActiveStatus(mission.status)) throw new Error(`Resource mission is not active: ${input.missionId}.`);
    const row = db.query("SELECT COALESCE(MAX(sequence), 0) AS maximum FROM resource_mission_iterations WHERE mission_id = ?").get(input.missionId) as { maximum: number };
    const iteration: ResourceMissionIteration = {
      id: input.id ?? randomUUID(),
      missionId: input.missionId,
      sequence: row.maximum + 1,
      action: input.action,
      actionInput: input.actionInput ?? {},
      scan: input.scan ?? null,
      collectedResources: input.collectedResources ?? [],
      error: input.error ?? null,
      evaSnapshot: input.evaSnapshot ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    db.query(`INSERT INTO resource_mission_iterations (
      id, mission_id, sequence, action, action_input_json, scan_json,
      collected_resources_json, error, eva_snapshot_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      iteration.id,
      iteration.missionId,
      iteration.sequence,
      iteration.action,
      JSON.stringify(iteration.actionInput),
      iteration.scan === null ? null : JSON.stringify(iteration.scan),
      JSON.stringify(iteration.collectedResources),
      iteration.error,
      iteration.evaSnapshot === null ? null : JSON.stringify(iteration.evaSnapshot),
      iteration.createdAt,
    );
    return iteration;
  }));
}

export function finishResourceMission(missionId: string, input: FinishResourceMissionInput): ResourceMission {
  return withDatabase((db) => inImmediateTransaction(db, () => {
    const current = loadMissionRow(db, missionId);
    if (!isActiveStatus(current.status)) throw new Error(`Resource mission is not active: ${missionId}.`);

    const completedAt = input.completedAt ?? new Date().toISOString();
    db.query(`UPDATE resource_missions
      SET status = ?, active_key = NULL, stop_reason = ?, error = ?, final_eva_json = ?, updated_at = ?, completed_at = ?
      WHERE id = ?`).run(
      input.status,
      input.stopReason,
      input.error ?? null,
      JSON.stringify(input.finalEvaSnapshot),
      completedAt,
      completedAt,
      missionId,
    );
    return toMission({
      ...current,
      status: input.status,
      stopReason: input.stopReason,
      error: input.error ?? null,
      finalEvaJson: JSON.stringify(input.finalEvaSnapshot),
      updatedAt: completedAt,
      completedAt,
    });
  }));
}

export function loadResourceMissionReport(missionId: string): ResourceMissionReport | null {
  return withDatabase((db) => {
    const mission = db.query(resourceMissionSelect("WHERE id = ?")).get(missionId) as ResourceMissionRow | null;
    if (!mission) return null;
    const iterations = db.query(`SELECT
      id, mission_id AS missionId, sequence, action, action_input_json AS actionInputJson,
      scan_json AS scanJson, collected_resources_json AS collectedResourcesJson,
      error, eva_snapshot_json AS evaSnapshotJson, created_at AS createdAt
      FROM resource_mission_iterations WHERE mission_id = ? ORDER BY sequence ASC`).all(missionId) as ResourceMissionIterationRow[];
    const parsedIterations = iterations.map(toIteration);
    const collectedResources = aggregateCollectedResources(parsedIterations);
    const errors = parsedIterations.flatMap((iteration) => iteration.error ? [iteration.error] : []);
    if (mission.error) errors.push(mission.error);

    return {
      ...toMission(mission),
      iterations: parsedIterations,
      scans: parsedIterations.flatMap((iteration) => iteration.scan ? [iteration.scan] : []),
      collectedResources,
      errors,
    };
  });
}

export function loadLatestResourceMissionReport(): ResourceMissionReport | null {
  return withDatabase((db) => {
    const row = db.query(resourceMissionSelect("ORDER BY started_at DESC LIMIT 1")).get() as ResourceMissionRow | null;
    return row ? loadResourceMissionReport(row.id) : null;
  });
}

function resourceMissionSelect(whereClause: string): string {
  return `SELECT
    id, human_id AS humanId, status, current_action AS currentAction, stop_reason AS stopReason,
    error, final_eva_json AS finalEvaJson, started_at AS startedAt, updated_at AS updatedAt,
    completed_at AS completedAt
    FROM resource_missions ${whereClause}`;
}

function loadMissionRow(db: Parameters<typeof withDatabase>[0] extends (db: infer T) => unknown ? T : never, missionId: string): ResourceMissionRow {
  const row = db.query(resourceMissionSelect("WHERE id = ?")).get(missionId) as ResourceMissionRow | null;
  if (!row) throw new Error(`Resource mission not found: ${missionId}.`);
  return row;
}

function inImmediateTransaction<T>(db: Parameters<typeof withDatabase>[0] extends (db: infer T) => unknown ? T : never, callback: () => T): T {
  db.run("BEGIN IMMEDIATE");
  try {
    const value = callback();
    db.run("COMMIT");
    return value;
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

function toMission(row: ResourceMissionRow): ResourceMission {
  return {
    id: row.id,
    humanId: row.humanId,
    status: row.status,
    currentAction: row.currentAction,
    stopReason: row.stopReason,
    error: row.error,
    finalEvaSnapshot: row.finalEvaJson ? JSON.parse(row.finalEvaJson) as ResourceMissionEvaSnapshot : null,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  };
}

function toIteration(row: ResourceMissionIterationRow): ResourceMissionIteration {
  return {
    id: row.id,
    missionId: row.missionId,
    sequence: row.sequence,
    action: row.action,
    actionInput: JSON.parse(row.actionInputJson) as Record<string, unknown>,
    scan: row.scanJson ? JSON.parse(row.scanJson) as Record<string, unknown> : null,
    collectedResources: JSON.parse(row.collectedResourcesJson) as ResourceMissionCollectedResource[],
    error: row.error,
    evaSnapshot: row.evaSnapshotJson ? JSON.parse(row.evaSnapshotJson) as ResourceMissionEvaSnapshot : null,
    createdAt: row.createdAt,
  };
}

function aggregateCollectedResources(iterations: ResourceMissionIteration[]): ResourceMissionCollectedResource[] {
  const resources = new Map<string, ResourceMissionCollectedResource>();
  for (const iteration of iterations) {
    for (const resource of iteration.collectedResources) {
      const existing = resources.get(resource.resourceId);
      resources.set(resource.resourceId, {
        resourceId: resource.resourceId,
        quantityKg: (existing?.quantityKg ?? 0) + resource.quantityKg,
        ...(resource.displayName ? { displayName: resource.displayName } : existing?.displayName ? { displayName: existing.displayName } : {}),
      });
    }
  }
  return [...resources.values()];
}

function isActiveStatus(status: ResourceMissionStatus): boolean {
  return status === "running" || status === "stopping";
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
