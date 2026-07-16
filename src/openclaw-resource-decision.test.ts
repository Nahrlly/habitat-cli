import { describe, expect, test } from "bun:test";
import { createOpenClawResourceDecision, createOpenClawResourcePlanner } from "./openclaw-resource-decision.js";

const context = {
  mission: { id: "mission-1", status: "running", humanId: "human-1" },
  snapshot: { registered: true, humans: [], eva: { deployedHumanId: "human-1", x: 0, y: 0, carriedResources: [], maxCarryingCapacityKg: 20, suitBattery: 100, maxSuitBattery: 100, suitOxygen: 100, maxSuitOxygen: 100, exhausted: false }, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } },
  legalActions: [{ type: "scan", strength: 50, radius: 1 }, { type: "collect", quantityKg: 1 }],
} as any;

describe("OpenClaw resource decision", () => {
  test("parses and accepts a legal action from the JSON envelope", async () => {
    let received = "";
    const decide = createOpenClawResourceDecision({ runAgent: async ({ message }) => { received = message; return JSON.stringify({ status: "ok", result: { finalAssistantVisibleText: '{"type":"scan","strength":50,"radius":1}' } }); } });
    await expect(decide(context)).resolves.toEqual({ type: "scan", strength: 50, radius: 1 });
    expect(received).toContain('"legalActions"');
  });

  test("rejects an action outside the legal set", async () => {
    const decide = createOpenClawResourceDecision({ runAgent: async () => JSON.stringify({ status: "ok", result: { finalAssistantVisibleText: '{"type":"move","x":99,"y":99}' } }) });
    await expect(decide(context)).rejects.toThrow("outside Habitat's legal action set");
  });

  test("parses a bounded multi-action trip plan", async () => {
    const plan = createOpenClawResourcePlanner({ runAgent: async ({ message }) => {
      expect(message).toContain("whole bounded");
      return JSON.stringify({ status: "ok", result: { finalAssistantVisibleText: '[{"type":"scan","strength":50,"radius":1},{"type":"move","x":1,"y":0},{"type":"collect","quantityKg":5}]' } });
    } });
    await expect(plan(context)).resolves.toEqual([
      { type: "scan", strength: 50, radius: 1 },
      { type: "move", x: 1, y: 0 },
      { type: "collect", quantityKg: 5 },
    ]);
  });

  test("rejects a plan that tries to return or exceeds the step limit", async () => {
    const plan = createOpenClawResourcePlanner({ maxPlanSteps: 2, runAgent: async () => JSON.stringify({ status: "ok", result: { finalAssistantVisibleText: '[{"type":"dock"},{"type":"scan","strength":50,"radius":1},{"type":"collect","quantityKg":1}]' } }) });
    await expect(plan(context)).rejects.toThrow("bounded trip plan");
  });
});
