import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearLocalHabitatState,
  loadKeplerRegistration,
  saveState,
} from "./state.js";
import type { KeplerRegistration } from "./types.js";

const previousDataDirectory = process.env.HABITAT_DATA_DIRECTORY;
const tempDirectories: string[] = [];

describe("registration state", () => {
  afterEach(() => {
    clearLocalHabitatState();
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
    if (previousDataDirectory === undefined) {
      delete process.env.HABITAT_DATA_DIRECTORY;
    } else {
      process.env.HABITAT_DATA_DIRECTORY = previousDataDirectory;
    }
  });

  test("round-trips the live registration contract shape", () => {
    const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "habitat-state-"));
    tempDirectories.push(dataDirectory);
    process.env.HABITAT_DATA_DIRECTORY = dataDirectory;

    const registration: KeplerRegistration = {
      habitatId: "habitat-1",
      habitatUuid: "11111111-1111-4111-8111-111111111111",
      displayName: "Test Habitat",
      streamUrl: "wss://planet.turingguild.com/planet/stream",
      apiToken: "token",
      stream: {
        protocolVersion: "1.0",
        subscriptions: ["ticks"],
        currentTick: 12,
        tickIntervalMs: 1000,
        ticksPerPulse: 1,
        status: "running",
      },
      contracts: {
        alerts: {
          schemaVersion: "1.0",
          schema: { type: "object" },
        },
      },
      habitat: {
        id: "habitat-1",
        habitatSlug: "test-habitat",
        displayName: "Test Habitat",
        catalogVersion: "2026-06-24",
        status: "registered",
        lastSeenAt: null,
      },
      modules: [
        {
          id: "module-1",
          selector: "module-1",
          blueprintId: "basic-suitport",
          displayName: "Basic Suitport Blueprint",
          connectedTo: [],
          runtimeAttributes: {},
          capabilities: ["limited-eva", "suitport-access"],
        },
      ],
      humans: [
        {
          id: "human-1",
          displayName: "Alex",
          locationModuleId: "module-1",
          status: "present",
        },
        {
          id: "human-2",
          displayName: "Jordan",
          locationModuleId: "module-1",
          status: "present",
        },
      ],
      alerts: [
        {
          id: "alert-1",
          schemaVersion: "1.0",
          type: "power",
          severity: "warning",
          status: "open",
          source: "system",
          message: "Battery low",
          createdAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:00:00.000Z",
          details: {},
        },
      ],
      blueprints: [],
    };

    saveState(registration);

    expect(loadKeplerRegistration()).toEqual(registration);
  });

  test("rolls back the registration when starter human persistence fails", () => {
    const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "habitat-state-"));
    tempDirectories.push(dataDirectory);
    process.env.HABITAT_DATA_DIRECTORY = dataDirectory;

    const existing = createRegistration({
      habitatId: "existing-habitat",
      humans: [createHuman("existing-human", "Existing Human", "existing-module")],
      modules: [createModule("existing-module")],
    });
    saveState(existing);

    const invalid = createRegistration({
      habitatId: "new-habitat",
      humans: [createHuman("duplicate-human", "First", "module-1"), createHuman("duplicate-human", "Second", "module-2")],
      modules: [createModule("module-1"), createModule("module-2")],
    });

    expect(() => saveState(invalid)).toThrow();
    expect(loadKeplerRegistration()).toEqual(existing);
  });

  test("rolls back the registration when starter module persistence fails", () => {
    const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "habitat-state-"));
    tempDirectories.push(dataDirectory);
    process.env.HABITAT_DATA_DIRECTORY = dataDirectory;

    const existing = createRegistration({
      habitatId: "existing-habitat",
      humans: [createHuman("existing-human", "Existing Human", "existing-module")],
      modules: [createModule("existing-module")],
    });
    saveState(existing);

    const invalid = createRegistration({
      habitatId: "new-habitat",
      humans: [createHuman("new-human", "New Human", "module-1")],
      modules: [createModule("duplicate-module"), createModule("duplicate-module")],
    });

    expect(() => saveState(invalid)).toThrow();
    expect(loadKeplerRegistration()).toEqual(existing);
  });

  test("preserves hydrated humans when a later state update omits them", () => {
    const dataDirectory = mkdtempSync(path.join(os.tmpdir(), "habitat-state-"));
    tempDirectories.push(dataDirectory);
    process.env.HABITAT_DATA_DIRECTORY = dataDirectory;

    const existing = createRegistration({ humans: [createHuman("human-1", "Alex", "module-1")], modules: [createModule("module-1")] });
    saveState(existing);
    saveState({ ...existing, humans: [], modules: [createModule("module-2")] });

    expect(loadKeplerRegistration()?.humans).toEqual(existing.humans);
  });
});

function createRegistration(overrides: Partial<KeplerRegistration>): KeplerRegistration {
  return {
    habitatId: "habitat-1",
    habitatUuid: "11111111-1111-4111-8111-111111111111",
    displayName: "Test Habitat",
    streamUrl: "wss://planet.turingguild.com/planet/stream",
    apiToken: "token",
    stream: {
      protocolVersion: "1.0",
      subscriptions: ["ticks"],
      currentTick: 12,
      tickIntervalMs: 1000,
      ticksPerPulse: 1,
      status: "running",
    },
    contracts: { alerts: { schemaVersion: "1.0", schema: { type: "object" } } },
    habitat: {
      id: "habitat-1",
      habitatSlug: "test-habitat",
      displayName: "Test Habitat",
      catalogVersion: "2026-06-24",
      status: "registered",
      lastSeenAt: null,
    },
    modules: [],
    humans: [],
    alerts: [],
    blueprints: [],
    ...overrides,
  };
}

function createHuman(id: string, displayName: string, locationModuleId: string) {
  return { id, displayName, locationModuleId, status: "present" };
}

function createModule(id: string) {
  return {
    id,
    selector: id,
    blueprintId: "basic-suitport",
    displayName: "Basic Suitport Blueprint",
    connectedTo: [],
    runtimeAttributes: {},
    capabilities: ["limited-eva", "suitport-access"],
  };
}
