import { describe, expect, test } from "bun:test";
import {
  addRealtimeClient,
  broadcastRealtimeSnapshot,
  removeRealtimeClient,
  type HabitatRealtimeSnapshot,
} from "./realtime.js";

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
