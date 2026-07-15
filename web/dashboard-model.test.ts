import { describe, expect, test } from "bun:test";
import { buildPowerCards } from "./dashboard-model";

describe("dashboard power model", () => {
  test("maps server-provided power values without inventing module rules", () => {
    expect(buildPowerCards({ generationKw: 12, consumptionKw: 4.5, netKw: 7.5 })).toEqual([
      { label: "Generation", value: "12.0", unit: "kW", tone: "purple" },
      { label: "Consumption", value: "4.5", unit: "kW", tone: "blue" },
      { label: "Net power", value: "+7.5", unit: "kW", tone: "green" },
    ]);
  });
});
