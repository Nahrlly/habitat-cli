import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HabitatRealtimeSnapshot, PowerOverviewResponse, PowerHistoryResponse, SolarStatusResponse } from "./realtime.js";
import {
  addRealtimeClient,
  broadcastRealtimeSnapshot,
  enqueueRealtimeSnapshot,
  removeRealtimeClient,
  type HabitatRealtimeSnapshot,
} from "./realtime.js";
import { app, broadcastCurrentSnapshot, buildRealtimeSnapshot } from "./server.js";
import { saveState } from "./state.js";
import type { KeplerRegistration } from "./types.js";

const snapshot: HabitatRealtimeSnapshot = {
  registration: null,
  modules: [],
  humans: [],
  solar: null,
  power: null,
  powerHistory: [],
  alerts: [],
};

function client(send: (message: string) => void) {
  return { send } as never;
}

describe("realtime client registry", () => {
  test("serializes asynchronous snapshots in enqueue order", async () => {
    const messages: string[] = [];
    const connected = client((message) => messages.push(message));
    addRealtimeClient(connected);
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const firstQueued = enqueueRealtimeSnapshot(async () => {
      await first;
      return { ...snapshot, powerHistory: ["first"] };
    });
    const secondQueued = enqueueRealtimeSnapshot(async () => ({ ...snapshot, powerHistory: ["second"] }));
    releaseFirst();
    await Promise.all([firstQueued, secondQueued]);
    removeRealtimeClient(connected);

    expect(messages.map((message) => JSON.parse(message).snapshot.powerHistory)).toEqual([["first"], ["second"]]);
  });

  test("keeps an initial client snapshot ahead of later broadcasts", async () => {
    const messages: string[] = [];
    const connected = client((message) => messages.push(message));
    addRealtimeClient(connected);
    let releaseInitial!: () => void;
    const initialReady = new Promise<void>((resolve) => { releaseInitial = resolve; });

    const initial = enqueueRealtimeSnapshot(async () => {
      await initialReady;
      return { ...snapshot, powerHistory: ["initial"] };
    }, connected);
    const mutation = enqueueRealtimeSnapshot(async () => ({ ...snapshot, powerHistory: ["mutation"] }));
    releaseInitial();
    await Promise.all([initial, mutation]);
    removeRealtimeClient(connected);

    expect(messages.map((message) => JSON.parse(message).snapshot.powerHistory)).toEqual([["initial"], ["mutation"]]);
  });

  test("broadcasts a normalized snapshot envelope to connected clients", () => {
    const messages: string[] = [];
    const connected = client((message) => messages.push(message));

    addRealtimeClient(connected);
    broadcastRealtimeSnapshot(snapshot, "2026-07-16T00:00:00.000Z");
    removeRealtimeClient(connected);

    expect(JSON.parse(messages[0]!)).toEqual({
      type: "snapshot",
      snapshot,
      emittedAt: "2026-07-16T00:00:00.000Z",
    });
  });

  test("removes a client whose send operation fails", () => {
    let sends = 0;
    const disconnected = client(() => {
      sends += 1;
      throw new Error("closed");
    });

    addRealtimeClient(disconnected);
    broadcastRealtimeSnapshot(snapshot);
    broadcastRealtimeSnapshot(snapshot);

    expect(sends).toBe(1);
  });
});

describe("dashboard WebSocket endpoint", () => {
  test("delivers a subsequent snapshot after a persisted module mutation", async () => {
    const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "habitat-realtime-"));
    const originalDataDirectory = process.env.HABITAT_DATA_DIRECTORY;
    const originalFetch = globalThis.fetch;
    const messages: string[] = [];
    const connected = client((message) => messages.push(message));
    const registration: KeplerRegistration = {
      habitatId: "habitat-test",
      habitatUuid: "uuid-test",
      displayName: "Realtime Test Habitat",
      streamUrl: "wss://example.test/stream",
      apiToken: "token-test",
      stream: { protocolVersion: "1", subscriptions: [], currentTick: 0, tickIntervalMs: 1000, ticksPerPulse: 1, status: "running" },
      contracts: { alerts: { schemaVersion: "1", schema: {} } },
      habitat: { id: "habitat-test", habitatSlug: "realtime-test", displayName: "Realtime Test Habitat", catalogVersion: "test", status: "registered", lastSeenAt: null },
      modules: [{ id: "module-suitport", selector: "suitport", blueprintId: "basic-suitport", displayName: "Suitport", connectedTo: [], runtimeAttributes: { status: "offline" }, capabilities: [] }],
      humans: [],
      alerts: [],
      blueprints: [],
    };

    process.env.HABITAT_DATA_DIRECTORY = dataDirectory;
    globalThis.fetch = (async () => new Response(JSON.stringify({ wPerM2: 0 }), { status: 200 })) as typeof fetch;

    try {
      saveState(registration);
      addRealtimeClient(connected);

      const response = await app.fetch(new Request("http://localhost/modules/suitport/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      }));

      expect(response.status).toBe(200);
      expect(messages).toHaveLength(1);
      const event = JSON.parse(messages[0]!);
      expect(event.type).toBe("snapshot");
      expect(event.snapshot.modules.find((module: { selector: string }) => module.selector === "suitport").runtimeAttributes.status).toBe("active");
    } finally {
      removeRealtimeClient(connected);
      globalThis.fetch = originalFetch;
      if (originalDataDirectory === undefined) delete process.env.HABITAT_DATA_DIRECTORY;
      else process.env.HABITAT_DATA_DIRECTORY = originalDataDirectory;
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });

  test("uses explicit REST response shapes for realtime payloads", () => {
    const solar: SolarStatusResponse = { solarIrradiance: { wPerM2: 321 } };
    const power: PowerOverviewResponse = { generationKw: 4, consumptionKw: 2, netKw: 2, solarIrradiance: { wPerM2: 321 } };
    const history: PowerHistoryResponse = { history: [] };
    const snapshot = { solar, power, powerHistory: history.history } as Pick<HabitatRealtimeSnapshot, "solar" | "power" | "powerHistory">;

    expect(JSON.parse(JSON.stringify(snapshot))).toEqual({ solar, power, powerHistory: [] });
  });

  test("broadcastCurrentSnapshot sends the persisted current snapshot", async () => {
    const messages: string[] = [];
    const connected = client((message) => messages.push(message));
    addRealtimeClient(connected);

    await broadcastCurrentSnapshot();
    removeRealtimeClient(connected);

    const event = JSON.parse(messages[0]!);
    expect(event.type).toBe("snapshot");
    expect(event.snapshot).toEqual(await buildRealtimeSnapshot());
  });

  test("rejects a non-upgrade request with an upgrade-required response", async () => {
    const response = await app.fetch(new Request("http://localhost/ws"));

    expect(response.status).toBe(426);
    expect(await response.text()).toBe("WebSocket upgrade required.");
  });

  test("includes current solar status in the realtime snapshot", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ wPerM2: 321 }), { status: 200 })) as typeof fetch;

    try {
      const snapshot = await buildRealtimeSnapshot();
      expect(snapshot.solar).toEqual({ solarIrradiance: { wPerM2: 321 } });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("builds an unregistered snapshot without requiring a habitat", async () => {
    const snapshot = await buildRealtimeSnapshot();
    expect(snapshot.registration === null || typeof snapshot.registration === "object").toBe(true);
    expect(Array.isArray(snapshot.modules)).toBe(true);
    expect(Array.isArray(snapshot.humans)).toBe(true);
    expect(Array.isArray(snapshot.alerts)).toBe(true);
  });
});
