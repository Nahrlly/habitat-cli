import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, clockManager } from "./server.js";
import { deployEva, getEvaStatus } from "./eva-domain.js";
import { saveState } from "./state.js";
import type { KeplerRegistration } from "./types.js";

const previousDataDirectory = process.env.HABITAT_DATA_DIRECTORY;
const previousKeplerBaseUrl = process.env.KEPLER_BASE_URL;
const previousKeplerToken = process.env.KEPLER_PLANET_TOKEN;
const previousRemoteMode = process.env.HABITAT_REMOTE_MODE;
const originalFetch = globalThis.fetch;
const temporaryDirectories: string[] = [];

const registration: KeplerRegistration = {
  habitatId: "habitat-resource-test",
  habitatUuid: "uuid-resource-test",
  displayName: "Resource Test Habitat",
  streamUrl: "wss://planet.example/stream",
  apiToken: "resource-token",
  stream: { protocolVersion: "1", subscriptions: ["ticks"], currentTick: 0, tickIntervalMs: 1000, ticksPerPulse: 1, status: "running" },
  contracts: { alerts: { schemaVersion: "1", schema: {} } },
  habitat: { id: "habitat-resource-test", habitatSlug: "resource-test", displayName: "Resource Test Habitat", catalogVersion: "test", status: "registered", lastSeenAt: null },
  modules: [{ id: "suitport-1", selector: "basic_suitport_1", blueprintId: "basic-suitport", displayName: "Basic Suitport", connectedTo: [], runtimeAttributes: { status: "active" }, capabilities: ["limited-eva", "suitport-access"] }],
  humans: [{ id: "human-1", displayName: "Ada", locationModuleId: "suitport-1", status: "present" }],
  alerts: [],
  blueprints: [],
};

afterEach(async () => {
  await clockManager.resetForTests();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  restoreEnvironment("HABITAT_DATA_DIRECTORY", previousDataDirectory);
  restoreEnvironment("KEPLER_BASE_URL", previousKeplerBaseUrl);
  restoreEnvironment("KEPLER_PLANET_TOKEN", previousKeplerToken);
  restoreEnvironment("HABITAT_REMOTE_MODE", previousRemoteMode);
  globalThis.fetch = originalFetch;
});

describe("EVA resource behavior", () => {
  test("deploys with 400 estimated ticks at quarter-unit consumption", () => {
    useTemporaryDatabase();
    saveState(registration);

    const eva = deployEva("human-1");

    expect(eva.batteryConsumptionPerTick).toBe(0.25);
    expect(eva.oxygenConsumptionPerTick).toBe(0.25);
    expect(eva.estimatedTicksRemaining).toBe(400);
  });

  test("a manual tick consumes 0.25 oxygen and power", async () => {
    useTemporaryDatabase();
    configureKeplerFetch();
    saveState(registration);
    deployEva("human-1");

    const response = await app.fetch(new Request("http://localhost/commands/tick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticks: 1 }),
    }));

    expect(response.status).toBe(200);
    expect(getEvaStatus()).toMatchObject({ suitBattery: 99.75, suitOxygen: 99.75 });
  });

  test("a successful scan deducts battery", async () => {
    useTemporaryDatabase();
    configureKeplerFetch("scan-success");
    saveState(registration);
    deployEva("human-1");

    const response = await app.fetch(new Request("http://localhost/world/scan?strength=100&radius=0"));

    expect(response.status).toBe(200);
    expect(getEvaStatus()).toMatchObject({ suitBattery: 99, suitOxygen: 100 });
  });

  test("a failed Kepler scan leaves battery unchanged", async () => {
    useTemporaryDatabase();
    configureKeplerFetch("scan-failure");
    saveState(registration);
    deployEva("human-1");

    const response = await app.fetch(new Request("http://localhost/world/scan?strength=100&radius=0"));

    expect(response.status).toBe(500);
    expect(getEvaStatus()).toMatchObject({ suitBattery: 100, suitOxygen: 100 });
  });

  test("concurrent successful scans serialize battery deductions", async () => {
    useTemporaryDatabase();
    configureKeplerFetch("scan-success", true);
    saveState(registration);
    deployEva("human-1");

    const [first, second] = await Promise.all([
      app.fetch(new Request("http://localhost/world/scan?strength=100&radius=0")),
      app.fetch(new Request("http://localhost/world/scan?strength=100&radius=0")),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(getEvaStatus().suitBattery).toBe(98);
  });
});

function useTemporaryDatabase(): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), "habitat-eva-resource-"));
  temporaryDirectories.push(directory);
  process.env.HABITAT_DATA_DIRECTORY = directory;
  process.env.HABITAT_REMOTE_MODE = "0";
  process.env.KEPLER_BASE_URL = "https://kepler.test";
  process.env.KEPLER_PLANET_TOKEN = "test-token";
}

function configureKeplerFetch(mode?: "scan-success" | "scan-failure", waitForBothScans = false): void {
  let scanRequests = 0;
  let releaseScans: (() => void) | undefined;
  const bothScansRequested = new Promise<void>((resolve) => {
    releaseScans = resolve;
  });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/world/solar-irradiance")) return new Response(JSON.stringify({ wPerM2: 0 }), { status: 200 });
    if (url.includes("/world/scan")) {
      scanRequests += 1;
      if (waitForBothScans) {
        if (scanRequests === 2) releaseScans?.();
        await bothScansRequested;
      }
      if (mode === "scan-failure") return new Response("unavailable", { status: 503, statusText: "Unavailable" });
      return new Response(JSON.stringify({ tiles: [] }), { status: 200 });
    }
    throw new Error(`Unexpected test fetch: ${url}`);
  }) as typeof fetch;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
