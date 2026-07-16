import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createResourceMissionController } from "./resource-mission-controller.js";

const previousDataDirectory = process.env.HABITAT_DATA_DIRECTORY;
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  if (previousDataDirectory === undefined) delete process.env.HABITAT_DATA_DIRECTORY;
  else process.env.HABITAT_DATA_DIRECTORY = previousDataDirectory;
});

describe("resource mission controller", () => {
  test("deploys, scans, collects to capacity, and docks from the origin", async () => {
    useTemporaryDatabase();
    const harness = createHarness();
    const controller = createResourceMissionController({ api: harness.api, delayMs: 0 });

    const mission = await controller.start();
    await controller.waitForCompletion(mission.id);

    expect(harness.calls).toEqual(["deploy", "scan:50:1", "move:1:0", "collect:1", "move:0:0", "dock"]);
    expect(controller.report()).toMatchObject({
      id: mission.id,
      status: "completed",
      stopReason: "capacity-reached",
      iterations: [
        { action: "deploy" },
        { action: "scan" },
        { action: "move" },
        { action: "collect" },
        { action: "move" },
        { action: "dock" },
      ],
    });
  });

  test("stops resource work at the battery threshold and returns cardinally before docking", async () => {
    useTemporaryDatabase();
    const harness = createHarness({ x: 2, y: -1, deployedHumanId: "human-1", suitBattery: 25 });
    const controller = createResourceMissionController({ api: harness.api, delayMs: 0 });
    const mission = await controller.resumeActiveMission({ id: "mission-1", humanId: "human-1" });
    await controller.waitForCompletion(mission.id);

    expect(harness.calls).toEqual(["move:1:-1", "move:0:-1", "move:0:0", "dock"]);
    expect(controller.report()).toMatchObject({ status: "completed", stopReason: "low-battery" });
  });

  test("requests a safe stop without allowing another resource action", async () => {
    useTemporaryDatabase();
    const harness = createHarness({ x: 1, y: 0, deployedHumanId: "human-1" });
    const controller = createResourceMissionController({ api: harness.api, delayMs: 5 });
    const mission = await controller.resumeActiveMission({ id: "mission-1", humanId: "human-1" });
    await controller.stop();
    await controller.waitForCompletion(mission.id);

    expect(harness.calls).toEqual(["move:0:0", "dock"]);
    expect(controller.report()).toMatchObject({ status: "completed", stopReason: "operator-requested" });
  });

  test("executes multiple actions from one OpenClaw trip plan before replanning", async () => {
    useTemporaryDatabase();
    const harness = createHarness({ maxCarryingCapacityKg: 5 });
    let planCalls = 0;
    const controller = createResourceMissionController({
      api: harness.api,
      delayMs: 0,
      plan: async () => {
        planCalls += 1;
        return planCalls === 1
          ? [{ type: "deploy", humanId: "human-1" }, { type: "scan", strength: 50, radius: 1 }]
          : [{ type: "move", x: 1, y: 0 }, { type: "collect", quantityKg: 3 }, { type: "move", x: 0, y: 0 }, { type: "collect", quantityKg: 2 }];
      },
    });

    const mission = await controller.start();
    await controller.waitForCompletion(mission.id);

    expect(planCalls).toBe(2);
    expect(harness.calls).toEqual(["deploy", "scan:50:1", "move:1:0", "collect:3", "move:0:0", "collect:2", "dock"]);
    expect(controller.report()).toMatchObject({ status: "completed", stopReason: "capacity-reached" });
  });

  test("returns and docks when bounds telemetry fails after EVA leaves origin", async () => {
    useTemporaryDatabase();
    const harness = createHarness({ boundsFailureAt: { x: 1, y: 0 } });
    const controller = createResourceMissionController({
      api: harness.api,
      delayMs: 0,
      plan: async () => [{ type: "deploy", humanId: "human-1" }, { type: "move", x: 1, y: 0 }],
    });

    const mission = await controller.start();
    await controller.waitForCompletion(mission.id);

    expect(harness.calls).toEqual(["deploy", "move:1:0", "move:0:0", "dock"]);
    expect(controller.report()).toMatchObject({ status: "failed", stopReason: "dependency-failure", finalEvaSnapshot: { deployedHumanId: null, x: 0, y: 0 } });
  });

  test("uses Habitat's safe next action when the planner is unavailable", async () => {
    useTemporaryDatabase();
    const harness = createHarness();
    const controller = createResourceMissionController({
      api: harness.api,
      delayMs: 0,
      fallbackPlanOnError: true,
      plan: async () => { throw new Error("OpenClaw unavailable"); },
    });

    const mission = await controller.start();
    await controller.waitForCompletion(mission.id);

    expect(harness.calls).toEqual(["deploy", "scan:50:1", "move:1:0", "collect:1", "move:0:0", "dock"]);
    expect(controller.report()).toMatchObject({ status: "completed", stopReason: "capacity-reached" });
  });

  test("offers a scan-informed batch quantity to the planner", async () => {
    useTemporaryDatabase();
    const harness = createHarness({ maxCarryingCapacityKg: 4, scanEstimateKg: 4 });
    let planCalls = 0;
    const controller = createResourceMissionController({
      api: harness.api,
      delayMs: 0,
      plan: async ({ legalActions }) => {
        planCalls += 1;
        if (planCalls === 1) return [{ type: "deploy", humanId: "human-1" }, { type: "scan", strength: 50, radius: 1 }];
        if (planCalls === 2) return [{ type: "move", x: 1, y: 0 }];
        expect(legalActions).toContainEqual({ type: "collect", quantityKg: 4 });
        return [{ type: "collect", quantityKg: 4 }];
      },
    });

    const mission = await controller.start();
    await controller.waitForCompletion(mission.id);

    expect(planCalls).toBe(3);
    expect(harness.calls).toEqual(["deploy", "scan:50:1", "move:1:0", "collect:4", "move:0:0", "dock"]);
  });
});

function createHarness(initial: Partial<{ deployedHumanId: string | null; x: number; y: number; suitBattery: number; suitOxygen: number; carriedKg: number; maxCarryingCapacityKg: number; boundsFailureAt: { x: number; y: number }; scanEstimateKg: number }> = {}) {
  const calls: string[] = [];
  const eva = {
    deployedHumanId: initial.deployedHumanId ?? null,
    x: initial.x ?? 0,
    y: initial.y ?? 0,
    carriedResources: initial.carriedKg ? [{ resourceId: "ice", quantityKg: initial.carriedKg }] : [],
    maxCarryingCapacityKg: initial.maxCarryingCapacityKg ?? 1,
    suitBattery: initial.suitBattery ?? 100,
    maxSuitBattery: 100,
    suitOxygen: initial.suitOxygen ?? 100,
    maxSuitOxygen: 100,
    exhausted: false,
  };
  const api = {
    humans: async () => ({ humans: [{ id: "human-1", displayName: "Ada", locationModuleId: "basic-suitport", status: "present" }] }),
    evaStatus: async () => ({ eva: { ...eva, carriedResources: eva.carriedResources.map((resource) => ({ ...resource })) } }),
    bounds: async () => { if (initial.boundsFailureAt && eva.x === initial.boundsFailureAt.x && eva.y === initial.boundsFailureAt.y) throw new Error("temporary bounds failure"); return { minX: -2, maxX: 2, minY: -2, maxY: 2 }; },
    deploy: async (humanId: string) => { calls.push("deploy"); eva.deployedHumanId = humanId; },
    scan: async (strength: number, radius: number) => { calls.push(`scan:${strength}:${radius}`); return { scan: { tiles: initial.scanEstimateKg ? [{ x: 1, y: 0, topCandidate: { resourceType: "ice" }, quantityEstimate: { estimatedKg: initial.scanEstimateKg } }] : [] } }; },
    collect: async (quantityKg: number) => { calls.push(`collect:${quantityKg}`); const current = eva.carriedResources[0]?.quantityKg ?? 0; eva.carriedResources = [{ resourceId: "ice", quantityKg: current + quantityKg }]; return { resourceId: "ice", quantityKg }; },
    move: async (x: number, y: number) => { calls.push(`move:${x}:${y}`); eva.x = x; eva.y = y; },
    dock: async () => { calls.push("dock"); eva.deployedHumanId = null; },
  };
  return { api, calls };
}

function useTemporaryDatabase(): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), "habitat-resource-controller-"));
  directories.push(directory);
  process.env.HABITAT_DATA_DIRECTORY = directory;
}
