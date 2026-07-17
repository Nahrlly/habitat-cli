import { describe, expect, test } from "bun:test";
import { evaluateAction, type AutonomyAction, type AutonomySnapshot } from "./autonomy-policy.js";

const baseSnapshot: AutonomySnapshot = {
  registered: true,
  humans: [{ id: "h1", displayName: "Ada", locationModuleId: "suitport", status: "idle" }],
  eva: { deployedHumanId: null, x: 0, y: 0, carriedKg: 0, capacityKg: 20, exhausted: false },
  bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
};

describe("autonomy policy", () => {
  test("allows an eligible human deployment", () => {
    expect(evaluateAction(baseSnapshot, { type: "deploy", humanId: "h1" }, "cycle-1")).toEqual({ allowed: true, code: "allowed", reason: "Action is allowed." });
  });

  test("allows a present human deployment", () => {
    const snapshot = { ...baseSnapshot, humans: [{ ...baseSnapshot.humans[0], status: "present" }] };
    expect(evaluateAction(snapshot, { type: "deploy", humanId: "h1" }, "cycle-1").allowed).toBe(true);
  });

  test("blocks collection over carrying capacity", () => {
    const snapshot = { ...baseSnapshot, eva: { ...baseSnapshot.eva, deployedHumanId: "h1", carriedKg: 19, capacityKg: 20 } };
    expect(evaluateAction(snapshot, { type: "collect", quantityKg: 2 }, "cycle-1").code).toBe("capacity");
  });

  test("blocks moves outside world bounds", () => {
    const snapshot = { ...baseSnapshot, eva: { ...baseSnapshot.eva, deployedHumanId: "h1", x: 2 } };
    expect(evaluateAction(snapshot, { type: "move", x: 3, y: 0 }, "cycle-1").code).toBe("bounds");
  });

  test("blocks actions when the Habitat is unavailable", () => {
    expect(evaluateAction({ ...baseSnapshot, registered: false }, { type: "deploy", humanId: "h1" }, "cycle-1").code).toBe("unavailable");
  });
});
