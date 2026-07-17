import {
  type HabitatClockConnectionStatus,
  type HabitatClockMode,
  type HabitatClockState,
} from "./types.js";
import { withDatabase } from "./sqlite-state.js";

const defaultClockState: HabitatClockState = {
  mode: "manual",
  listening: false,
  connectionStatus: "disconnected",
  latestAbsoluteTick: null,
  latestAdvancedBy: null,
  lastConnectionAt: null,
  lastMessageAt: null,
  latestError: null,
};

export function createDefaultClockState(): HabitatClockState {
  return { ...defaultClockState };
}

export function loadClockState(): HabitatClockState {
  return withDatabase((db) => {
    const row = db.query(
      `SELECT mode, listening, connection_status AS connectionStatus,
              latest_absolute_tick AS latestAbsoluteTick,
              latest_advanced_by AS latestAdvancedBy,
              last_connection_at AS lastConnectionAt,
              last_message_at AS lastMessageAt,
              latest_error AS latestError
       FROM clock_state
       WHERE id = 1
       LIMIT 1`,
    ).get() as ClockStateRow | undefined;

    if (!row) {
      const state = createDefaultClockState();
      writeClockState(db, state);
      return state;
    }

    return normalizeClockState({
      mode: parseClockMode(row.mode),
      listening: Number(row.listening) === 1,
      connectionStatus: parseConnectionStatus(row.connectionStatus),
      latestAbsoluteTick: toNullableNumber(row.latestAbsoluteTick),
      latestAdvancedBy: toNullableNumber(row.latestAdvancedBy),
      lastConnectionAt: row.lastConnectionAt ?? null,
      lastMessageAt: row.lastMessageAt ?? null,
      latestError: row.latestError ?? null,
    });
  });
}

export function saveClockState(state: HabitatClockState): void {
  const normalized = normalizeClockState(state);
  withDatabase((db) => {
    writeClockState(db, normalized);
  });
}

export function updateClockState(update: Partial<HabitatClockState>): HabitatClockState {
  const next = {
    ...loadClockState(),
    ...update,
  };
  saveClockState(next);
  return normalizeClockState(next);
}

type ClockStateRow = {
  mode: string;
  listening: number;
  connectionStatus: string;
  latestAbsoluteTick: number | null;
  latestAdvancedBy: number | null;
  lastConnectionAt: string | null;
  lastMessageAt: string | null;
  latestError: string | null;
};

function writeClockState(db: { query: (sql: string) => { run: (...parameters: unknown[]) => unknown } }, state: HabitatClockState): void {
  db.query(
    `INSERT INTO clock_state
      (id, mode, listening, connection_status, latest_absolute_tick, latest_advanced_by, last_connection_at, last_message_at, latest_error)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       mode = excluded.mode,
       listening = excluded.listening,
       connection_status = excluded.connection_status,
       latest_absolute_tick = excluded.latest_absolute_tick,
       latest_advanced_by = excluded.latest_advanced_by,
       last_connection_at = excluded.last_connection_at,
       last_message_at = excluded.last_message_at,
       latest_error = excluded.latest_error`,
  ).run(
    state.mode,
    state.listening ? 1 : 0,
    state.connectionStatus,
    state.latestAbsoluteTick,
    state.latestAdvancedBy,
    state.lastConnectionAt,
    state.lastMessageAt,
    state.latestError,
  );
}

function normalizeClockState(state: HabitatClockState): HabitatClockState {
  if (!isClockMode(state.mode)) {
    throw new Error(`Invalid clock mode: ${state.mode}.`);
  }
  if (!isConnectionStatus(state.connectionStatus)) {
    throw new Error(`Invalid clock connection status: ${state.connectionStatus}.`);
  }
  if (state.latestAbsoluteTick !== null && (!Number.isInteger(state.latestAbsoluteTick) || state.latestAbsoluteTick < 0)) {
    throw new Error("Latest absolute tick must be a non-negative whole number or null.");
  }
  if (state.latestAdvancedBy !== null && (!Number.isInteger(state.latestAdvancedBy) || state.latestAdvancedBy <= 0)) {
    throw new Error("Latest advancedBy must be a positive whole number or null.");
  }

  return {
    mode: state.mode,
    listening: Boolean(state.listening),
    connectionStatus: state.connectionStatus,
    latestAbsoluteTick: state.latestAbsoluteTick,
    latestAdvancedBy: state.latestAdvancedBy,
    lastConnectionAt: state.lastConnectionAt,
    lastMessageAt: state.lastMessageAt,
    latestError: state.latestError,
  };
}

function isClockMode(value: string): value is HabitatClockMode {
  return value === "manual" || value === "kepler";
}

function parseClockMode(value: string): HabitatClockMode {
  if (!isClockMode(value)) {
    throw new Error(`Invalid persisted clock mode: ${value}.`);
  }
  return value;
}

function isConnectionStatus(value: string): value is HabitatClockConnectionStatus {
  return value === "disconnected" || value === "connecting" || value === "connected" || value === "error";
}

function parseConnectionStatus(value: string): HabitatClockConnectionStatus {
  if (!isConnectionStatus(value)) {
    throw new Error(`Invalid persisted clock connection status: ${value}.`);
  }
  return value;
}

function toNullableNumber(value: number | null): number | null {
  return value === null || value === undefined ? null : Number(value);
}
