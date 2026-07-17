import type { ClockStatus } from "./api";

export function formatClockConnection(clock: ClockStatus | null | undefined): string {
  if (!clock || clock.mode === "manual") return "Manual clock";
  if (clock.connectionStatus === "connected") return "Connected to Kepler";
  if (clock.connectionStatus === "connecting") return "Connecting to Kepler…";
  if (clock.connectionStatus === "error") return "Kepler connection error";
  return "Kepler listening is off";
}

export function formatLatestClockTick(clock: ClockStatus | null | undefined): string {
  if (clock?.latestAbsoluteTick === null || clock?.latestAbsoluteTick === undefined || clock.latestAdvancedBy === null) {
    return clock?.mode === "kepler" && clock.listening ? "Waiting for the first Kepler tick" : "No Kepler tick received";
  }
  return `Tick ${clock.latestAbsoluteTick.toLocaleString()} · advanced by ${clock.latestAdvancedBy}`;
}

export function clockStatusTone(clock: ClockStatus | null | undefined): "green" | "orange" | "red" {
  if (clock?.mode === "kepler" && clock.connectionStatus === "connected") return "green";
  if (clock?.mode === "kepler" && clock.listening && clock.connectionStatus === "connecting") return "orange";
  return "red";
}
