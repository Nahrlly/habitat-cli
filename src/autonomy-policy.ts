import { isLowEVAResource } from "./eva-resource-cost.js";
import type { HabitatEvaState, HabitatHuman } from "./types.js";

export type AutonomyAction =
  | { type: "deploy"; humanId: string }
  | { type: "move"; x: number; y: number }
  | { type: "collect"; quantityKg: number }
  | { type: "noop" };

export type AutonomySnapshot = {
  registered: boolean;
  humans: HabitatHuman[];
  eva: { deployedHumanId: string | null; x: number; y: number; carriedKg: number; capacityKg: number; exhausted: boolean };
  bounds: { minX: number; maxX: number; minY: number; maxY: number } | null;
};

export type PolicyDecision = { allowed: boolean; code: string; reason: string };

export type ResourceMissionAction =
  | { type: "deploy"; humanId: string }
  | { type: "move"; x: number; y: number }
  | { type: "scan"; strength: number; radius: number }
  | { type: "collect"; quantityKg: number }
  | { type: "dock" };

export type ResourceMissionSnapshot = {
  registered: boolean;
  humans: HabitatHuman[];
  eva: HabitatEvaState;
  bounds: NonNullable<AutonomySnapshot["bounds"]>;
};

export function evaluateAction(snapshot: AutonomySnapshot, action: AutonomyAction, cycleId: string): PolicyDecision {
  if (!snapshot.registered || !snapshot.bounds) return blocked("unavailable", "Habitat state is unavailable.");
  if (action.type === "noop") return allowed();
  if (!cycleId.trim()) return blocked("cycle", "Autonomy cycle id is required.");
  if (action.type === "deploy") {
    const human = snapshot.humans.find((candidate) => candidate.id === action.humanId);
    if (!human) return blocked("human", `Human not found: ${action.humanId}.`);
    if (snapshot.eva.deployedHumanId) return blocked("deployed", "EVA is already deployed.");
    if (!isDeployableHumanStatus(human.status)) return blocked("human-status", "Selected human is not available for deployment.");
    return allowed();
  }
  if (snapshot.eva.exhausted || !snapshot.eva.deployedHumanId) return blocked("eva", "EVA must be deployed and operational.");
  if (action.type === "move") {
    const distance = Math.abs(action.x - snapshot.eva.x) + Math.abs(action.y - snapshot.eva.y);
    if (distance !== 1) return blocked("step", "EVA moves must be exactly one tile.");
    if (action.x < snapshot.bounds.minX || action.x > snapshot.bounds.maxX || action.y < snapshot.bounds.minY || action.y > snapshot.bounds.maxY) return blocked("bounds", "Move is outside the current world bounds.");
    return allowed();
  }
  if (!Number.isFinite(action.quantityKg) || action.quantityKg <= 0) return blocked("quantity", "Collection quantity must be positive.");
  if (snapshot.eva.carriedKg + action.quantityKg > snapshot.eva.capacityKg) return blocked("capacity", "Collection exceeds EVA carrying capacity.");
  return allowed();
}

function allowed(): PolicyDecision { return { allowed: true, code: "allowed", reason: "Action is allowed." }; }
function blocked(code: string, reason: string): PolicyDecision { return { allowed: false, code, reason }; }
function isDeployableHumanStatus(status: string): boolean { return status === "idle" || status === "present"; }

export function evaluateResourceMissionAction(snapshot: ResourceMissionSnapshot, action: ResourceMissionAction): PolicyDecision {
  const base: AutonomySnapshot = {
    registered: snapshot.registered,
    humans: snapshot.humans,
    eva: {
      deployedHumanId: snapshot.eva.deployedHumanId,
      x: snapshot.eva.x,
      y: snapshot.eva.y,
      carriedKg: snapshot.eva.carriedResources.reduce((total, resource) => total + resource.quantityKg, 0),
      capacityKg: snapshot.eva.maxCarryingCapacityKg,
      exhausted: snapshot.eva.exhausted,
    },
    bounds: snapshot.bounds,
  };
  if (action.type === "deploy" || action.type === "move" || action.type === "collect") return evaluateAction(base, action, "resource-mission");
  if (!snapshot.eva.deployedHumanId || snapshot.eva.exhausted) return blocked("eva", "EVA must be deployed and operational.");
  if (action.type === "dock") return snapshot.eva.x === 0 && snapshot.eva.y === 0 ? allowed() : blocked("dock", "EVA can only dock at coordinates (0, 0).");
  if (!Number.isInteger(action.strength) || action.strength < 0 || action.strength > 100 || !Number.isInteger(action.radius) || action.radius < 0 || action.radius > 5) {
    return blocked("scan", "Scan strength and radius are outside the supported range.");
  }
  if (isLowEVAResource(snapshot.eva.suitBattery, snapshot.eva.maxSuitBattery) || isLowEVAResource(snapshot.eva.suitOxygen, snapshot.eva.maxSuitOxygen)) {
    return blocked("reserve", "EVA resources are at the mission safety threshold.");
  }
  return allowed();
}
