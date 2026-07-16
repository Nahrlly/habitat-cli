import { describe, expect, test } from "bun:test";
import {
  HabitatRealtimeClient,
  buildRealtimeUrl,
  parseRealtimeEvent,
  type RealtimeConnectionState,
} from "./realtime";
import type { HabitatRealtimeSnapshot } from "./api";

function snapshot(): HabitatRealtimeSnapshot {
  return {
    registration: null,
    modules: [],
    humans: [],
    solar: null,
    power: null,
    powerHistory: [],
    alerts: [],
  };
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.();
  }

  sendSnapshot(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }

  closeUnexpectedly(): void {
    this.onclose?.();
  }
}

describe("dashboard realtime client", () => {
  test("builds same-origin ws and wss URLs", () => {
    expect(buildRealtimeUrl({ protocol: "http:", host: "localhost:8787" })).toBe("ws://localhost:8787/ws");
    expect(buildRealtimeUrl({ protocol: "https:", host: "habitat.example" })).toBe("wss://habitat.example/ws");
  });

  test("accepts snapshots and rejects malformed realtime frames", () => {
    const event = parseRealtimeEvent(JSON.stringify({ type: "snapshot", snapshot: snapshot(), emittedAt: "2026-07-16T00:00:00.000Z" }));
    expect(event?.type).toBe("snapshot");
    expect(parseRealtimeEvent("not json")).toBeNull();
    expect(parseRealtimeEvent(JSON.stringify({ type: "snapshot", snapshot: { modules: [] } }))).toBeNull();
    expect(parseRealtimeEvent(JSON.stringify({ type: "error", message: "nope" }))).toBeNull();
  });

  test("delivers valid snapshots and reports connection states", () => {
    FakeSocket.instances = [];
    const states: RealtimeConnectionState[] = [];
    const snapshots: HabitatRealtimeSnapshot[] = [];
    const client = new HabitatRealtimeClient("ws://localhost:8787/ws", {
      createSocket: (url) => new FakeSocket(url),
      onStateChange: (state) => states.push(state),
      onSnapshot: (value) => snapshots.push(value),
    });

    client.start();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].sendSnapshot({ type: "snapshot", snapshot: snapshot(), emittedAt: "2026-07-16T00:00:00.000Z" });

    expect(states).toEqual(["connecting", "connected"]);
    expect(snapshots).toHaveLength(1);
  });

  test("uses bounded exponential reconnect delays", () => {
    FakeSocket.instances = [];
    const scheduled: Array<{ delay: number; callback: () => void }> = [];
    const states: RealtimeConnectionState[] = [];
    const client = new HabitatRealtimeClient("ws://localhost:8787/ws", {
      createSocket: (url) => new FakeSocket(url),
      onStateChange: (state) => states.push(state),
      onSnapshot: () => undefined,
      initialReconnectMs: 25,
      maxReconnectMs: 100,
      setTimeout: (callback, delay) => {
        scheduled.push({ callback, delay: Number(delay) });
        return scheduled.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: () => undefined,
    });

    client.start();
    FakeSocket.instances[0].closeUnexpectedly();
    expect(scheduled.at(-1)?.delay).toBe(25);
    scheduled[0].callback();
    FakeSocket.instances[1].closeUnexpectedly();
    expect(scheduled.at(-1)?.delay).toBe(50);
    scheduled[1].callback();
    FakeSocket.instances[2].closeUnexpectedly();
    expect(scheduled.at(-1)?.delay).toBe(100);
    scheduled[2].callback();
    FakeSocket.instances[3].closeUnexpectedly();
    expect(scheduled.at(-1)?.delay).toBe(100);
    expect(states).toContain("reconnecting");
  });

  test("stops reconnecting and closes the active socket", () => {
    FakeSocket.instances = [];
    let pending: (() => void) | undefined;
    const client = new HabitatRealtimeClient("ws://localhost:8787/ws", {
      createSocket: (url) => new FakeSocket(url),
      onStateChange: () => undefined,
      onSnapshot: () => undefined,
      setTimeout: (callback) => {
        pending = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: () => undefined,
    });

    client.start();
    const socket = FakeSocket.instances[0];
    client.stop();
    expect(socket.closed).toBe(true);

    client.start();
    FakeSocket.instances[1].closeUnexpectedly();
    client.stop();
    pending?.();
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
