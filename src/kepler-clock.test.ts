import { afterEach, describe, expect, test } from "bun:test";
import {
  KeplerClockClient,
  type KeplerClockSocket,
  type KeplerClockTick,
} from "./kepler-clock.js";

class FakeSocket implements KeplerClockSocket {
  static instances: FakeSocket[] = [];

  readonly url: string;
  readonly sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }

  open(): void {
    this.onopen?.();
  }

  message(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === "string" ? payload : JSON.stringify(payload) });
  }

  error(error: unknown): void {
    this.onerror?.(error);
  }

  closeFromServer(): void {
    this.onclose?.();
  }
}

const registration = {
  habitatId: "habitat-1",
  streamUrl: "wss://planet.example/stream",
  apiToken: "secret-token",
};

afterEach(() => {
  FakeSocket.instances = [];
});

describe("KeplerClockClient", () => {
  test("connects to the saved stream URL and sends the authenticated hello without URL credentials", () => {
    const statuses: string[] = [];
    const client = createClient({ onStatusChange: (status) => statuses.push(status) });
    client.start();

    const socket = onlySocket();
    expect(socket.url).toBe(registration.streamUrl);
    expect(socket.url).not.toContain(registration.apiToken);

    socket.open();

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      { type: "hello", apiToken: registration.apiToken, subscribe: ["ticks"] },
    ]);
    expect(statuses).toEqual(["connecting"]);
  });

  test("requires a matching hello acknowledgement and ticks subscription before accepting ticks", () => {
    const ticks: KeplerClockTick[] = [];
    const errors: Error[] = [];
    const client = createClient({ onTick: (tick) => ticks.push(tick), onError: (error) => errors.push(error) });
    client.start();
    const socket = onlySocket();
    socket.open();

    socket.message({ type: "hello_ack", habitatId: "other-habitat", subscriptions: ["ticks"] });
    socket.message({ type: "planet_tick", habitatId: registration.habitatId, absoluteTick: 1, advancedBy: 1 });

    expect(ticks).toEqual([]);
    expect(errors.map((error) => error.message)).toContain("Invalid hello_ack habitat identity.");
    expect(socket.closeCalls).toHaveLength(1);
  });

  test("accepts positive whole-number ticks and ignores malformed, duplicate, and older notices", () => {
    const ticks: KeplerClockTick[] = [];
    const errors: Error[] = [];
    const client = createClient({ onTick: (tick) => ticks.push(tick), onError: (error) => errors.push(error) });
    client.start();
    const socket = onlySocket();
    socket.open();
    socket.message({ type: "hello_ack", habitatId: registration.habitatId, subscriptions: ["ticks"] });

    for (const advancedBy of [1, 10, 100]) {
      socket.message({
        type: "planet_tick",
        habitatId: registration.habitatId,
        absoluteTick: (ticks.at(-1)?.absoluteTick ?? 0) + advancedBy,
        advancedBy,
        issuedAt: "2026-07-16T12:00:00.000Z",
      });
    }
    socket.message({ type: "planet_tick", habitatId: registration.habitatId, absoluteTick: 111, advancedBy: 1 });
    socket.message({ type: "planet_tick", habitatId: registration.habitatId, absoluteTick: 110, advancedBy: 1 });
    socket.message({ type: "planet_tick", habitatId: registration.habitatId, absoluteTick: 211, advancedBy: 0 });
    socket.message("not json");

    expect(ticks.map(({ absoluteTick, advancedBy }) => ({ absoluteTick, advancedBy }))).toEqual([
      { absoluteTick: 1, advancedBy: 1 },
      { absoluteTick: 11, advancedBy: 10 },
      { absoluteTick: 111, advancedBy: 100 },
    ]);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  test("accepts the live planet_tick contract using tick and previousTick fields", () => {
    const ticks: KeplerClockTick[] = [];
    const client = createClient({ onTick: (tick) => ticks.push(tick) });
    client.start();
    const socket = onlySocket();
    socket.open();
    socket.message({ type: "hello_ack", habitatId: registration.habitatId, subscriptions: ["ticks"] });
    socket.message({ type: "planet_tick", previousTick: 800, tick: 900, advancedBy: 100, issuedAt: "2026-07-15T14:30:00.000Z" });

    expect(ticks).toEqual([{
      type: "planet_tick",
      previousTick: 800,
      absoluteTick: 900,
      advancedBy: 100,
      issuedAt: "2026-07-15T14:30:00.000Z",
    }]);
  });

  test("seeds duplicate rejection from the persisted latest absolute tick", () => {
    const ticks: KeplerClockTick[] = [];
    const client = createClient({
      clockState: { latestAbsoluteTick: 100 },
      onTick: (tick) => ticks.push(tick),
    });
    client.start();
    const socket = onlySocket();
    socket.open();
    socket.message({ type: "hello_ack", habitatId: registration.habitatId, subscriptions: ["ticks"] });
    socket.message({ type: "planet_tick", habitatId: registration.habitatId, absoluteTick: 100, advancedBy: 1 });
    socket.message({ type: "planet_tick", habitatId: registration.habitatId, absoluteTick: 101, advancedBy: 1 });

    expect(ticks.map((tick) => tick.absoluteTick)).toEqual([101]);
  });

  test("reconnects with backoff without requesting or replaying missed ticks", async () => {
    const ticks: KeplerClockTick[] = [];
    const client = createClient({ reconnectDelaysMs: [0], onTick: (tick) => ticks.push(tick) });
    client.start();
    const first = onlySocket();
    first.open();
    first.message({ type: "hello_ack", habitatId: registration.habitatId, subscriptions: ["ticks"] });
    first.message({ type: "planet_tick", habitatId: registration.habitatId, absoluteTick: 10, advancedBy: 10 });
    first.closeFromServer();

    await waitFor(() => FakeSocket.instances.length === 2);
    const second = FakeSocket.instances[1]!;
    second.open();
    expect(second.sent).toHaveLength(1);
    expect(JSON.parse(second.sent[0]!)).toEqual({ type: "hello", apiToken: registration.apiToken, subscribe: ["ticks"] });

    second.message({ type: "hello_ack", habitatId: registration.habitatId, subscriptions: ["ticks"] });
    second.message({ type: "planet_tick", habitatId: registration.habitatId, absoluteTick: 10, advancedBy: 10 });
    second.message({ type: "planet_tick", habitatId: registration.habitatId, absoluteTick: 11, advancedBy: 1 });

    expect(ticks.map((tick) => tick.absoluteTick)).toEqual([10, 11]);
    client.stop();
  });

  test("stops cleanly and does not reconnect after shutdown", async () => {
    const statuses: string[] = [];
    const client = createClient({ reconnectDelaysMs: [0], onStatusChange: (status) => statuses.push(status) });
    client.start();
    const socket = onlySocket();
    client.stop();
    socket.closeFromServer();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(socket.closeCalls).toEqual([{ code: 1000, reason: "client stopped" }]);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(statuses.at(-1)).toBe("disconnected");
  });

  test("reports socket errors through the error and status callbacks", () => {
    const statuses: string[] = [];
    const errors: Error[] = [];
    const client = createClient({ onStatusChange: (status) => statuses.push(status), onError: (error) => errors.push(error) });
    client.start();
    const socket = onlySocket();
    socket.error(new Error("network unavailable"));

    expect(errors.map((error) => error.message)).toEqual(["network unavailable"]);
    expect(statuses).toEqual(["connecting", "error"]);
  });
});

function createClient(overrides: Partial<ConstructorParameters<typeof KeplerClockClient>[0]> = {}): KeplerClockClient {
  return new KeplerClockClient({
    registration,
    webSocketFactory: (url) => new FakeSocket(url),
    ...overrides,
  });
}

function onlySocket(): FakeSocket {
  expect(FakeSocket.instances).toHaveLength(1);
  return FakeSocket.instances[0]!;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for predicate.");
}
