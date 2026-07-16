import { describe, expect, test } from "bun:test";
import {
  addRealtimeClient,
  broadcastRealtimeSnapshot,
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
  test("broadcastCurrentSnapshot sends the persisted current snapshot", () => {
    const messages: string[] = [];
    const connected = client((message) => messages.push(message));
    addRealtimeClient(connected);

    broadcastCurrentSnapshot();
    removeRealtimeClient(connected);

    const event = JSON.parse(messages[0]!);
    expect(event.type).toBe("snapshot");
    expect(event.snapshot).toEqual(buildRealtimeSnapshot());
  });

  test("rejects a non-upgrade request with an upgrade-required response", async () => {
    const response = await app.fetch(new Request("http://localhost/ws"));

    expect(response.status).toBe(426);
    expect(await response.text()).toBe("WebSocket upgrade required.");
  });

  test("builds an unregistered snapshot without requiring a habitat", () => {
    const snapshot = buildRealtimeSnapshot();
    expect(snapshot.registration === null || typeof snapshot.registration === "object").toBe(true);
    expect(Array.isArray(snapshot.modules)).toBe(true);
    expect(Array.isArray(snapshot.humans)).toBe(true);
    expect(Array.isArray(snapshot.alerts)).toBe(true);
  });
});
