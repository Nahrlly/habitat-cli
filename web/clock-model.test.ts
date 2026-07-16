import { describe, expect, test } from "bun:test";
import { formatClockConnection, formatLatestClockTick, clockStatusTone } from "./clock-model";
import type { ClockStatus } from "./api";

const connectedClock: ClockStatus = {
  mode: "kepler",
  listening: true,
  manualTicksAllowed: false,
  connectionStatus: "connected",
  latestAbsoluteTick: 1234,
  latestAdvancedBy: 10,
  lastConnectionAt: "2026-07-16T00:00:00.000Z",
  lastMessageAt: "2026-07-16T00:01:00.000Z",
  latestError: null,
};

describe("dashboard clock model", () => {
  test("describes a connected Kepler clock and its latest applied tick", () => {
    expect(formatClockConnection(connectedClock)).toBe("Connected to Kepler");
    expect(formatLatestClockTick(connectedClock)).toBe("Tick 1,234 · advanced by 10");
    expect(clockStatusTone(connectedClock)).toBe("green");
  });

  test("describes a clock that is listening but still connecting", () => {
    const clock = { ...connectedClock, connectionStatus: "connecting" as const, latestAbsoluteTick: null, latestAdvancedBy: null };
    expect(formatClockConnection(clock)).toBe("Connecting to Kepler…");
    expect(formatLatestClockTick(clock)).toBe("Waiting for the first Kepler tick");
    expect(clockStatusTone(clock)).toBe("orange");
  });

  test("describes manual mode without implying that Kepler is connected", () => {
    const clock = { ...connectedClock, mode: "manual" as const, listening: false, manualTicksAllowed: true, connectionStatus: "disconnected" as const, latestAbsoluteTick: null, latestAdvancedBy: null };
    expect(formatClockConnection(clock)).toBe("Manual clock");
    expect(formatLatestClockTick(clock)).toBe("No Kepler tick received");
    expect(clockStatusTone(clock)).toBe("red");
  });
});
