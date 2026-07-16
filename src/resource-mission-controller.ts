import { evaluateResourceMissionAction, type ResourceMissionAction, type ResourceMissionSnapshot } from "./autonomy-policy.js";
import {
  appendResourceMissionIteration,
  finishResourceMission,
  loadActiveResourceMission,
  loadLatestResourceMissionReport,
  loadResourceMissionReport,
  startResourceMission,
  updateResourceMission,
} from "./resource-mission-state.js";
import type { ResourceMission, ResourceMissionCollectedResource, ResourceMissionEvaSnapshot, ResourceMissionIteration, ResourceMissionReport, ResourceMissionStopReason } from "./resource-mission.js";
import type { HabitatEvaState, HabitatHuman } from "./types.js";

export type ResourceMissionApi = {
  humans(): Promise<{ humans: HabitatHuman[] }>;
  evaStatus(): Promise<{ eva: HabitatEvaState }>;
  bounds(): Promise<{ minX: number; maxX: number; minY: number; maxY: number }>;
  deploy(humanId: string): Promise<unknown>;
  scan(strength: number, radius: number): Promise<Record<string, unknown>>;
  collect(quantityKg: number): Promise<Record<string, unknown>>;
  move(x: number, y: number): Promise<unknown>;
  dock(): Promise<unknown>;
};

export type ResourceMissionDecisionContext = {
  mission: ResourceMission;
  snapshot: ResourceMissionSnapshot;
  legalActions: ResourceMissionAction[];
};

export type ResourceMissionPlanContext = ResourceMissionDecisionContext & {
  maxPlanSteps: number;
  recentIterations: ResourceMissionIteration[];
};

export type ResourceMissionPlanResult = {
  actions: ResourceMissionAction[];
  responseText?: string;
  source?: string;
};

export type ResourceMissionPlanner = (context: ResourceMissionPlanContext) => Promise<ResourceMissionAction[] | ResourceMissionPlanResult>;

export type ResourceMissionController = {
  start(): Promise<ResourceMission>;
  resumeActiveMission(seed: Pick<ResourceMission, "id" | "humanId">): Promise<ResourceMission>;
  stop(): Promise<ResourceMission | null>;
  status(): Promise<{ mission: ResourceMission | null; eva: ResourceMissionEvaSnapshot | null }>;
  report(missionId?: string): ResourceMissionReport | null;
  waitForCompletion(missionId: string): Promise<void>;
};

const DEFAULT_SCAN_STRENGTH = 50;
const DEFAULT_SCAN_RADIUS = 1;

export function createResourceMissionController(input: {
  api: ResourceMissionApi;
  decide?: (context: ResourceMissionDecisionContext) => Promise<ResourceMissionAction>;
  plan?: ResourceMissionPlanner;
  maxPlanSteps?: number;
  fallbackPlanOnError?: boolean;
  delayMs?: number;
}): ResourceMissionController {
  const loops = new Map<string, Promise<void>>();
  const decide = input.decide ?? (async ({ legalActions }) => legalActions[0]!);
  const maxPlanSteps = input.maxPlanSteps ?? 12;
  const plan = input.plan ?? (async (context: ResourceMissionPlanContext) => [await decide(context)]);
  const delayMs = input.delayMs ?? 100;

  async function start(): Promise<ResourceMission> {
    if (loadActiveResourceMission()) throw new Error("A resource mission is already active.");
    const { humans } = await input.api.humans();
    const { eva } = await input.api.evaStatus();
    if (eva.deployedHumanId) throw new Error("EVA must be docked before starting a resource mission.");
    const human = selectEligibleHuman(humans);
    if (!human) throw new Error("No eligible human is available at the suitport for a resource mission.");
    const mission = startResourceMission({ humanId: human.id, currentAction: "queued" });
    schedule(mission.id);
    return mission;
  }

  async function resumeActiveMission(seed: Pick<ResourceMission, "id" | "humanId">): Promise<ResourceMission> {
    const active = loadActiveResourceMission();
    const mission = active ?? startResourceMission({ id: seed.id, humanId: seed.humanId, currentAction: "queued" });
    if (mission.id !== seed.id) throw new Error("A different resource mission is already active.");
    schedule(mission.id);
    return mission;
  }

  async function stop(): Promise<ResourceMission | null> {
    const mission = loadActiveResourceMission();
    if (!mission) return null;
    return updateResourceMission(mission.id, { status: "stopping", stopReason: "operator-requested", currentAction: "returning" });
  }

  async function status(): Promise<{ mission: ResourceMission | null; eva: ResourceMissionEvaSnapshot | null }> {
    const mission = loadActiveResourceMission();
    try {
      const { eva } = await input.api.evaStatus();
      return { mission, eva: snapshotEva(eva) };
    } catch {
      return { mission, eva: null };
    }
  }

  function report(missionId?: string): ResourceMissionReport | null {
    return missionId ? loadResourceMissionReport(missionId) : loadLatestResourceMissionReport();
  }

  async function waitForCompletion(missionId: string): Promise<void> {
    await loops.get(missionId);
  }

  function schedule(missionId: string): void {
    if (loops.has(missionId)) return;
    const loop = new Promise<void>((resolve) => {
      setTimeout(() => {
        void run(missionId).finally(resolve);
      }, 0);
    }).finally(() => loops.delete(missionId));
    loops.set(missionId, loop);
  }

  async function run(missionId: string): Promise<void> {
    let failures = 0;
    while (true) {
      const mission = loadActiveResourceMission();
      if (!mission || mission.id !== missionId) return;
      let snapshot: ResourceMissionSnapshot;
      try {
        snapshot = await loadSnapshot(input.api);
      } catch (error) {
        failures += 1;
        appendResourceMissionIteration({ missionId, action: "snapshot", error: errorMessage(error) });
        if (failures >= 2) return finishAfterReturn(mission, "dependency-failure", "failed", errorMessage(error));
        await pause(delayMs);
        continue;
      }

      const stopReason = resourceStopReason(mission, snapshot);
      if (stopReason) return finishAfterReturn(mission, stopReason, "completed");

      const candidates = missionActions(mission, snapshot);
      const legalActions = candidates.filter((action) => evaluateResourceMissionAction(snapshot, action).allowed);
      if (!legalActions.length) return finishAfterReturn(mission, "no-safe-action", "completed");

      let actions: ResourceMissionAction[];
      let responseText: string | undefined;
      let planSource: string | undefined;
      try {
        const planned = await plan({
          mission,
          snapshot,
          legalActions,
          maxPlanSteps,
          recentIterations: (loadResourceMissionReport(mission.id)?.iterations ?? []).slice(-8),
        });
        if (Array.isArray(planned)) {
          actions = planned;
        } else {
          actions = planned.actions;
          responseText = planned.responseText;
          planSource = planned.source;
        }
      } catch (error) {
        const planningError = errorMessage(error);
        appendResourceMissionIteration({ missionId, action: "plan", error: planningError });
        if (!input.fallbackPlanOnError) return finishAfterReturn(mission, "dependency-failure", "failed", planningError);
        actions = [legalActions[0]!];
      }
      if (!Array.isArray(actions) || !actions.length || actions.length > maxPlanSteps) {
        const planningError = "Decision bridge returned an invalid trip plan.";
        appendResourceMissionIteration({ missionId, action: "plan", error: planningError });
        if (!input.fallbackPlanOnError) return finishAfterReturn(mission, "no-safe-action", "completed", planningError);
        actions = [legalActions[0]!];
      }
      if (responseText) {
        appendResourceMissionIteration({
          missionId,
          action: "plan",
          actionInput: {
            source: planSource ?? "planner",
            responseText,
            actions: actions.map((action) => ({ type: action.type, ...actionInput(action) })),
          },
        });
      }

      for (const action of actions) {
        const active = loadActiveResourceMission();
        if (!active || active.id !== missionId) return;
        const stepSnapshot = await loadSnapshot(input.api);
        const stepStopReason = resourceStopReason(active, stepSnapshot);
        if (stepStopReason) return finishAfterReturn(active, stepStopReason, "completed");
        if (!evaluateResourceMissionAction(stepSnapshot, action).allowed) break;

        updateResourceMission(mission.id, { currentAction: action.type });
        const before = stepSnapshot.eva;
        try {
          const result = await execute(action);
          const after = (await input.api.evaStatus()).eva;
          appendResourceMissionIteration({
            missionId,
            action: action.type,
            actionInput: actionInput(action),
            scan: action.type === "scan" ? result : undefined,
            collectedResources: action.type === "collect" ? collectedDelta(before, after) : undefined,
            evaSnapshot: snapshotEva(after),
          });
          failures = 0;
          if (action.type === "scan") break;
          const afterSnapshot = { ...stepSnapshot, eva: after };
          const afterStopReason = resourceStopReason(active, afterSnapshot);
          if (afterStopReason) return finishAfterReturn(active, afterStopReason, "completed");
        } catch (error) {
          failures += 1;
          appendResourceMissionIteration({ missionId, action: action.type, actionInput: actionInput(action), error: errorMessage(error), evaSnapshot: snapshotEva(before) });
          if (failures >= 2) return finishAfterReturn(active, "dependency-failure", "failed", errorMessage(error));
          break;
        }
      }
      await pause(delayMs);
    }
  }

  async function finishAfterReturn(mission: ResourceMission, reason: ResourceMissionStopReason, status: "completed" | "failed", error?: string): Promise<void> {
    try {
      await returnAndDock(mission.id);
    } catch (returnError) {
      status = "failed";
      error = error ?? errorMessage(returnError);
    }
    const finalEva = await input.api.evaStatus().then(({ eva }) => snapshotEva(eva)).catch(() => ({ unavailable: true }));
    finishResourceMission(mission.id, { status, stopReason: reason, error, finalEvaSnapshot: finalEva });
  }

  async function returnAndDock(missionId: string): Promise<void> {
    let eva = (await input.api.evaStatus()).eva;
    while (eva.deployedHumanId && (eva.x !== 0 || eva.y !== 0)) {
      const x = eva.x === 0 ? 0 : eva.x - Math.sign(eva.x);
      const y = eva.x === 0 ? eva.y - Math.sign(eva.y) : eva.y;
      const action: ResourceMissionAction = { type: "move", x, y };
      try {
        const snapshot = await loadSnapshot(input.api);
        const decision = evaluateResourceMissionAction(snapshot, action);
        if (!decision.allowed) throw new Error(decision.reason);
      } catch {
        // A temporary sector lookup failure must not strand an EVA. The return
        // vector is cardinal and moves toward the known dock at (0, 0).
      }
      updateResourceMission(missionId, { currentAction: "returning" });
      await input.api.move(x, y);
      eva = (await input.api.evaStatus()).eva;
      appendResourceMissionIteration({ missionId, action: "move", actionInput: { x, y }, evaSnapshot: snapshotEva(eva) });
    }
    if (eva.deployedHumanId) {
      updateResourceMission(missionId, { currentAction: "dock" });
      await input.api.dock();
      const docked = (await input.api.evaStatus()).eva;
      appendResourceMissionIteration({ missionId, action: "dock", evaSnapshot: snapshotEva(docked) });
    }
  }

  async function execute(action: ResourceMissionAction): Promise<Record<string, unknown>> {
    if (action.type === "deploy") return asRecord(await input.api.deploy(action.humanId));
    if (action.type === "scan") return input.api.scan(action.strength, action.radius);
    if (action.type === "collect") return input.api.collect(action.quantityKg);
    if (action.type === "move") return asRecord(await input.api.move(action.x, action.y));
    return asRecord(await input.api.dock());
  }

  return { start, resumeActiveMission, stop, status, report, waitForCompletion };
}

async function loadSnapshot(api: ResourceMissionApi): Promise<ResourceMissionSnapshot> {
  const [humans, eva, bounds] = await Promise.all([api.humans(), api.evaStatus(), api.bounds()]);
  return { registered: true, humans: humans.humans, eva: eva.eva, bounds };
}

function missionActions(mission: ResourceMission, snapshot: ResourceMissionSnapshot): ResourceMissionAction[] {
  if (!snapshot.eva.deployedHumanId) return [{ type: "deploy", humanId: mission.humanId }];
  const iterations = loadResourceMissionReport(mission.id)?.iterations ?? [];
  const previousAction = iterations.at(-1)?.action;
  if (previousAction === "scan") {
    const target = nearestScannedResource(iterations.at(-1)?.scan, snapshot.eva.x, snapshot.eva.y);
    if (target) return [{ type: "move", x: target.x, y: target.y }];
    const fallback = [[snapshot.eva.x + 1, snapshot.eva.y], [snapshot.eva.x - 1, snapshot.eva.y], [snapshot.eva.x, snapshot.eva.y + 1], [snapshot.eva.x, snapshot.eva.y - 1]]
      .find(([x, y]) => x >= snapshot.bounds.minX && x <= snapshot.bounds.maxX && y >= snapshot.bounds.minY && y <= snapshot.bounds.maxY);
    return fallback ? [{ type: "move", x: fallback[0], y: fallback[1] }] : [{ type: "scan", strength: DEFAULT_SCAN_STRENGTH, radius: DEFAULT_SCAN_RADIUS }];
  }
  if (previousAction === "move") return collectionActions(iterations, snapshot);
  return [{ type: "scan", strength: DEFAULT_SCAN_STRENGTH, radius: DEFAULT_SCAN_RADIUS }];
}

function collectionActions(iterations: ResourceMissionIteration[], snapshot: ResourceMissionSnapshot): ResourceMissionAction[] {
  const carriedKg = snapshot.eva.carriedResources.reduce((total, resource) => total + resource.quantityKg, 0);
  const remainingKg = Math.max(1, snapshot.eva.maxCarryingCapacityKg - carriedKg);
  const latestScan = [...iterations].reverse().find((iteration) => iteration.action === "scan");
  const target = scannedResourceAt(latestScan?.scan, snapshot.eva.x, snapshot.eva.y);
  const preferred = target?.estimatedKg ? Math.min(remainingKg, target.estimatedKg) : 1;
  return [...new Set([preferred, 1])].map((quantityKg) => ({ type: "collect", quantityKg }));
}

function scannedResourceAt(scan: Record<string, unknown> | null | undefined, x: number, y: number): { estimatedKg?: number } | null {
  const payload = isRecord(scan?.scan) ? scan.scan : scan;
  const tiles = Array.isArray(payload?.tiles) ? payload.tiles : [];
  const tile = tiles.find((candidate) => isRecord(candidate) && candidate.x === x && candidate.y === y && isRecord(candidate.quantityEstimate));
  if (!isRecord(tile) || !isRecord(tile.quantityEstimate)) return null;
  return typeof tile.quantityEstimate.estimatedKg === "number" ? { estimatedKg: Math.max(1, Math.floor(tile.quantityEstimate.estimatedKg)) } : {};
}

function nearestScannedResource(scan: Record<string, unknown> | null | undefined, x: number, y: number): { x: number; y: number; estimatedKg?: number } | null {
  const payload = isRecord(scan?.scan) ? scan.scan : scan;
  const tiles = Array.isArray(payload?.tiles) ? payload.tiles : [];
  const candidates = tiles
    .filter(isRecord)
    .filter((tile) => Math.abs(Number(tile.x) - x) + Math.abs(Number(tile.y) - y) === 1)
    .filter((tile) => isRecord(tile.quantityEstimate) && typeof tile.topCandidate === "object" && tile.topCandidate !== null && typeof (tile.topCandidate as Record<string, unknown>).resourceType === "string")
    .sort((left, right) => Number((right.quantityEstimate as Record<string, unknown>).estimatedKg ?? 0) - Number((left.quantityEstimate as Record<string, unknown>).estimatedKg ?? 0));
  const target = candidates[0];
  if (!target || typeof target.x !== "number" || typeof target.y !== "number") return null;
  const estimatedKg = isRecord(target.quantityEstimate) && typeof target.quantityEstimate.estimatedKg === "number" ? Math.max(1, Math.floor(target.quantityEstimate.estimatedKg)) : undefined;
  return { x: target.x, y: target.y, ...(estimatedKg === undefined ? {} : { estimatedKg }) };
}

function resourceStopReason(mission: ResourceMission, snapshot: ResourceMissionSnapshot): ResourceMissionStopReason | null {
  if (mission.status === "stopping") return "operator-requested";
  const carriedKg = snapshot.eva.carriedResources.reduce((total, resource) => total + resource.quantityKg, 0);
  if (carriedKg >= snapshot.eva.maxCarryingCapacityKg) return "capacity-reached";
  if (snapshot.eva.suitBattery <= snapshot.eva.maxSuitBattery * 0.25) return "low-battery";
  if (snapshot.eva.suitOxygen <= snapshot.eva.maxSuitOxygen * 0.25) return "low-oxygen";
  return null;
}

function selectEligibleHuman(humans: HabitatHuman[]): HabitatHuman | null {
  return humans.find((human) => (human.status === "idle" || human.status === "present") && human.locationModuleId.toLowerCase().includes("suitport")) ?? null;
}

function snapshotEva(eva: HabitatEvaState): ResourceMissionEvaSnapshot {
  return { ...eva, carriedResources: eva.carriedResources.map((resource) => ({ ...resource })) };
}

function collectedDelta(before: HabitatEvaState, after: HabitatEvaState): ResourceMissionCollectedResource[] {
  const previous = new Map(before.carriedResources.map((resource) => [resource.resourceId, resource.quantityKg]));
  return after.carriedResources.flatMap((resource) => {
    const quantityKg = resource.quantityKg - (previous.get(resource.resourceId) ?? 0);
    return quantityKg > 0 ? [{ resourceId: resource.resourceId, quantityKg }] : [];
  });
}

function actionInput(action: ResourceMissionAction): Record<string, unknown> {
  if (action.type === "deploy") return { humanId: action.humanId };
  if (action.type === "scan") return { strength: action.strength, radius: action.radius };
  if (action.type === "collect") return { quantityKg: action.quantityKg };
  if (action.type === "move") return { x: action.x, y: action.y };
  return {};
}

function sameAction(left: ResourceMissionAction, right: ResourceMissionAction): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pause(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
