import { createApiClient } from "./api-client.js";
import { executeAutonomyAction, type ActionResult } from "./autonomy-actions.js";
import { evaluateAction, type AutonomyAction, type AutonomySnapshot } from "./autonomy-policy.js";
import { appendAutonomyAudit, listAutonomyAudits } from "./autonomy-state.js";
import type { HabitatEvaState, HabitatHuman } from "./types.js";

export type AutonomyRunResult = { action: AutonomyAction; policy: ReturnType<typeof evaluateAction>; actionResult: ActionResult; summary: string };
export type AutonomyRunInput = { scheduleName: string; cycleId?: string; decide?: (legal: AutonomyAction[]) => Promise<AutonomyAction>; api?: ReturnType<typeof createApiClient> };

export async function runAutonomyCycle(input: AutonomyRunInput): Promise<AutonomyRunResult> {
  const api = input.api ?? createApiClient();
  const snapshot = await loadSnapshot(api);
  const cycleId = input.cycleId ?? new Date().toISOString();
  const candidates: AutonomyAction[] = snapshot.eva.deployedHumanId ? [{ type: "collect", quantityKg: 1 }, { type: "move", x: snapshot.eva.x + 1, y: snapshot.eva.y }, { type: "noop" }] : deployableHumans(snapshot.humans).map((human) => ({ type: "deploy", humanId: human.id }));
  const legal = candidates.filter((action) => evaluateAction(snapshot, action, cycleId).allowed);
  const action = await (input.decide ?? (async (actions) => actions[0] ?? { type: "noop" }))(legal);
  const policy = evaluateAction(snapshot, action, cycleId);
  const actionResult = policy.allowed ? await executeAutonomyAction(action, api) : { ok: false, summary: policy.reason };
  const summary = `${action.type}: ${actionResult.summary}`;
  appendAutonomyAudit({ timestamp: new Date().toISOString(), scheduleName: input.scheduleName, snapshotSummary: `${snapshot.humans.length} humans; EVA ${snapshot.eva.deployedHumanId ? "deployed" : "docked"}`, chosenAction: JSON.stringify(action), policyResult: `${policy.code}: ${policy.reason}`, actionResult: actionResult.summary, operatorNote: summary });
  return { action, policy, actionResult, summary };
}

async function loadSnapshot(api: ReturnType<typeof createApiClient>): Promise<AutonomySnapshot> {
  const [humansResponse, evaResponse, boundsResponse] = await Promise.all([
    api.getJson<{ humans: HabitatHuman[] }>("/humans"),
    api.getJson<{ eva: HabitatEvaState }>("/eva/status"),
    api.getJson<unknown>("/world/sectors/current").catch(() => null),
  ]);
  const eva = evaResponse.eva;
  return { registered: true, humans: humansResponse.humans, eva: { deployedHumanId: eva.deployedHumanId, x: eva.x, y: eva.y, carriedKg: eva.carriedResources.reduce((sum, resource) => sum + resource.quantityKg, 0), capacityKg: eva.maxCarryingCapacityKg, exhausted: eva.exhausted }, bounds: normalizeBounds(boundsResponse) };
}

function deployableHumans(humans: HabitatHuman[]): HabitatHuman[] {
  return humans
    .filter((human) => human.status === "idle" || human.status === "present")
    .sort((a, b) => Number(isSuitportLocation(b.locationModuleId)) - Number(isSuitportLocation(a.locationModuleId)));
}

function isSuitportLocation(locationModuleId: string): boolean {
  return locationModuleId.toLowerCase().includes("suitport");
}

function normalizeBounds(response: unknown): AutonomySnapshot["bounds"] {
  if (isBounds(response)) return response;
  if (isRecord(response) && isRecord(response.sector) && isBounds(response.sector.bounds)) return response.sector.bounds;
  return null;
}

function isBounds(value: unknown): value is NonNullable<AutonomySnapshot["bounds"]> {
  return isRecord(value) && ["minX", "maxX", "minY", "maxY"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
