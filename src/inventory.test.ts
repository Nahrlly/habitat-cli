import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { createProgram } from "./commands.js";
import { installBackendFetch, setKeplerFetch } from "./test-backend.js";
import type { HabitatBlueprint, HabitatConstructionJob, HabitatInventoryItem, HabitatModule } from "./types.js";

describe("inventory commands", () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  let tempDir = "";
  let restoreFetch = () => {};

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "habitat-inventory-"));
    process.env.HABITAT_DATA_DIRECTORY = path.join(tempDir, "data");
    process.env.HABITAT_API_BASE_URL = "http://localhost:8787";
    process.env.HABITAT_API_LOG = "false";
    process.chdir(tempDir);
    restoreFetch = installBackendFetch(async () =>
      new Response(JSON.stringify({ irradianceKwPerSquareMeter: 0 }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));
  });

  afterEach(() => {
    process.exitCode = 0;
    delete process.env.HABITAT_DATA_DIRECTORY;
    delete process.env.HABITAT_API_BASE_URL;
    delete process.env.HABITAT_API_LOG;
    process.chdir(originalCwd);
    restoreFetch();
    globalThis.fetch = originalFetch;

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("set creates an inventory item, add increments it, and list renders the stored item", async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args: unknown[]) => {
      output.push(args.join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };

    try {
      await createProgram().parseAsync(["inventory", "set", "water", "100", "--unit", "L"], {
        from: "user",
      });
      await createProgram().parseAsync(["inventory", "add", "water", "25"], {
        from: "user",
      });
      await createProgram().parseAsync(["inventory", "list"], {
        from: "user",
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    expect(errors).toHaveLength(0);

    const dbPath = path.join(tempDir, "data", "habitat.sqlite");
    expect(existsSync(dbPath)).toBe(true);
    const inventory = readInventory(tempDir);
    expect(inventory.items).toHaveLength(1);
    expect(inventory.items[0]).toMatchObject({
      resourceId: "water",
      quantity: 125,
      unit: "L",
      source: "local",
    });
    expect(output.some((line) => line.includes("water"))).toBe(true);
    expect(output.some((line) => line.includes("125"))).toBe(true);
    expect(output.some((line) => line.includes("local"))).toBe(true);
  });

  test("dry-run validates blueprint requirements without mutating inventory or creating a job", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [
        createBlueprint({
          blueprintId: "command-module",
          displayName: "Command Module Blueprint",
          inputs: { steel: 10 },
          buildTicks: 5,
        }),
      ],
    });
    seedInventory(tempDir, [
      createInventoryItem({
        resourceId: "steel",
        displayName: "Steel",
        quantity: 12,
        unit: "kg",
        category: "metal",
      }),
    ]);
    seedModules(tempDir, [
      createModule({
        blueprintId: "supply-cache",
        selector: "supply-cache-1",
        displayName: "Supply Cache",
        runtimeAttributes: {
          status: "online",
        },
        capabilities: ["storage"],
      }),
    ]);

    const { errors } = await runCli(["construct", "command-module", "--dry-run"]);

    expect(errors).toHaveLength(0);
    expect(readInventory(tempDir).items[0]?.quantity).toBe(12);
    expect(readConstruction(tempDir).activeJob).toBeNull();
    expect(readModules(tempDir)).toHaveLength(2);
  });

  test("dry-run reports all readiness checks when multiple blockers exist", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [
        createBlueprint({
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array Blueprint",
          inputs: { ferrite: 90, "silicate-glass": 45, "conductive-ore": 18 },
          buildTicks: 3,
          requiredFacility: {
            moduleType: "workshop-fabricator",
            minimumLevel: 1,
          },
          prerequisites: ["supply-cache"],
        }),
      ],
    });
    seedModules(tempDir, [
      createModule({
        blueprintId: "supply-cache",
        selector: "supply-cache-1",
        displayName: "Supply Cache",
        runtimeAttributes: {
          status: "offline",
        },
        capabilities: ["storage"],
      }),
      createModule({
        blueprintId: "workshop-fabricator",
        selector: "workshop-fabricator-1",
        displayName: "Workshop Fabricator",
        runtimeAttributes: {
          status: "offline",
        },
        capabilities: ["basic-fabrication"],
      }),
    ]);
    seedInventory(tempDir, [
      createInventoryItem({
        resourceId: "ferrite",
        displayName: "Ferrite",
        quantity: 10,
        unit: "kg",
        category: "metal",
      }),
    ]);

    const { output, errors } = await runCli(["construct", "small-solar-array", "--dry-run"]);

    expect(errors).toHaveLength(0);
    expect(output.some((line) => line.includes("Construction readiness for Small Solar Array"))).toBe(true);
    expect(output.some((line) => line.includes("Check"))).toBe(true);
    expect(output.some((line) => line.includes("Status"))).toBe(true);
    expect(output.some((line) => line.includes("Details"))).toBe(true);
    expect(output.some((line) => line.includes("Supply cache is online"))).toBe(true);
    expect(output.some((line) => line.includes("Required facility is online or active"))).toBe(true);
    expect(output.some((line) => line.includes("Inventory resources are sufficient"))).toBe(true);
    expect(output.some((line) => line.includes("Construction cannot start."))).toBe(true);
    expect(output.some((line) => line.includes("silicate-glass"))).toBe(true);
    expect(output.some((line) => line.includes("conductive-ore"))).toBe(true);
    expect(readInventory(tempDir).items[0]?.quantity).toBe(10);
    expect(readConstruction(tempDir).activeJob).toBeNull();
  });

  test("construct starts a job, subtracts resources, and creates the module only after enough ticks", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [
        createBlueprint({
          blueprintId: "command-module",
          displayName: "Command Module Blueprint",
          inputs: { steel: 10 },
          buildTicks: 5,
          capabilities: ["habitat-command"],
          runtimeAttributes: {
            status: "offline",
            powerDrawKw: {
              offline: 0,
              online: 2,
              active: 2,
              damaged: 2,
            },
          },
        }),
      ],
    });
    seedInventory(tempDir, [
      createInventoryItem({
        resourceId: "steel",
        displayName: "Steel",
        quantity: 14,
        unit: "kg",
        category: "metal",
      }),
    ]);
    seedModules(tempDir, [
      createModule({
        blueprintId: "supply-cache",
        selector: "supply-cache-1",
        displayName: "Supply Cache",
        runtimeAttributes: {
          status: "online",
        },
        capabilities: ["storage"],
      }),
    ]);

    await createProgram().parseAsync(["construct", "command-module"], { from: "user" });
    expect(readInventory(tempDir).items[0]?.quantity).toBe(4);
    expect(readConstruction(tempDir).activeJob?.ticksRemaining).toBe(5);
    expect(readModules(tempDir)).toHaveLength(2);

    await createProgram().parseAsync(["tick", "--ticks", "4"], { from: "user" });
    expect(readConstruction(tempDir).activeJob?.ticksRemaining).toBe(1);
    expect(readModules(tempDir)).toHaveLength(2);

    await createProgram().parseAsync(["tick", "--ticks", "1"], { from: "user" });
    expect(readConstruction(tempDir).activeJob).toBeNull();
    expect(readModules(tempDir)).toHaveLength(3);
    expect(readModules(tempDir)[2]).toMatchObject({
      blueprintId: "command-module",
      displayName: "Command Module",
      selector: "command-module-1-2",
    });
  });

  test("construction cancel removes the active job without refunding inventory or creating the module", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [
        createBlueprint({
          blueprintId: "command-module",
          displayName: "Command Module Blueprint",
          inputs: { steel: 10 },
          buildTicks: 5,
        }),
      ],
    });
    seedInventory(tempDir, [
      createInventoryItem({
        resourceId: "steel",
        displayName: "Steel",
        quantity: 14,
        unit: "kg",
        category: "metal",
      }),
    ]);
    seedModules(tempDir, [
      createModule({
        blueprintId: "supply-cache",
        selector: "supply-cache-1",
        displayName: "Supply Cache",
        runtimeAttributes: {
          status: "online",
        },
        capabilities: ["storage"],
      }),
    ]);

    await createProgram().parseAsync(["construct", "command-module"], { from: "user" });
    const beforeCancelInventory = readInventory(tempDir);
    const { output, errors } = await runCli(["construction", "cancel"]);

    expect(errors).toHaveLength(0);
    expect(output).toEqual(["Construction canceled: command-module-2."]);
    expect(readInventory(tempDir)).toEqual(beforeCancelInventory);
    expect(readConstruction(tempDir).activeJob).toBeNull();
    expect(readModules(tempDir)).toHaveLength(2);
  });

  test("construction cancel fails when the selector does not match the active job", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [
        createBlueprint({
          blueprintId: "command-module",
          displayName: "Command Module Blueprint",
          inputs: { steel: 10 },
          buildTicks: 5,
        }),
      ],
    });
    seedInventory(tempDir, [
      createInventoryItem({
        resourceId: "steel",
        displayName: "Steel",
        quantity: 14,
        unit: "kg",
        category: "metal",
      }),
    ]);
    seedModules(tempDir, [
      createModule({
        blueprintId: "supply-cache",
        selector: "supply-cache-1",
        displayName: "Supply Cache",
        runtimeAttributes: {
          status: "online",
        },
        capabilities: ["storage"],
      }),
    ]);

    await createProgram().parseAsync(["construct", "command-module"], { from: "user" });
    const beforeCancelInventory = readInventory(tempDir);
    const { output, errors } = await runCli(["construction", "cancel", "wrong-selector"]);

    expect(output).toHaveLength(0);
    expect(errors).toEqual(["No active construction job matches wrong-selector."]);
    expect(readInventory(tempDir)).toEqual(beforeCancelInventory);
    expect(readConstruction(tempDir).activeJob?.selector).toBe("command-module-2");
    expect(readModules(tempDir)).toHaveLength(2);
  });

  test("blocked real construct prints the same report and does not mutate files", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [
        createBlueprint({
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array Blueprint",
          inputs: { ferrite: 90, "silicate-glass": 45, "conductive-ore": 18 },
          buildTicks: 3,
          requiredFacility: {
            moduleType: "workshop-fabricator",
            minimumLevel: 1,
          },
          prerequisites: ["supply-cache"],
        }),
      ],
    });
    seedModules(tempDir, [
      createModule({
        blueprintId: "workshop-fabricator",
        selector: "workshop-fabricator-1",
        displayName: "Workshop Fabricator",
        runtimeAttributes: {
          status: "online",
        },
        capabilities: ["basic-fabrication"],
      }),
    ]);
    seedInventory(tempDir, [
      createInventoryItem({
        resourceId: "ferrite",
        displayName: "Ferrite",
        quantity: 10,
        unit: "kg",
        category: "metal",
      }),
    ]);

    const inventoryBefore = readInventory(tempDir);
    const modulesBefore = readModules(tempDir);
    const { output } = await runCli(["construct", "small-solar-array"]);

    expect(output.some((line) => line.includes("Construction cannot start."))).toBe(true);
    expect(readInventory(tempDir)).toEqual(inventoryBefore);
    expect(readModules(tempDir)).toEqual(modulesBefore);
    expect(readConstruction(tempDir).activeJob).toBeNull();
  });

  test("dry-run reports passing facility and supply-cache checks when requirements are met", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [
        createBlueprint({
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array Blueprint",
          inputs: { ferrite: 90, "silicate-glass": 45, "conductive-ore": 18 },
          buildTicks: 3,
          requiredFacility: {
            moduleType: "workshop-fabricator",
            minimumLevel: 1,
          },
          prerequisites: [],
        }),
      ],
    });
    seedModules(tempDir, [
      createModule({
        blueprintId: "supply-cache",
        selector: "supply-cache-1",
        displayName: "Supply Cache",
        runtimeAttributes: {
          status: "online",
        },
        capabilities: ["storage"],
      }),
      createModule({
        blueprintId: "workshop-fabricator",
        selector: "workshop-fabricator-1",
        displayName: "Workshop Fabricator",
        runtimeAttributes: {
          status: "active",
        },
        capabilities: ["basic-fabrication"],
      }),
    ]);
    seedInventory(tempDir, [
      createInventoryItem({
        resourceId: "ferrite",
        displayName: "Ferrite",
        quantity: 100,
      }),
      createInventoryItem({
        resourceId: "silicate-glass",
        displayName: "Silicate Glass",
        quantity: 50,
      }),
      createInventoryItem({
        resourceId: "conductive-ore",
        displayName: "Conductive Ore",
        quantity: 20,
      }),
    ]);

    const { output, errors } = await runCli(["construct", "small-solar-array", "--dry-run"]);

    expect(errors).toHaveLength(0);
    expect(output.some((line) => line.includes("PASS"))).toBe(true);
    expect(output.some((line) => line.includes("Supply cache is online"))).toBe(true);
    expect(output.some((line) => line.includes("Required facility exists"))).toBe(true);
    expect(output.some((line) => line.includes("Construction can start."))).toBe(true);
  });

  test("module show accepts a unique selector root without the numeric suffix", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [],
    });
    seedModules(tempDir, [
      {
        id: "habitat_test_command_module_1",
        selector: "command-module-1",
        blueprintId: "command-module",
        displayName: "Command Module",
        connectedTo: [],
        runtimeAttributes: {
          status: "offline",
        },
        capabilities: ["habitat-command"],
      },
    ]);

    const output: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => {
      output.push(args.join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };

    try {
      await createProgram().parseAsync(["module", "show", "command-module"], { from: "user" });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    expect(errors).toHaveLength(0);
    const rendered = output.join("\n");
    expect(rendered).toContain("Field");
    expect(rendered).toContain("Name");
    expect(rendered).toContain("Command Module");
    expect(rendered).toContain("Selector");
    expect(rendered).toContain("command-module-1");
    expect(rendered).toContain("Blueprint");
    expect(rendered).toContain("command-module");
    expect(rendered).toContain("Declared state");
    expect(rendered).toContain("offline");
    expect(rendered).toContain("Effective state");
    expect(rendered).toContain("0 kW");
    expect(rendered).toContain("Capabilities");
    expect(rendered).toContain("habitat-command");
  });

  test("module show highlights fabricator activity and in-process storage", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [
        createBlueprint({
          blueprintId: "workshop-fabricator",
          displayName: "Workshop Fabricator Blueprint",
          inputs: { steel: 10 },
          buildTicks: 5,
        }),
      ],
    });
    seedInventory(tempDir, [
      createInventoryItem({
        resourceId: "steel",
        displayName: "Steel",
        quantity: 10,
        unit: "kg",
        category: "metal",
      }),
    ]);
    seedModules(tempDir, [
      createModule({
        blueprintId: "supply-cache",
        selector: "supply-cache-1",
        displayName: "Supply Cache",
        runtimeAttributes: {
          status: "online",
        },
        capabilities: ["storage"],
      }),
      createModule({
        blueprintId: "workshop-fabricator",
        selector: "workshop-fabricator-1",
        displayName: "Workshop Fabricator",
        runtimeAttributes: {
          health: 100,
          status: "active",
          crewCapacity: 1,
          physicalVolumeM3: 20,
          rawMaterialBufferKg: 1500,
          inProcessStorageM3: 3,
          powerDrawKw: {
            offline: 0,
            online: 1,
            active: 8,
            damaged: 1,
          },
        },
        capabilities: ["basic-fabrication"],
      }),
    ]);

    await createProgram().parseAsync(["construct", "workshop-fabricator"], { from: "user" });
    const { output, errors } = await runCli(["module", "show", "workshop-fabricator"]);

    expect(errors).toHaveLength(0);
    const rendered = output.join("\n");
    expect(rendered).toContain("Declared state");
    expect(rendered).toContain("Effective state");
    expect(rendered).toContain("active");
    expect(rendered).toContain("Activity");
    expect(rendered).toContain("construction in progress");
    expect(rendered).toContain("workshop-fabricator-1");
    expect(rendered).toContain("3 m3");
  });

  test("module status shows declared and effective state", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [],
    });
    seedModules(tempDir, [
      createModule({
        blueprintId: "workshop-fabricator",
        selector: "workshop-fabricator-1",
        displayName: "Workshop Fabricator",
        runtimeAttributes: {
          status: "online",
          inProcessStorageM3: 3,
          powerDrawKw: {
            offline: 0,
            online: 1,
            active: 8,
            damaged: 1,
          },
        },
        capabilities: ["basic-fabrication"],
      }),
    ]);

    const { output, errors } = await runCli(["module", "status"]);

    expect(errors).toHaveLength(0);
    const rendered = output.join("\n");
    expect(rendered).toContain("Declared State");
    expect(rendered).toContain("Effective State");
    expect(rendered).toContain("workshop-fabricator-1");
    expect(rendered).toContain("online");
    expect(rendered).toContain("active");
  });

  test("power-storage modules default to online when created without a status", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [],
    });

    const { errors } = await runCli(["module", "create", "Battery", "--capability", "power-storage"]);

    expect(errors).toHaveLength(0);
    expect(readModules(tempDir)).toHaveLength(1);
    expect(readModules(tempDir)[0]?.runtimeAttributes.status).toBe("online");
  });

  test("solar tick fills batteries one at a time", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [],
    });
    seedModules(tempDir, [
      createModule({
        blueprintId: "small-solar-array",
        selector: "small-solar-array-1",
        displayName: "Small Solar Array",
        runtimeAttributes: {
          status: "online",
          powerGenerationKw: 12,
        },
        capabilities: ["solar-generation"],
      }),
      createModule({
        blueprintId: "basic-battery",
        selector: "basic-battery-1",
        displayName: "Basic Battery One",
        runtimeAttributes: {
          status: "online",
          currentEnergyKwh: 9,
          energyStorageKwh: 10,
        },
        capabilities: ["power-storage"],
      }),
      createModule({
        blueprintId: "basic-battery",
        selector: "basic-battery-2",
        displayName: "Basic Battery Two",
        runtimeAttributes: {
          status: "online",
          currentEnergyKwh: 0,
          energyStorageKwh: 10,
        },
        capabilities: ["power-storage"],
      }),
    ]);

    setKeplerFetch(async () =>
      new Response(JSON.stringify({ wPerM2: 900 }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })) as typeof fetch;

    const { errors } = await runCli(["tick", "--ticks", "3600"]);

    expect(errors).toHaveLength(0);
    expect(readModules(tempDir)[2]?.runtimeAttributes.currentEnergyKwh).toBe(10);
    expect(readModules(tempDir)[3]?.runtimeAttributes.currentEnergyKwh).toBe(5);
  });

  test("tick uses the registered energyKwh when currentEnergyKwh is absent", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [],
    });
    seedModules(tempDir, [
      createModule({
        blueprintId: "basic-battery",
        selector: "basic-battery-1",
        displayName: "Basic Battery",
        runtimeAttributes: {
          status: "online",
          energyKwh: 500,
          energyStorageKwh: 500,
        },
        capabilities: ["power-storage"],
      }),
      createModule({
        blueprintId: "workshop-fabricator",
        selector: "workshop-fabricator-1",
        displayName: "Workshop Fabricator",
        runtimeAttributes: {
          status: "online",
          powerDrawKw: 1,
        },
        capabilities: ["basic-fabrication"],
      }),
    ]);

    setKeplerFetch(async () =>
      new Response(JSON.stringify({ solarIrradiance: { wPerM2: 0, condition: "night" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const { errors } = await runCli(["tick", "--ticks", "3600"]);

    expect(errors).toHaveLength(0);
    const battery = readModules(tempDir).find((module) => module.selector === "basic-battery-1");
    expect(battery?.runtimeAttributes.currentEnergyKwh).toBe(499);
    expect(battery?.runtimeAttributes.energyKwh).toBe(499);
  });

  test("offline batteries do not receive solar charge", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [],
    });
    seedModules(tempDir, [
      createModule({
        blueprintId: "small-solar-array",
        selector: "small-solar-array-1",
        displayName: "Small Solar Array",
        runtimeAttributes: {
          status: "online",
          powerGenerationKw: 12,
        },
        capabilities: ["solar-generation"],
      }),
      createModule({
        blueprintId: "basic-battery",
        selector: "basic-battery-1",
        displayName: "Basic Battery One",
        runtimeAttributes: {
          status: "offline",
          currentEnergyKwh: 9,
          energyStorageKwh: 10,
        },
        capabilities: ["power-storage"],
      }),
    ]);

    setKeplerFetch(async () =>
      new Response(JSON.stringify({ wPerM2: 900 }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })) as typeof fetch;

    const { errors } = await runCli(["tick", "--ticks", "3600"]);

    expect(errors).toHaveLength(0);
    expect(readModules(tempDir)[2]?.runtimeAttributes.currentEnergyKwh).toBe(9);
  });

  test("tick reports why no solar charging happened", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [],
    });
    seedModules(tempDir, [
      createModule({
        blueprintId: "small-solar-array",
        selector: "small-solar-array-1",
        displayName: "Small Solar Array",
        runtimeAttributes: {
          status: "offline",
          powerGenerationKw: 12,
        },
        capabilities: ["solar-generation"],
      }),
      createModule({
        blueprintId: "basic-battery",
        selector: "basic-battery-1",
        displayName: "Basic Battery One",
        runtimeAttributes: {
          status: "online",
          currentEnergyKwh: 9,
          energyStorageKwh: 10,
        },
        capabilities: ["power-storage"],
      }),
    ]);

    setKeplerFetch(async () =>
      new Response(JSON.stringify({ wPerM2: 900 }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })) as typeof fetch;

    const { output, errors } = await runCli(["tick", "--ticks", "3600"]);

    expect(errors).toHaveLength(0);
    expect(output.some((line) => line.includes("Total solar generation: 0"))).toBe(true);
    expect(output.some((line) => line.includes("no solar charging happened because no solar generation modules were online or active"))).toBe(true);
  });

  test("all modules go offline when the battery reaches zero", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [],
    });
    seedModules(tempDir, [
      createModule({
        blueprintId: "small-solar-array",
        selector: "small-solar-array-1",
        displayName: "Small Solar Array",
        runtimeAttributes: {
          status: "online",
          powerGenerationKw: 1,
        },
        capabilities: ["solar-generation"],
      }),
      createModule({
        blueprintId: "basic-battery",
        selector: "basic-battery-1",
        displayName: "Basic Battery One",
        runtimeAttributes: {
          status: "online",
          currentEnergyKwh: 0.0001,
          energyStorageKwh: 10,
        },
        capabilities: ["power-storage"],
      }),
      createModule({
        blueprintId: "workshop-fabricator",
        selector: "workshop-fabricator-1",
        displayName: "Workshop Fabricator",
        runtimeAttributes: {
          status: "online",
          powerDrawKw: {
            offline: 0,
            online: 1,
            active: 1,
            damaged: 1,
          },
        },
        capabilities: ["basic-fabrication"],
      }),
    ]);

    setKeplerFetch(async () =>
      new Response(JSON.stringify({ solarIrradiance: { wPerM2: 0, condition: "night" } }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })) as typeof fetch;

    const { errors } = await runCli(["tick", "--ticks", "3600"]);

    expect(errors).toHaveLength(0);
    expect(readModules(tempDir).every((module) => module.runtimeAttributes.status === "offline")).toBe(true);

    setKeplerFetch(async () =>
      new Response(JSON.stringify({ solarIrradiance: { wPerM2: 900, condition: "clear" } }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })) as typeof fetch;

    const secondTick = await runCli(["tick", "--ticks", "3600"]);

    expect(secondTick.errors).toHaveLength(0);
    expect(secondTick.output.some((line) => line.includes("Advanced 3600 tick(s) at 1 second(s) per tick."))).toBe(true);
  });

  test("offline fabricator is not shown as active after shutdown", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [
        createBlueprint({
          blueprintId: "command-module",
          displayName: "Command Module Blueprint",
          inputs: { steel: 10 },
          buildTicks: 5,
          requiredFacility: {
            moduleType: "workshop-fabricator",
            minimumLevel: 1,
          },
        }),
      ],
    });
    seedInventory(tempDir, [
      createInventoryItem({
        resourceId: "steel",
        displayName: "Steel",
        quantity: 10,
        unit: "kg",
        category: "metal",
      }),
    ]);
    seedModules(tempDir, [
      createModule({
        blueprintId: "workshop-fabricator",
        selector: "workshop-fabricator-1",
        displayName: "Workshop Fabricator",
        runtimeAttributes: {
          status: "online",
          powerDrawKw: {
            offline: 0,
            online: 1,
            active: 1,
            damaged: 1,
          },
        },
        capabilities: ["basic-fabrication"],
      }),
      createModule({
        blueprintId: "basic-battery",
        selector: "basic-battery-1",
        displayName: "Basic Battery One",
        runtimeAttributes: {
          status: "online",
          currentEnergyKwh: 0.0001,
          energyStorageKwh: 10,
        },
        capabilities: ["power-storage"],
      }),
    ]);

    setKeplerFetch(async () =>
      new Response(JSON.stringify({ solarIrradiance: { wPerM2: 0, condition: "night" } }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })) as typeof fetch;

    await runCli(["tick", "--ticks", "3600"]);
    const { output, errors } = await runCli(["module", "show", "workshop-fabricator"]);

    expect(errors).toHaveLength(0);
    expect(output.some((line) => line.includes("Declared state"))).toBe(true);
    expect(output.some((line) => line.includes("offline"))).toBe(true);
    expect(output.some((line) => line.includes("construction in progress"))).toBe(false);
  });

  test("power overview reports module-level sources and sinks", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [],
    });
    seedModules(tempDir, [
      createModule({
        blueprintId: "small-solar-array",
        selector: "small-solar-array-1",
        displayName: "Small Solar Array",
        runtimeAttributes: {
          status: "online",
          powerGenerationKw: 12,
        },
        capabilities: ["solar-generation"],
      }),
      createModule({
        blueprintId: "basic-battery",
        selector: "basic-battery-1",
        displayName: "Basic Battery One",
        runtimeAttributes: {
          status: "online",
          currentEnergyKwh: 9,
          energyStorageKwh: 10,
        },
        capabilities: ["power-storage"],
      }),
    ]);

    setKeplerFetch(async () =>
      new Response(JSON.stringify({ solarIrradiance: { wPerM2: 900, condition: "clear" } }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      })) as typeof fetch;

    const { output, errors } = await runCli(["power", "overview"]);

    expect(errors).toHaveLength(0);
    expect(output.some((line) => line.includes("Power overview at 900 W/m2 solar irradiance"))).toBe(true);
    expect(output.some((line) => line.includes("small-solar-array-1"))).toBe(true);
    expect(output.some((line) => line.includes("Solar Generation"))).toBe(true);
    expect(output.some((line) => line.includes("basic-battery-1"))).toBe(true);
    expect(output.some((line) => line.includes("online"))).toBe(true);
  });

  test("unregister clears local habitat state before a new registration starts", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [],
    });
    seedInventory(tempDir, [
      createInventoryItem({
        resourceId: "ferrite",
        displayName: "Ferrite",
        quantity: 42,
      }),
    ]);
    seedConstruction(tempDir, {
      activeJob: createConstructionJob({
        blueprintId: "command-module",
        displayName: "Command Module",
        moduleType: "command-module",
        selector: "command-module-1",
        fabricatorId: "workshop-fabricator-1",
        fabricatorSelector: "workshop-fabricator-1",
        pendingModuleName: "Command Module",
        connectedTo: [],
        ticksRequired: 5,
        ticksRemaining: 5,
        consumedInputs: [],
        runtimeAttributes: {},
        capabilities: [],
      }),
    });
    seedModules(tempDir, [
      createModule({
        blueprintId: "basic-battery",
        selector: "basic-battery-1",
        displayName: "Basic Battery",
        runtimeAttributes: {
          status: "offline",
          energyKwh: 0,
          energyStorageKwh: 10,
        },
        capabilities: ["power-storage"],
      }),
    ]);

    const originalFetch = globalThis.fetch;
    setKeplerFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/habitats/habitat_test") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      if (url.endsWith("/habitats/register") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            habitatId: "habitat_test",
            starterModules: [
              {
                id: "habitat_test_basic_battery_1",
                selector: "basic-battery-1",
                blueprintId: "basic-battery",
                displayName: "Basic Battery",
                connectedTo: [],
                runtimeAttributes: {
                  status: "online",
                  energyKwh: 10,
                  energyStorageKwh: 10,
                },
                capabilities: ["power-storage"],
              },
            ],
            blueprints: [],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      if (url.endsWith("/habitats/habitat_test")) {
        return new Response(
          JSON.stringify({
            habitat: {
              id: "habitat_test",
              habitatSlug: "test-habitat",
              displayName: "Test Habitat",
              catalogVersion: "v1",
              status: "registered",
              lastSeenAt: null,
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      return new Response(null, { status: 404 });
    });

    try {
      const unregisterResult = await runCli(["unregister"]);
      expect(unregisterResult.errors).toHaveLength(0);
      expect(readInventory(tempDir).items).toEqual([]);
      expect(readConstruction(tempDir).activeJob).toBeNull();
      expect(readModules(tempDir)).toEqual([]);

      const registerResult = await runCli(["register", "--name", "Test Habitat"]);
      expect(registerResult.errors).toHaveLength(0);
      expect(readInventory(tempDir).items).toEqual([]);
      expect(readConstruction(tempDir).activeJob).toBeNull();
      expect(readModules(tempDir)).toHaveLength(1);
      expect(readModules(tempDir)[0]?.runtimeAttributes.status).toBe("online");
    } finally {
      setKeplerFetch(async () => new Response(JSON.stringify({}), { status: 200 }));
    }
  });

  test("module construct remains available as a backward-compatible alias", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [
        createBlueprint({
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array Blueprint",
          inputs: { ferrite: 90 },
          buildTicks: 3,
        }),
      ],
    });
    seedInventory(tempDir, [
      createInventoryItem({
        resourceId: "ferrite",
        displayName: "Ferrite",
        quantity: 100,
        unit: "kg",
        category: "metal",
      }),
    ]);
    seedModules(tempDir, [
      createModule({
        blueprintId: "supply-cache",
        selector: "supply-cache-1",
        displayName: "Supply Cache",
        runtimeAttributes: {
          status: "online",
        },
        capabilities: ["storage"],
      }),
    ]);

    const errors: string[] = [];
    const output: string[] = [];
    const originalError = console.error;
    const originalLog = console.log;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };
    console.log = (...args: unknown[]) => {
      output.push(args.join(" "));
    };

    try {
      await createProgram().parseAsync(["module", "construct", "small-solar-array", "--dry-run"], { from: "user" });
    } finally {
      console.error = originalError;
      console.log = originalLog;
    }

    expect(errors).toHaveLength(0);
    expect(output.some((line) => line.includes("Construction readiness for Small Solar Array"))).toBe(true);
    expect(output.some((line) => line.includes("Construction can start."))).toBe(true);
  });

  test("construction status reports idle when no job exists", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [],
    });

    const { output, errors } = await runCli(["construction", "status"]);

    expect(errors).toHaveLength(0);
    expect(output).toEqual(["Construction: idle."]);
  });

  test("construction status reports compact progress for an active job", async () => {
    seedRegisteredState(tempDir, {
      blueprints: [
        createBlueprint({
          blueprintId: "command-module",
          displayName: "Command Module Blueprint",
          inputs: { steel: 10 },
          buildTicks: 5,
        }),
      ],
    });
    seedInventory(tempDir, [
      createInventoryItem({
        resourceId: "steel",
        displayName: "Steel",
        quantity: 10,
        unit: "kg",
        category: "metal",
      }),
    ]);
    seedModules(tempDir, [
      createModule({
        blueprintId: "supply-cache",
        selector: "supply-cache-1",
        displayName: "Supply Cache",
        runtimeAttributes: {
          status: "online",
        },
        capabilities: ["storage"],
      }),
    ]);

    await createProgram().parseAsync(["construct", "command-module"], { from: "user" });
    const { output, errors } = await runCli(["construction", "status"]);

    expect(errors).toHaveLength(0);
    expect(output).toEqual(["Construction: Command Module 5/5 ticks remaining (0%)."]);
  });
});

async function runCli(args: string[]): Promise<{ output: string[]; errors: string[] }> {
  const output: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...parts: unknown[]) => {
    output.push(parts.join(" "));
  };
  console.error = (...parts: unknown[]) => {
    errors.push(parts.join(" "));
  };

  try {
    await createProgram().parseAsync(args, { from: "user" });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return { output, errors };
}

function createBlueprint(overrides: Partial<HabitatBlueprint> & Pick<HabitatBlueprint, "blueprintId" | "displayName">): HabitatBlueprint {
  return {
    blueprintId: overrides.blueprintId,
    displayName: overrides.displayName,
    description: overrides.description ?? "",
    output: overrides.output ?? {
      itemType: "module",
      moduleType: overrides.blueprintId,
      quantity: 1,
    },
    inputs: overrides.inputs ?? {},
    productionCost: overrides.productionCost ?? {},
    requiredFacility: overrides.requiredFacility ?? {},
    buildTicks: overrides.buildTicks ?? 0,
    prerequisites: overrides.prerequisites ?? [],
    unlocks: overrides.unlocks ?? [],
    repeatable: overrides.repeatable ?? true,
    level: overrides.level ?? null,
    target: overrides.target ?? {},
    facilityLevel: overrides.facilityLevel ?? {},
    attachmentPoints: overrides.attachmentPoints ?? {},
    attachmentRequirements: overrides.attachmentRequirements ?? [],
    runtimeAttributes: overrides.runtimeAttributes ?? {},
    capabilities: overrides.capabilities ?? [],
  };
}

function createInventoryItem(
  overrides: Partial<HabitatInventoryItem> & Pick<HabitatInventoryItem, "resourceId" | "displayName" | "quantity">,
): HabitatInventoryItem {
  return {
    resourceId: overrides.resourceId,
    displayName: overrides.displayName,
    quantity: overrides.quantity,
    unit: overrides.unit ?? "",
    category: overrides.category ?? "",
    source: overrides.source ?? "local",
    updatedAt: overrides.updatedAt ?? new Date(0).toISOString(),
  };
}

function createModule(
  overrides: Partial<HabitatModule> & Pick<HabitatModule, "blueprintId" | "selector" | "displayName">,
): HabitatModule {
  return {
    id: overrides.id ?? `${overrides.blueprintId}_${overrides.selector}`,
    selector: overrides.selector,
    blueprintId: overrides.blueprintId,
    displayName: overrides.displayName,
    connectedTo: overrides.connectedTo ?? [],
    runtimeAttributes: overrides.runtimeAttributes ?? {},
    capabilities: overrides.capabilities ?? [],
  };
}

function seedRegisteredState(tempDir: string, overrides: { blueprints: HabitatBlueprint[] }): void {
  withDatabase(tempDir, (db) => {
    db.run("DELETE FROM kepler_registration;");
    db.run("DELETE FROM habitat_modules;");
    db.run("DELETE FROM construction_state;");
    db.run("DELETE FROM inventory_items;");
    db.query(
      `INSERT INTO kepler_registration (habitat_id, habitat_uuid, display_name, habitat_json, blueprints_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "habitat_test",
      "habitat-test-uuid",
      "Test Habitat",
      JSON.stringify({
        id: "habitat_test",
        habitatSlug: "test-habitat",
        displayName: "Test Habitat",
        catalogVersion: "test-catalog",
        status: "registered",
        lastSeenAt: null,
      }),
      JSON.stringify(overrides.blueprints),
    );
  });
}

function seedInventory(tempDir: string, items: HabitatInventoryItem[]): void {
  withDatabase(tempDir, (db) => {
    db.run("DELETE FROM inventory_items;");
    const insert = db.query(
      `INSERT INTO inventory_items (resource_id, display_name, quantity, unit, category, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of items) {
      insert.run(item.resourceId, item.displayName, item.quantity, item.unit, item.category, item.source, item.updatedAt);
    }
  });
}

function seedModules(tempDir: string, modules: HabitatModule[]): void {
  const commandModule = createModule({
    blueprintId: "command-module",
    selector: "command-module-1",
    displayName: "Command Module",
    runtimeAttributes: {
      status: "online",
      powerDrawKw: {
        offline: 0,
        online: 0,
        active: 0,
        damaged: 0,
      },
    },
    capabilities: ["habitat-command"],
  });
  const nextModules = modules.some((module) => module.blueprintId === "command-module")
    ? modules
    : [commandModule, ...modules];
  withDatabase(tempDir, (db) => {
    db.run("DELETE FROM habitat_modules;");
    const insert = db.query(
      `INSERT INTO habitat_modules (id, selector, blueprint_id, display_name, connected_to_json, runtime_attributes_json, capabilities_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const module of nextModules) {
      insert.run(
        module.id,
        module.selector,
        module.blueprintId,
        module.displayName,
        JSON.stringify(module.connectedTo),
        JSON.stringify(module.runtimeAttributes),
        JSON.stringify(module.capabilities),
      );
    }
  });
}

function seedConstruction(tempDir: string, state: { activeJob: HabitatConstructionJob | null }): void {
  withDatabase(tempDir, (db) => {
    db.run("DELETE FROM construction_state;");
    db.query(`INSERT INTO construction_state (id, active_job_json) VALUES (1, ?)`).run(JSON.stringify(state.activeJob));
  });
}

function readInventory(tempDir: string): { items: HabitatInventoryItem[] } {
  return withDatabase(tempDir, (db) => {
    const rows = db
      .query(
        `SELECT resource_id AS resourceId, display_name AS displayName, quantity, unit, category, source, updated_at AS updatedAt
         FROM inventory_items
         ORDER BY resource_id`,
      )
      .all() as HabitatInventoryItem[];
    return { items: rows };
  });
}

function readConstruction(tempDir: string): { activeJob: null | { ticksRemaining: number } } {
  return withDatabase(tempDir, (db) => {
    const row = db
      .query(`SELECT active_job_json AS activeJobJson FROM construction_state WHERE id = 1 LIMIT 1`)
      .get() as { activeJobJson?: string } | undefined;
    return { activeJob: row?.activeJobJson ? (JSON.parse(row.activeJobJson) as { ticksRemaining: number }) : null };
  });
}

function readModules(tempDir: string): HabitatModule[] {
  return withDatabase(tempDir, (db) => {
    const rows = db
      .query(
        `SELECT id, selector, blueprint_id AS blueprintId, display_name AS displayName, connected_to_json AS connectedToJson,
                runtime_attributes_json AS runtimeAttributesJson, capabilities_json AS capabilitiesJson
         FROM habitat_modules`,
      )
      .all() as Array<{
      id: string;
      selector: string;
      blueprintId: string;
      displayName: string;
      connectedToJson: string;
      runtimeAttributesJson: string;
      capabilitiesJson: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      selector: row.selector,
      blueprintId: row.blueprintId,
      displayName: row.displayName,
      connectedTo: JSON.parse(row.connectedToJson),
      runtimeAttributes: JSON.parse(row.runtimeAttributesJson),
      capabilities: JSON.parse(row.capabilitiesJson),
    }));
  });
}

function createConstructionJob(overrides: HabitatConstructionJob): HabitatConstructionJob {
  return {
    startedAt: "2026-07-09T00:00:00.000Z",
    ...overrides,
  };
}

function withDatabase<T>(tempDir: string, callback: (db: Database) => T): T {
  const dataDir = path.join(tempDir, "data");
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "habitat.sqlite"));
  try {
    db.run("PRAGMA foreign_keys = ON;");
    db.run(`
      CREATE TABLE IF NOT EXISTS kepler_registration (
        habitat_id TEXT PRIMARY KEY,
        habitat_uuid TEXT NOT NULL,
        display_name TEXT NOT NULL,
        habitat_json TEXT NOT NULL,
        blueprints_json TEXT NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS habitat_modules (
        id TEXT PRIMARY KEY,
        selector TEXT NOT NULL,
        blueprint_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        connected_to_json TEXT NOT NULL,
        runtime_attributes_json TEXT NOT NULL,
        capabilities_json TEXT NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS inventory_items (
        resource_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT NOT NULL,
        category TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS construction_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active_job_json TEXT NOT NULL
      );
    `);
    return callback(db);
  } finally {
    db.close();
  }
}
