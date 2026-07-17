import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadClockState,
  saveClockState,
  updateClockState,
} from "./clock-state.js";

const previousDataDirectory = process.env.HABITAT_DATA_DIRECTORY;
const tempDirectories: string[] = [];

describe("clock state", () => {
  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
    if (previousDataDirectory === undefined) {
      delete process.env.HABITAT_DATA_DIRECTORY;
    } else {
      process.env.HABITAT_DATA_DIRECTORY = previousDataDirectory;
    }
  });

  test("defaults to manual mode with listening disabled", () => {
    useTemporaryDatabase();

    expect(loadClockState()).toEqual({
      mode: "manual",
      listening: false,
      connectionStatus: "disconnected",
      latestAbsoluteTick: null,
      latestAdvancedBy: null,
      lastConnectionAt: null,
      lastMessageAt: null,
      latestError: null,
    });
  });

  test("round-trips clock state across database reopen", () => {
    useTemporaryDatabase();
    const state = {
      mode: "kepler" as const,
      listening: true,
      connectionStatus: "connected" as const,
      latestAbsoluteTick: 420,
      latestAdvancedBy: 10,
      lastConnectionAt: "2026-07-16T10:00:00.000Z",
      lastMessageAt: "2026-07-16T10:00:01.000Z",
      latestError: null,
    };

    saveClockState(state);

    expect(loadClockState()).toEqual(state);
  });

  test("updates only supplied fields while retaining persisted clock state", () => {
    useTemporaryDatabase();
    saveClockState({
      mode: "kepler",
      listening: true,
      connectionStatus: "connected",
      latestAbsoluteTick: 100,
      latestAdvancedBy: 1,
      lastConnectionAt: "2026-07-16T10:00:00.000Z",
      lastMessageAt: "2026-07-16T10:00:01.000Z",
      latestError: null,
    });

    expect(updateClockState({
      connectionStatus: "error",
      latestError: "stream disconnected",
    })).toEqual({
      mode: "kepler",
      listening: true,
      connectionStatus: "error",
      latestAbsoluteTick: 100,
      latestAdvancedBy: 1,
      lastConnectionAt: "2026-07-16T10:00:00.000Z",
      lastMessageAt: "2026-07-16T10:00:01.000Z",
      latestError: "stream disconnected",
    });
  });

  test("adds clock storage without changing existing registration stream fields", () => {
    const dataDirectory = useTemporaryDatabase();
    const database = new Database(path.join(dataDirectory, "habitat.sqlite"));
    database.run(`
      CREATE TABLE kepler_registration (
        habitat_id TEXT PRIMARY KEY,
        habitat_uuid TEXT NOT NULL,
        display_name TEXT NOT NULL,
        stream_url TEXT NOT NULL,
        api_token TEXT NOT NULL,
        stream_json TEXT NOT NULL,
        contracts_json TEXT NOT NULL,
        habitat_json TEXT NOT NULL,
        blueprints_json TEXT NOT NULL
      )
    `);
    database.query(
      `INSERT INTO kepler_registration
        (habitat_id, habitat_uuid, display_name, stream_url, api_token, stream_json, contracts_json, habitat_json, blueprints_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "habitat-1",
      "uuid-1",
      "Habitat",
      "wss://planet.example/stream",
      "secret-token",
      JSON.stringify({ subscriptions: ["ticks"] }),
      "{}",
      "{}",
      "[]",
    );
    database.close();

    expect(loadClockState().mode).toBe("manual");

    const reopened = new Database(path.join(dataDirectory, "habitat.sqlite"));
    expect(reopened.query(
      "SELECT stream_url AS streamUrl, api_token AS apiToken, stream_json AS streamJson FROM kepler_registration",
    ).get()).toEqual({
      streamUrl: "wss://planet.example/stream",
      apiToken: "secret-token",
      streamJson: JSON.stringify({ subscriptions: ["ticks"] }),
    });
    expect(reopened.query("SELECT mode, listening FROM clock_state WHERE id = 1").get()).toEqual({
      mode: "manual",
      listening: 0,
    });
    reopened.close();
  });
});

function useTemporaryDatabase(): string {
  const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "habitat-clock-state-"));
  tempDirectories.push(dataDirectory);
  process.env.HABITAT_DATA_DIRECTORY = dataDirectory;
  return dataDirectory;
}
