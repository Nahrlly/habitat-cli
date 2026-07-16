import { dockEvaStateAtomically, loadKeplerRegistration, loadEvaState, saveEvaState } from "./state.js";
import type { HabitatEvaState } from "./types.js";
import { createOperationalAlert } from "./alerts-domain.js";

const DEFAULT_CAPACITY_KG = 20;
export const SUIT_BATTERY_CAPACITY = 100;
export const SUIT_OXYGEN_CAPACITY = 100;
export const SUIT_BATTERY_PER_TICK = 1;
export const SUIT_OXYGEN_PER_TICK = 1;
export const SUIT_LOW_THRESHOLD = 0.25;

export function getEvaStatus(): HabitatEvaState {
  return loadEvaState() ?? { deployedHumanId: null, x: 0, y: 0, carriedResources: [], maxCarryingCapacityKg: getSuitportCapacity(), suitBattery: SUIT_BATTERY_CAPACITY, maxSuitBattery: SUIT_BATTERY_CAPACITY, suitOxygen: SUIT_OXYGEN_CAPACITY, maxSuitOxygen: SUIT_OXYGEN_CAPACITY, batteryConsumptionPerTick: SUIT_BATTERY_PER_TICK, oxygenConsumptionPerTick: SUIT_OXYGEN_PER_TICK, estimatedTicksRemaining: 0, exhausted: false };
}

export type EvaSectorBounds = { minX: number; maxX: number; minY: number; maxY: number };

export function deployEva(humanId: string): HabitatEvaState {
  const registration = requireRegistration();
  const human = registration.humans.find((entry) => entry.id === humanId);
  if (!human) throw new Error(`Human not found: ${humanId}.`);
  const suitport = findSuitport(registration.modules);
  if (!suitport) throw new Error("EVA entry point unavailable: starter basic-suitport module was not found.");
  if (suitport.runtimeAttributes.status !== "active") {
    throw new Error("EVA entry point unavailable: the basic-suitport module is not active.");
  }
  if (human.locationModuleId !== suitport.id && human.locationModuleId !== suitport.selector) {
    throw new Error(`Human ${humanId} must be in the active basic-suitport before EVA deployment.`);
  }
  const current = getEvaStatus();
  if (current.deployedHumanId && current.deployedHumanId !== humanId) throw new Error(`EVA is already deployed by human ${current.deployedHumanId}.`);
  const next = { ...current, deployedHumanId: humanId, x: 0, y: 0, carriedResources: [], maxCarryingCapacityKg: getSuitportCapacity(), suitBattery: SUIT_BATTERY_CAPACITY, maxSuitBattery: SUIT_BATTERY_CAPACITY, suitOxygen: SUIT_OXYGEN_CAPACITY, maxSuitOxygen: SUIT_OXYGEN_CAPACITY, batteryConsumptionPerTick: SUIT_BATTERY_PER_TICK, oxygenConsumptionPerTick: SUIT_OXYGEN_PER_TICK, estimatedTicksRemaining: SUIT_BATTERY_CAPACITY, exhausted: false };
  saveEvaState(next);
  createOperationalAlert({ type: "human-deployed-outside", message: `${human.displayName} is deployed outside the habitat.`, subject: { type: "human", id: human.id }, details: { x: next.x, y: next.y } });
  return next;
}

export function moveEva(x: number, y: number, bounds?: EvaSectorBounds): HabitatEvaState {
  const current = getEvaStatus();
  if (!current.deployedHumanId) throw new Error("EVA is not deployed.");
  if (current.exhausted) throw new Error("EVA is exhausted: the human did not return in time.");
  const dx = Math.abs(x - current.x);
  const dy = Math.abs(y - current.y);
  if (dx + dy !== 1) throw new Error("EVA moves must be exactly one tile north, south, east, or west.");
  if (bounds && (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY)) {
    throw new Error("EVA move is outside the current Kepler sector.");
  }
  const next = { ...current, x, y };
  saveEvaState(next);
  return next;
}

export function dockEva(): HabitatEvaState {
  const current = getEvaStatus();
  if (!current.deployedHumanId) throw new Error("EVA is not deployed.");
  if (current.exhausted) throw new Error("EVA is exhausted: the human did not return in time.");
  if (current.x !== 0 || current.y !== 0) throw new Error("EVA can only dock at coordinates (0, 0).");
  const registration = requireRegistration();
  const suitport = findSuitport(registration.modules);
  if (!suitport) throw new Error("EVA entry point unavailable: starter basic-suitport module was not found.");
  return dockEvaStateAtomically(current.deployedHumanId, suitport.id, current.carriedResources);
}

function requireRegistration() {
  const registration = loadKeplerRegistration();
  if (!registration) throw new Error("Habitat is not registered.");
  return registration;
}

function findSuitport(modules: ReturnType<typeof requireRegistration>["modules"]) {
  return modules.find((module) => module.blueprintId === "basic-suitport" && module.capabilities.some((capability) => capability === "limited-eva" || capability === "suitport-access"));
}

function getSuitportCapacity(): number {
  const registration = requireRegistration();
  const suitport = findSuitport(registration.modules);
  const value = suitport?.runtimeAttributes.maxCarryingCapacityKg ?? suitport?.runtimeAttributes.carryingCapacityKg;
  return typeof value === "number" && value >= 0 ? value : DEFAULT_CAPACITY_KG;
}
