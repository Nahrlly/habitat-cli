import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createProgram } from "./commands.js";
import type { HabitatClockEvent, HabitatClockState } from "./types.js";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.HABITAT_API_BASE_URL;

const status: HabitatClockState = {
  mode: "kepler",
  listening: true,
  connectionStatus: "connected",
  latestAbsoluteTick: 900,
  latestAdvancedBy: 10,
  lastConnectionAt: "2026-07-16T12:00:00.000Z",
  lastMessageAt: "2026-07-16T12:01:00.000Z",
  latestError: null,
};

const event: HabitatClockEvent = {
  absoluteTick: 901,
  advancedBy: 1,
  issuedAt: "2026-07-16T12:01:01.000Z",
  receivedAt: "2026-07-16T12:01:01.100Z",
  applied: true,
  error: null,
};

beforeEach(() => {
  process.env.HABITAT_API_BASE_URL = "http://habitat.test:8787";
  process.exitCode = 0;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.exitCode = 0;
  if (originalBaseUrl === undefined) delete process.env.HABITAT_API_BASE_URL;
  else process.env.HABITAT_API_BASE_URL = originalBaseUrl;
});

describe("clock CLI", () => {
  test("clock status renders the local API status", async () => {
    const output = captureOutput();
    globalThis.fetch = mockJsonFetch(status);

    try {
      await createProgram().parseAsync(["clock", "status"], { from: "user" });
    } finally {
      output.restore();
    }

    expect(output.errors).toEqual([]);
    expect(output.lines.join("\n")).toContain("Clock mode: kepler");
    expect(output.lines.join("\n")).toContain("Latest tick: 900");
  });

  test("clock status supports stable JSON through the global flag", async () => {
    const output = captureOutput();
    globalThis.fetch = mockJsonFetch(status);

    try {
      await createProgram().parseAsync(["--json", "clock", "status"], { from: "user" });
    } finally {
      output.restore();
    }

    expect(output.errors).toEqual([]);
    expect(JSON.parse(output.lines.join("\n"))).toEqual({
      mode: "kepler",
      listening: true,
      manualTicksAllowed: false,
      connectionStatus: "connected",
      latestAbsoluteTick: 900,
      latestAdvancedBy: 10,
      lastConnectionAt: "2026-07-16T12:00:00.000Z",
      lastMessageAt: "2026-07-16T12:01:00.000Z",
      latestError: null,
    });
  });

  test("clock listen on and off use local API transitions", async () => {
    const output = captureOutput();
    const calls: Array<{ url: string; method: string }> = [];
    let nextStatus = { ...status, listening: false, mode: "manual" as const };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response(JSON.stringify(nextStatus), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    try {
      await createProgram().parseAsync(["clock", "listen", "on"], { from: "user" });
      nextStatus = status;
      await createProgram().parseAsync(["clock", "listen", "off", "--json"], { from: "user" });
    } finally {
      output.restore();
    }

    expect(calls).toEqual([
      { url: "http://habitat.test:8787/clock/listen/on", method: "POST" },
      { url: "http://habitat.test:8787/clock/listen/off", method: "POST" },
    ]);
    expect(output.errors).toEqual([]);
    expect(JSON.parse(output.lines.at(-1)!)).toMatchObject({ listening: true, mode: "kepler" });
  });

  test("clock watch consumes only future local SSE events and emits JSONL", async () => {
    const output = captureOutput();
    const calls: Array<{ url: string; method: string }> = [];
    const body = `event: planet_tick\ndata: ${JSON.stringify(event)}\n\n`;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;

    try {
      await createProgram().parseAsync(["clock", "watch", "--json"], { from: "user" });
    } finally {
      output.restore();
    }

    expect(calls).toEqual([{ url: "http://habitat.test:8787/clock/events", method: "GET" }]);
    expect(output.errors).toEqual([]);
    expect(output.lines).toEqual([JSON.stringify(event)]);
    expect(output.lines.join("\n")).not.toContain("apiToken");
  });

  test("manual tick preserves the local API rejection while Kepler listening is on", async () => {
    const output = captureOutput();
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "Manual ticks are disabled while Kepler clock listening is on. Run POST /clock/listen/off first." }), {
      status: 409,
      statusText: "Conflict",
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    try {
      await createProgram().parseAsync(["tick", "--ticks", "1"], { from: "user" });
    } finally {
      output.restore();
    }

    expect(output.lines).toEqual([]);
    expect(output.errors).toEqual(["Manual ticks are disabled while Kepler clock listening is on. Run POST /clock/listen/off first."]);
    expect(process.exitCode).toBe(1);
  });
});

function mockJsonFetch(body: Record<string, unknown>): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
}

function captureOutput(): { lines: string[]; errors: string[]; restore: () => void } {
  const lines: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...parts: unknown[]) => lines.push(parts.join(" "));
  console.error = (...parts: unknown[]) => errors.push(parts.join(" "));
  return { lines, errors, restore: () => { console.log = originalLog; console.error = originalError; } };
}
