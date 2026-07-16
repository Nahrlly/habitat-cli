import { describe, expect, test } from "bun:test";
import {
  addRealtimeClient,
  broadcastRealtimeSnapshot,
  enqueueRealtimeSnapshot,
  removeRealtimeClient,
  type HabitatRealtimeSnapshot,
} from "./realtime.js";
import { app, broadcastCurrentSnapshot, buildRealtimeSnapshot } from "./server.js";

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
