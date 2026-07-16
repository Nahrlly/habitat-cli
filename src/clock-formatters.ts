import type { HabitatClockState } from "./types.js";

export type HabitatClockEvent = {
  absoluteTick: number;
  advancedBy: number;
  issuedAt: string;
  receivedAt: string | null;
  applied: boolean;
  error: string | null;
};

export type HabitatClockStatusJson = {
  mode: HabitatClockState["mode"];
  listening: boolean;
  manualTicksAllowed: boolean;
  connectionStatus: HabitatClockState["connectionStatus"];
  latestAbsoluteTick: number | null;
  latestAdvancedBy: number | null;
  lastConnectionAt: string | null;
  lastMessageAt: string | null;
  latestError: string | null;
};

export function formatClockStatus(state: HabitatClockState): string {
  const status = toClockStatusJson(state);

  return [
    `Clock mode: ${status.mode}`,
    `Kepler listening: ${status.listening ? "on" : "off"}`,
    `Manual ticks: ${status.manualTicksAllowed ? "allowed" : "disabled"}`,
    `Connection: ${status.connectionStatus}`,
    `Latest tick: ${formatNullable(status.latestAbsoluteTick)}`,
    `Latest advancedBy: ${formatNullable(status.latestAdvancedBy)}`,
    `Last connection: ${formatNullable(status.lastConnectionAt)}`,
    `Last message: ${formatNullable(status.lastMessageAt)}`,
    `Latest error: ${formatNullable(status.latestError)}`,
  ].join("\n");
}

export function formatClockEvent(event: HabitatClockEvent): string {
  return [
    `Kepler tick: ${event.absoluteTick}`,
    `Advanced by: ${event.advancedBy}`,
    `Issued at: ${event.issuedAt}`,
    `Received at: ${formatNullable(event.receivedAt)}`,
    `Applied locally: ${event.applied ? "yes" : "no"}`,
    `Error: ${formatNullable(event.error)}`,
  ].join("\n");
}

export function toClockStatusJson(state: HabitatClockState): HabitatClockStatusJson {
  return {
    mode: state.mode,
    listening: state.listening,
    manualTicksAllowed: !state.listening,
    connectionStatus: state.connectionStatus,
    latestAbsoluteTick: state.latestAbsoluteTick,
    latestAdvancedBy: state.latestAdvancedBy,
    lastConnectionAt: state.lastConnectionAt,
    lastMessageAt: state.lastMessageAt,
    latestError: state.latestError,
  };
}

function formatNullable(value: number | string | null): string {
  return value === null ? "none" : String(value);
}
