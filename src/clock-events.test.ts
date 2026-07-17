import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, clockManager } from "./server.js";
import { loadClockState, saveClockState } from "./clock-state.js";
import { saveState } from "./state.js";
import type { KeplerClockClientOptions, KeplerClockTick } from "./kepler-clock.js";
import type { KeplerRegistration } from "./types.js";

const originalDataDirectory = process.env.HABITAT_DATA_DIRECTORY;
const tempDirectories: string[] = [];

class FakeClockClient {
  readonly options: KeplerClockClientOptions;
  startCalls = 0;
  stopCalls = 0;

  constructor(options: KeplerClockClientOptions) {
    this.options = options;
  }

  start(): void {
    this.startCalls += 1;
  }

  stop(): void {
    this.stopCalls += 1;
  }

  status(status: "connected" | "disconnected" | "connecting" | "error"): void {
    this.options.onStatusChange?.(status);
  }

  error(error: Error): void {
    this.options.onError?.(error);
  }

  tick(tick: KeplerClockTick): void {
    this.options.onTick?.(tick);
  }
}

const registration: KeplerRegistration = {
  habitatId: "habitat-clock-test",
  habitatUuid: "uuid-clock-test",
  displayName: "Clock Test Habitat",
  streamUrl: "wss://planet.example/stream",
  apiToken: "clock-token",
  stream: { protocolVersion: "1", subscriptions: ["ticks"], currentTick: 0, tickIntervalMs: 1000, ticksPerPulse: 1, status: "running" },
  contracts: { alerts: { schemaVersion: "1", schema: {} } },
  habitat: { id: "habitat-clock-test", habitatSlug: "clock-test", displayName: "Clock Test Habitat", catalogVersion: "test", status: "registered", lastSeenAt: null },
  modules: [],
  humans: [],
  alerts: [],
  blueprints: [],
};

afterEach(async () => {
  await clockManager.resetForTests();
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  if (originalDataDirectory === undefined) delete process.env.HABITAT_DATA_DIRECTORY;
  else process.env.HABITAT_DATA_DIRECTORY = originalDataDirectory;
});

describe("Kepler clock backend lifecycle", () => {
  test("persists Kepler mode before connecting when listening is enabled", async () => {
    useTemporaryDatabase();
    saveState(registration);
    const clients: FakeClockClient[] = [];
    clockManager.configureForTests({
      createClient: (options) => {
        expect(loadClockState()).toMatchObject({ mode: "kepler", listening: true, connectionStatus: "connecting" });
        const client = new FakeClockClient(options);
        clients.push(client);
        return client;
      },
      applyTick: async () => {},
    });

    const state = await clockManager.listenOn();

    expect(state).toMatchObject({ mode: "kepler", listening: true, connectionStatus: "connecting" });
    expect(clients).toHaveLength(1);
    expect(clients[0]!.startCalls).toBe(1);
  });

  test("reconnects on startup only when persisted listening is enabled", () => {
    useTemporaryDatabase();
    saveState(registration);
    saveClockState({ ...loadClockState(), mode: "kepler", listening: true });
    const clients: FakeClockClient[] = [];
    clockManager.configureForTests({
      createClient: (options) => {
        const client = new FakeClockClient(options);
        clients.push(client);
        return client;
      },
      applyTick: async () => {},
    });

    clockManager.start();

    expect(clients).toHaveLength(1);
    expect(clients[0]!.startCalls).toBe(1);
  });

  test("applies each accepted Kepler tick once, persists it, broadcasts, and emits an SSE event", async () => {
    useTemporaryDatabase();
    saveState(registration);
    const clients: FakeClockClient[] = [];
    const applied: number[] = [];
    let broadcasts = 0;
    const events: Array<Record<string, unknown>> = [];
    clockManager.configureForTests({
      createClient: (options) => {
        const client = new FakeClockClient(options);
        clients.push(client);
        return client;
      },
      applyTick: async (advancedBy) => { applied.push(advancedBy); },
      broadcast: async () => { broadcasts += 1; },
      now: () => "2026-07-16T12:00:00.000Z",
    });
    const unsubscribe = clockManager.subscribe((event) => events.push(event as unknown as Record<string, unknown>));
    await clockManager.listenOn();

    clients[0]!.tick({ type: "planet_tick", habitatId: registration.habitatId, absoluteTick: 42, advancedBy: 7, issuedAt: "2026-07-16T11:59:59.000Z" });
    await clockManager.waitForIdleForTests();
    unsubscribe();

    expect(applied).toEqual([7]);
    expect(broadcasts).toBe(1);
    expect(loadClockState()).toMatchObject({ latestAbsoluteTick: 42, latestAdvancedBy: 7, lastMessageAt: "2026-07-16T12:00:00.000Z" });
    expect(events).toEqual([{
      absoluteTick: 42,
      advancedBy: 7,
      issuedAt: "2026-07-16T11:59:59.000Z",
      receivedAt: "2026-07-16T12:00:00.000Z",
      applied: true,
      error: null,
    }]);
  });

  test("waits for an active tick before restoring manual mode", async () => {
    useTemporaryDatabase();
    saveState(registration);
    const clients: FakeClockClient[] = [];
    let releaseTick!: () => void;
    const tickStarted = new Promise<void>((resolve) => { releaseTick = resolve; });
    clockManager.configureForTests({
      createClient: (options) => {
        const client = new FakeClockClient(options);
        clients.push(client);
        return client;
      },
      applyTick: async () => tickStarted,
    });
    await clockManager.listenOn();
    clients[0]!.tick({ type: "planet_tick", habitatId: registration.habitatId, absoluteTick: 1, advancedBy: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const turningOff = clockManager.listenOff();
    expect(loadClockState().listening).toBe(true);
    releaseTick();
    await turningOff;

    expect(loadClockState()).toMatchObject({ mode: "manual", listening: false, connectionStatus: "disconnected" });
    expect(clients[0]!.stopCalls).toBe(1);
  });

  test("persists connection status and the latest connection error", async () => {
    useTemporaryDatabase();
    saveState(registration);
    const clients: FakeClockClient[] = [];
    clockManager.configureForTests({
      createClient: (options) => {
        const client = new FakeClockClient(options);
        clients.push(client);
        return client;
      },
      applyTick: async () => {},
      now: () => "2026-07-16T12:01:00.000Z",
    });
    await clockManager.listenOn();
    clients[0]!.status("connected");
    clients[0]!.error(new Error("stream unavailable"));

    expect(loadClockState()).toMatchObject({ connectionStatus: "error", lastConnectionAt: "2026-07-16T12:01:00.000Z", latestError: "stream unavailable" });
  });
});

describe("clock HTTP routes", () => {
  test("exposes status, rejects manual ticks while listening, and leaves SSE future-only", async () => {
    useTemporaryDatabase();
    saveState(registration);
    saveClockState({ ...loadClockState(), mode: "kepler", listening: true, connectionStatus: "connected" });
    const clients: FakeClockClient[] = [];
    clockManager.configureForTests({
      createClient: (options) => {
        const client = new FakeClockClient(options);
        clients.push(client);
        return client;
      },
      applyTick: async () => {},
      broadcast: async () => {},
      now: () => "2026-07-16T12:02:00.000Z",
    });

    const statusResponse = await app.fetch(new Request("http://localhost/clock/status"));
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({ mode: "kepler", listening: true, manualTicksAllowed: false });

    const tickResponse = await app.fetch(new Request("http://localhost/commands/tick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticks: 1 }),
    }));
    expect(tickResponse.status).toBe(409);
    expect((await tickResponse.json()).error).toContain("Manual ticks are disabled while Kepler clock listening is on");

    const eventsResponse = await app.fetch(new Request("http://localhost/clock/events"));
    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.headers.get("content-type")).toContain("text/event-stream");
    const reader = eventsResponse.body!.getReader();
    const pendingRead = reader.read();
    const result = await Promise.race([pendingRead, new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 10))]);
    expect(result).toBe("pending");

    await clockManager.listenOn();
    clients[0]!.tick({ type: "planet_tick", habitatId: registration.habitatId, absoluteTick: 2, advancedBy: 2, issuedAt: "2026-07-16T12:01:59.000Z" });
    await clockManager.waitForIdleForTests();
    const eventResult = await pendingRead;
    const eventText = new TextDecoder().decode(eventResult.value);
    expect(eventText).toContain("event: planet_tick\n");
    expect(JSON.parse(eventText.split("data: ")[1]!.trim())).toMatchObject({ absoluteTick: 2, advancedBy: 2, applied: true });
    await reader.cancel();
  });
});

function useTemporaryDatabase(): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), "habitat-clock-events-"));
  tempDirectories.push(directory);
  process.env.HABITAT_DATA_DIRECTORY = directory;
}
