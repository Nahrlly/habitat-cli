import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProgram } from "./commands.js";
import { app } from "./server.js";
import { saveState } from "./state.js";
import type { KeplerRegistration } from "./types.js";

describe("human commands", () => {
  const originalCwd = process.cwd();
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "habitat-human-"));
    process.env.HABITAT_DATA_DIRECTORY = path.join(tempDir, "data");
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.exitCode = 0;
    delete process.env.HABITAT_DATA_DIRECTORY;
    process.chdir(originalCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("human list renders persisted starter humans", async () => {
    saveState({
      ...registration,
      humans: [
        { id: "human-1", displayName: "Alex", locationModuleId: "module-1", status: "present" },
        { id: "human-2", displayName: "Jordan", locationModuleId: "module-1", status: "present" },
      ],
    });
    const output: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));

    try {
      await createProgram().parseAsync(["human", "list"], { from: "user" });
    } finally {
      console.log = originalLog;
    }

    expect(output.join("\n")).toContain("Alex");
    expect(output.join("\n")).toContain("human-2");
    expect(output.join("\n")).toContain("module-1");
  });

  test("GET /humans returns the same persisted humans", async () => {
    saveState({
      ...registration,
      humans: [{ id: "human-1", displayName: "Alex", locationModuleId: "module-1", status: "present" }],
    });

    const response = await app.fetch(new Request("http://localhost/humans"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      humans: [{ id: "human-1", displayName: "Alex", locationModuleId: "module-1", status: "present" }],
    });
  });

  test("human move changes assignment when the destination has open crew capacity", async () => {
    saveState({
      ...registration,
      humans: [{ id: "human-1", displayName: "Alex", locationModuleId: "module-1", status: "present" }],
      modules: [
        { id: "module-1", selector: "module-1", blueprintId: "source", displayName: "Source", connectedTo: [], runtimeAttributes: { crewCapacity: 1 }, capabilities: [] },
        { id: "habitat_test_workshop_fabricator_2", selector: "workshop-fabricator-1", blueprintId: "destination", displayName: "Destination", connectedTo: ["unrelated"], runtimeAttributes: { crewCapacity: 2, status: "offline" }, capabilities: [] },
      ],
    });

    const output: string[] = [];
    const originalLog = console.log;
    const originalFetch = globalThis.fetch;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
    try {
      await createProgram().parseAsync(["human", "move", "human-1", "workshop-fabricator-1"], { from: "user" });
    } finally {
      console.log = originalLog;
      globalThis.fetch = originalFetch;
    }

    expect(output.join("\n")).toContain("workshop-fabricator-1");
    expect((await app.fetch(new Request("http://localhost/humans"))).status).toBe(200);
    expect(await (await app.fetch(new Request("http://localhost/humans"))).json()).toEqual({
      humans: [{ id: "human-1", displayName: "Alex", locationModuleId: "habitat_test_workshop_fabricator_2", status: "present" }],
    });
  });

  test("human move rejects a missing or full destination", async () => {
    saveState({
      ...registration,
      humans: [
        { id: "human-1", displayName: "Alex", locationModuleId: "module-1", status: "present" },
        { id: "human-2", displayName: "Jordan", locationModuleId: "module-2", status: "present" },
      ],
      modules: [{ id: "module-2", selector: "module-2", blueprintId: "destination", displayName: "Destination", connectedTo: [], runtimeAttributes: { crewCapacity: 1 }, capabilities: [] }],
    });

    const errors: string[] = [];
    const originalError = console.error;
    const originalFetch = globalThis.fetch;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
    try {
      await createProgram().parseAsync(["human", "move", "human-1", "module-2"], { from: "user" });
    } finally {
      console.error = originalError;
      globalThis.fetch = originalFetch;
    }

    expect(errors.join("\n")).toContain("open crew capacity");
  });

  test("move endpoint rejects missing humans and destination modules", async () => {
    saveState({
      ...registration,
      humans: [{ id: "human-1", displayName: "Alex", locationModuleId: "module-1", status: "present" }],
      modules: [{ id: "module-1", selector: "module-1", blueprintId: "source", displayName: "Source", connectedTo: [], runtimeAttributes: { crewCapacity: 1 }, capabilities: [] }],
    });

    const missingHuman = await app.fetch(new Request("http://localhost/humans/missing-human/move", { method: "POST", body: JSON.stringify({ moduleId: "module-1" }) }));
    const missingModule = await app.fetch(new Request("http://localhost/humans/human-1/move", { method: "POST", body: JSON.stringify({ moduleId: "missing-module" }) }));

    expect(missingHuman.status).toBe(404);
    expect(missingModule.status).toBe(404);
  });

  test("module deletion is rejected while a human occupies the module", async () => {
    saveState({
      ...registration,
      humans: [{ id: "human-1", displayName: "Alex", locationModuleId: "module-1", status: "present" }],
      modules: [{ id: "module-1", selector: "module-1", blueprintId: "module", displayName: "Module", connectedTo: [], runtimeAttributes: {}, capabilities: [] }],
    });

    const response = await app.fetch(new Request("http://localhost/modules/module-1", { method: "DELETE" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Module cannot be deleted while a human is occupying it." });
  });
});

const registration: KeplerRegistration = {
  habitatId: "habitat-1",
  habitatUuid: "11111111-1111-4111-8111-111111111111",
  displayName: "Test Habitat",
  streamUrl: "",
  apiToken: "",
  stream: { protocolVersion: "1.0", subscriptions: [], currentTick: 0, tickIntervalMs: 1000, ticksPerPulse: 1, status: "paused" },
  contracts: { alerts: { schemaVersion: "1.0", schema: {} } },
  habitat: { id: "habitat-1", habitatSlug: "test", displayName: "Test Habitat", catalogVersion: "test", status: "registered", lastSeenAt: null },
  modules: [],
  humans: [],
  alerts: [],
  blueprints: [],
};
