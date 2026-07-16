import { describe, expect, test } from "bun:test";
import {
  formatClockEvent,
  formatClockStatus,
  toClockStatusJson,
  type HabitatClockEvent,
} from "./clock-formatters.js";

describe("clock formatters", () => {
  test("formats clock status with mode, permissions, connection, tick, timestamps, and error", () => {
    expect(formatClockStatus({
      mode: "kepler",
      listening: true,
      connectionStatus: "error",
      latestAbsoluteTick: 900,
      latestAdvancedBy: 100,
      lastConnectionAt: "2026-07-16T10:00:00.000Z",
      lastMessageAt: "2026-07-16T10:01:00.000Z",
      latestError: "stream disconnected",
    })).toBe([
      "Clock mode: kepler",
      "Kepler listening: on",
      "Manual ticks: disabled",
      "Connection: error",
      "Latest tick: 900",
      "Latest advancedBy: 100",
      "Last connection: 2026-07-16T10:00:00.000Z",
      "Last message: 2026-07-16T10:01:00.000Z",
      "Latest error: stream disconnected",
    ].join("\n"));
  });

  test("converts manual clock status to a stable JSON object", () => {
    expect(toClockStatusJson({
      mode: "manual",
      listening: false,
      connectionStatus: "disconnected",
      latestAbsoluteTick: null,
      latestAdvancedBy: null,
      lastConnectionAt: null,
      lastMessageAt: null,
      latestError: null,
    })).toEqual({
      mode: "manual",
      listening: false,
      manualTicksAllowed: true,
      connectionStatus: "disconnected",
      latestAbsoluteTick: null,
      latestAdvancedBy: null,
      lastConnectionAt: null,
      lastMessageAt: null,
      latestError: null,
    });
  });

  test("formats a received clock event with application details", () => {
    const event: HabitatClockEvent = {
      absoluteTick: 900,
      advancedBy: 100,
      issuedAt: "2026-07-16T10:01:00.000Z",
      receivedAt: "2026-07-16T10:01:00.250Z",
      applied: false,
      error: "duplicate tick ignored",
    };

    expect(formatClockEvent(event)).toBe([
      "Kepler tick: 900",
      "Advanced by: 100",
      "Issued at: 2026-07-16T10:01:00.000Z",
      "Received at: 2026-07-16T10:01:00.250Z",
      "Applied locally: no",
      "Error: duplicate tick ignored",
    ].join("\n"));
  });
});
