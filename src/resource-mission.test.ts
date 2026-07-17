import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appendResourceMissionIteration,
  finishResourceMission,
  loadActiveResourceMission,
  loadResourceMissionReport,
  startResourceMission,
  updateResourceMission,
} from "./resource-mission-state.js";

const previousDataDirectory = process.env.HABITAT_DATA_DIRECTORY;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  if (previousDataDirectory === undefined) delete process.env.HABITAT_DATA_DIRECTORY;
  else process.env.HABITAT_DATA_DIRECTORY = previousDataDirectory;
});

describe("resource mission state", () => {
  test("has no active mission before one is started", () => {
    useTemporaryDatabase();

    expect(loadActiveResourceMission()).toBeNull();
  });

  test("loads the one running mission", () => {
    useTemporaryDatabase();

    const mission = startResourceMission({ id: "mission-1", humanId: "human-1", startedAt: "2026-07-16T10:00:00.000Z" });

    expect(loadActiveResourceMission()).toEqual(mission);
  });

  test("rejects a second start while a mission is active", () => {
    useTemporaryDatabase();
    startResourceMission({ id: "mission-1", humanId: "human-1" });

    expect(() => startResourceMission({ id: "mission-2", humanId: "human-2" })).toThrow("A resource mission is already active.");
  });

  test("loads iterations in append-only sequence order", () => {
    useTemporaryDatabase();
    startResourceMission({ id: "mission-1", humanId: "human-1" });

    appendResourceMissionIteration({ missionId: "mission-1", action: "scan", scan: { strength: 50 } });
    appendResourceMissionIteration({ missionId: "mission-1", action: "collect", collectedResources: [{ resourceId: "ice", quantityKg: 2 }] });

    expect(loadResourceMissionReport("mission-1")?.iterations.map((iteration) => [iteration.sequence, iteration.action])).toEqual([
      [1, "scan"],
      [2, "collect"],
    ]);
  });

  test("persists an operator stop request while the mission remains active", () => {
    useTemporaryDatabase();
    startResourceMission({ id: "mission-1", humanId: "human-1" });

    const mission = updateResourceMission("mission-1", { status: "stopping", stopReason: "operator-requested" });

    expect(mission).toMatchObject({ id: "mission-1", status: "stopping", stopReason: "operator-requested" });
    expect(loadActiveResourceMission()).toMatchObject({ id: "mission-1", status: "stopping" });
  });

  test("persists completion and aggregates the final report", () => {
    useTemporaryDatabase();
    startResourceMission({ id: "mission-1", humanId: "human-1" });
    appendResourceMissionIteration({
      missionId: "mission-1",
      action: "scan",
      scan: { strength: 100, tiles: [{ x: 1, y: 0 }] },
      collectedResources: [{ resourceId: "ice", quantityKg: 2 }],
    });

    finishResourceMission("mission-1", {
      status: "completed",
      stopReason: "capacity-reached",
      finalEvaSnapshot: { deployedHumanId: null, x: 0, y: 0 },
    });

    expect(loadActiveResourceMission()).toBeNull();
    expect(loadResourceMissionReport("mission-1")).toMatchObject({
      status: "completed",
      stopReason: "capacity-reached",
      scans: [{ strength: 100, tiles: [{ x: 1, y: 0 }] }],
      collectedResources: [{ resourceId: "ice", quantityKg: 2 }],
      finalEvaSnapshot: { deployedHumanId: null, x: 0, y: 0 },
    });
  });

  test("persists failure errors in the final report", () => {
    useTemporaryDatabase();
    startResourceMission({ id: "mission-1", humanId: "human-1" });
    appendResourceMissionIteration({ missionId: "mission-1", action: "scan", error: "Kepler scan unavailable" });

    finishResourceMission("mission-1", {
      status: "failed",
      stopReason: "dependency-failure",
      error: "Mission stopped after repeated scan failures.",
      finalEvaSnapshot: { deployedHumanId: "human-1", x: 2, y: 1 },
    });

    expect(loadResourceMissionReport("mission-1")).toMatchObject({
      status: "failed",
      stopReason: "dependency-failure",
      error: "Mission stopped after repeated scan failures.",
      errors: ["Kepler scan unavailable", "Mission stopped after repeated scan failures."],
      finalEvaSnapshot: { deployedHumanId: "human-1", x: 2, y: 1 },
    });
  });

  test("rejects iterations after a mission is finished", () => {
    useTemporaryDatabase();
    startResourceMission({ id: "mission-1", humanId: "human-1" });
    finishResourceMission("mission-1", {
      status: "completed",
      stopReason: "completed",
      finalEvaSnapshot: { deployedHumanId: null, x: 0, y: 0 },
    });

    expect(() => appendResourceMissionIteration({ missionId: "mission-1", action: "scan" })).toThrow("Resource mission is not active: mission-1.");
  });
});

function useTemporaryDatabase(): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), "habitat-resource-mission-"));
  temporaryDirectories.push(directory);
  process.env.HABITAT_DATA_DIRECTORY = directory;
}
