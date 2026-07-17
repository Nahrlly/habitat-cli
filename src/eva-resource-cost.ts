import type { HabitatEvaState } from "./types.js";

export const EVA_LOW_RESOURCE_RATIO = 0.25;
export const EVA_TICK_OXYGEN_COST = 0.25;
export const EVA_TICK_POWER_COST = 0.25;

export function scanBatteryCost(maxBattery: number, strength: number): number {
  const boundedMaximum = boundedNonNegative(maxBattery);
  const boundedStrength = Math.min(100, boundedNonNegative(strength));
  return boundedMaximum * (boundedStrength / 100) * 0.01;
}

export function isLowEVAResource(current: number, maximum: number): boolean {
  const boundedMaximum = boundedNonNegative(maximum);
  if (boundedMaximum === 0) return true;
  return !Number.isFinite(current) || current <= boundedMaximum * EVA_LOW_RESOURCE_RATIO;
}

export function estimateReturnReserve(
  _eva: Pick<HabitatEvaState, "suitOxygen" | "suitBattery" | "maxSuitOxygen" | "maxSuitBattery">,
  distance: number,
): { oxygen: number; power: number } {
  const boundedDistance = boundedNonNegative(distance);
  return {
    oxygen: boundedDistance * EVA_TICK_OXYGEN_COST,
    power: boundedDistance * EVA_TICK_POWER_COST,
  };
}

function boundedNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
