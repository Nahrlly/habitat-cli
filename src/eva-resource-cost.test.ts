import { describe, expect, test } from "bun:test";
import {
  EVA_LOW_RESOURCE_RATIO,
  EVA_TICK_OXYGEN_COST,
  EVA_TICK_POWER_COST,
  estimateReturnReserve,
  isLowEVAResource,
  scanBatteryCost,
} from "./eva-resource-cost.js";

describe("EVA resource economics", () => {
  test("scales scan battery cost from zero to one percent of maximum", () => {
    expect(scanBatteryCost(100, 0)).toBe(0);
    expect(scanBatteryCost(100, 50)).toBe(0.5);
    expect(scanBatteryCost(100, 100)).toBe(1);
  });

  test("bounds scan inputs and never charges more than one percent", () => {
    expect(scanBatteryCost(100, -10)).toBe(0);
    expect(scanBatteryCost(100, 150)).toBe(1);
    expect(scanBatteryCost(-100, 100)).toBe(0);
  });

  test("uses a 25 percent low-resource threshold and quarter-unit tick costs", () => {
    expect(EVA_LOW_RESOURCE_RATIO).toBe(0.25);
    expect(EVA_TICK_OXYGEN_COST).toBe(0.25);
    expect(EVA_TICK_POWER_COST).toBe(0.25);
    expect(isLowEVAResource(25, 100)).toBe(true);
    expect(isLowEVAResource(26, 100)).toBe(false);
    expect(isLowEVAResource(0, 0)).toBe(true);
  });

  test("estimates oxygen and power reserves for the return distance", () => {
    const eva = { suitOxygen: 100, suitBattery: 100, maxSuitOxygen: 100, maxSuitBattery: 100 };

    expect(estimateReturnReserve(eva, 0)).toEqual({ oxygen: 0, power: 0 });
    expect(estimateReturnReserve(eva, 1)).toEqual({ oxygen: 0.25, power: 0.25 });
    expect(estimateReturnReserve(eva, 4)).toEqual({ oxygen: 1, power: 1 });
    expect(estimateReturnReserve(eva, -4)).toEqual({ oxygen: 0, power: 0 });
  });
});
