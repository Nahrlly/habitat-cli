import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "./server.js";
import { saveState } from "./state.js";
import type { KeplerRegistration } from "./types.js";

const previousDataDirectory = process.env.HABITAT_DATA_DIRECTORY;
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  if (previousDataDirectory === undefined) delete process.env.HABITAT_DATA_DIRECTORY;
  else process.env.HABITAT_DATA_DIRECTORY = previousDataDirectory;
});

describe("resource mission routes", () => {
  test("exposes immediate start, active status, stop, and persisted report", async () => {
    useTemporaryDatabase();
    saveState({
      habitatId: "habitat-1",
      habitatUuid: "uuid-1",
      displayName: "Test Habitat",
      apiToken: "token",
      streamUrl: "ws://example.test",
      stream: { protocolVersion: "1", subscriptions: [], currentTick: 0, tickIntervalMs: 1, ticksPerPulse: 1, status: "paused" },
      contracts: { alerts: { schemaVersion: "1", schema: {} } },
      habitat: { id: "habitat-1", habitatSlug: "test", displayName: "Test Habitat", catalogVersion: "1", status: "registered", lastSeenAt: null },
      modules: [{ id: "basic-suitport", selector: "basic-suitport", blueprintId: "basic-suitport", displayName: "Suitport", connectedTo: [], runtimeAttributes: { status: "active" }, capabilities: ["limited-eva"] }],
      blueprints: [],
      humans: [{ id: "human-1", displayName: "Ada", locationModuleId: "basic-suitport", status: "present" }],
      alerts: [],
    } as unknown as KeplerRegistration);

    const start = await app.request("http://habitat.test/autonomy/mission/start", { method: "POST" });
    expect(start.status).toBe(202);
    const started = await start.json() as { mission: { id: string } };

    const status = await app.request("http://habitat.test/autonomy/mission/status");
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ mission: { id: started.mission.id } });

    const stop = await app.request("http://habitat.test/autonomy/mission/stop", { method: "POST" });
    expect(stop.status).toBe(200);

    const report = await app.request("http://habitat.test/autonomy/mission/report");
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({ report: { id: started.mission.id } });
  });
});

function useTemporaryDatabase(): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), "habitat-resource-routes-"));
  directories.push(directory);
  process.env.HABITAT_DATA_DIRECTORY = directory;
}
