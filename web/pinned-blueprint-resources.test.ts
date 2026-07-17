import { describe, expect, test } from "bun:test";
import { buildPinnedResourcePriorities } from "./pinned-blueprint-resources";

describe("pinned blueprint resource priorities", () => {
  test("aggregates pinned inputs and subtracts current inventory", () => {
    expect(buildPinnedResourcePriorities([
      { blueprintId: "battery", displayName: "Battery", inputs: { ferrite: 8, steel: 4 } },
      { blueprintId: "support", displayName: "Support", inputs: { ferrite: 2 } },
    ], ["battery", "support"], [{ resourceId: "ferrite", quantity: 5 }])).toEqual([
      { resourceId: "ferrite", quantityKg: 5 },
      { resourceId: "steel", quantityKg: 4 },
    ]);
  });
});
