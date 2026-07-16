import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { runAutonomyCycle } from "./autonomy-controller.js";

const originalDataDirectory = process.env.HABITAT_DATA_DIRECTORY;

afterEach(() => {
  if (originalDataDirectory === undefined) {
    delete process.env.HABITAT_DATA_DIRECTORY;
  } else {
    process.env.HABITAT_DATA_DIRECTORY = originalDataDirectory;
  }
});

describe("autonomy controller", () => {
  test("deploys a present human from the suitport when EVA is docked", async () => {
    process.env.HABITAT_DATA_DIRECTORY = mkdtempSync(path.join(tmpdir(), "habitat-autonomy-test-"));
    const posts: Array<{ path: string; body: unknown }> = [];
    const api = {
      getJson: async (requestPath: string) => {
        if (requestPath === "/humans") {
          return {
            humans: [
              { id: "human-command", displayName: "Alice", locationModuleId: "command_module_1", status: "present" },
              { id: "human-suitport", displayName: "Ada", locationModuleId: "basic_suitport_1", status: "present" },
            ],
          };
        }
        if (requestPath === "/eva/status") {
          return {
            eva: {
              deployedHumanId: null,
              x: 0,
              y: 0,
              carriedResources: [],
              maxCarryingCapacityKg: 20,
              exhausted: false,
            },
          };
        }
        if (requestPath === "/world/sectors/current") {
          return { sector: { bounds: { minX: -25, maxX: 24, minY: -25, maxY: 24 } } };
        }
        throw new Error(`Unexpected GET ${requestPath}`);
      },
      postJson: async (requestPath: string, body: unknown) => {
        posts.push({ path: requestPath, body });
        return { ok: true };
      },
    };

    const result = await runAutonomyCycle({ scheduleName: "test", api });

    expect(result.action).toEqual({ type: "deploy", humanId: "human-suitport" });
    expect(posts).toEqual([{ path: "/eva/deploy", body: { humanId: "human-suitport" } }]);
  });

  test("uses nested sector bounds when selecting an EVA action", async () => {
    process.env.HABITAT_DATA_DIRECTORY = mkdtempSync(path.join(tmpdir(), "habitat-autonomy-test-"));
    const posts: Array<{ path: string; body: unknown }> = [];
    const api = {
      getJson: async (requestPath: string) => {
        if (requestPath === "/humans") {
          return { humans: [{ id: "human-1", displayName: "Ada", locationModuleId: "suitport", status: "present" }] };
        }
        if (requestPath === "/eva/status") {
          return {
            eva: {
              deployedHumanId: "human-1",
              x: 0,
              y: -1,
              carriedResources: [],
              maxCarryingCapacityKg: 20,
              exhausted: false,
            },
          };
        }
        if (requestPath === "/world/sectors/current") {
          return { sector: { bounds: { minX: -25, maxX: 24, minY: -25, maxY: 24 } } };
        }
        throw new Error(`Unexpected GET ${requestPath}`);
      },
      postJson: async (requestPath: string, body: unknown) => {
        posts.push({ path: requestPath, body });
        return { ok: true };
      },
    };

    const result = await runAutonomyCycle({ scheduleName: "test", api });

    expect(result.action.type).toBe("collect");
    expect(posts).toEqual([{ path: "/world/collect", body: { quantityKg: 1 } }]);
  });

  test("does not move outside nested sector bounds when collection is blocked", async () => {
    process.env.HABITAT_DATA_DIRECTORY = mkdtempSync(path.join(tmpdir(), "habitat-autonomy-test-"));
    const posts: Array<{ path: string; body: unknown }> = [];
    const api = {
      getJson: async (requestPath: string) => {
        if (requestPath === "/humans") {
          return { humans: [{ id: "human-1", displayName: "Ada", locationModuleId: "suitport", status: "present" }] };
        }
        if (requestPath === "/eva/status") {
          return {
            eva: {
              deployedHumanId: "human-1",
              x: 24,
              y: 0,
              carriedResources: [{ resourceId: "ore", displayName: "Ore", quantityKg: 20 }],
              maxCarryingCapacityKg: 20,
              exhausted: false,
            },
          };
        }
        if (requestPath === "/world/sectors/current") {
          return { sector: { bounds: { minX: -25, maxX: 24, minY: -25, maxY: 24 } } };
        }
        throw new Error(`Unexpected GET ${requestPath}`);
      },
      postJson: async (requestPath: string, body: unknown) => {
        posts.push({ path: requestPath, body });
        return { ok: true };
      },
    };

    const result = await runAutonomyCycle({ scheduleName: "test", api });

    expect(result.action).toEqual({ type: "noop" });
    expect(posts).toEqual([]);
  });
});
