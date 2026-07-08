import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProgram } from "./commands.js";
import type { HabitatBlueprint, HabitatInventoryItem, HabitatModule } from "./types.js";

describe("inventory commands", () => {
  const originalCwd = process.cwd();
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "habitat-inventory-"));
    process.env.HABITAT_DATA_DIRECTORY = path.join(tempDir, "data");
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.exitCode = 0;
    delete process.env.HABITAT_DATA_DIRECTORY;
    process.chdir(originalCwd);

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

    const inventoryPath = path.join(tempDir, "data", "inventory.json");
    expect(existsSync(inventoryPath)).toBe(true);

    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as {
      items: Array<{ resourceId: string; quantity: number; unit?: string; category?: string; source?: string }>;
    };

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
    expect(readModules(tempDir)).toHaveLength(1);
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
    expect(readModules(tempDir)).toHaveLength(1);

    await createProgram().parseAsync(["tick", "--ticks", "4"], { from: "user" });
    expect(readConstruction(tempDir).activeJob?.ticksRemaining).toBe(1);
    expect(readModules(tempDir)).toHaveLength(1);

    await createProgram().parseAsync(["tick", "--ticks", "1"], { from: "user" });
    expect(readConstruction(tempDir).activeJob).toBeNull();
    expect(readModules(tempDir)).toHaveLength(2);
    expect(readModules(tempDir)[1]).toMatchObject({
      blueprintId: "command-module",
      displayName: "Command Module",
      selector: "command-module-1",
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
    const { output, errors } = await runCli(["construction", "cancel", "workshop-fabricator-1"]);

    expect(errors).toHaveLength(0);
    expect(output).toEqual(["Construction canceled: command-module-1."]);
    expect(readInventory(tempDir)).toEqual(beforeCancelInventory);
    expect(readConstruction(tempDir).activeJob).toBeNull();
    expect(readModules(tempDir)).toHaveLength(1);
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
    expect(readConstruction(tempDir).activeJob?.selector).toBe("command-module-1");
    expect(readModules(tempDir)).toHaveLength(1);
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
  writeJson(path.join(tempDir, "data", "kepler.json"), {
    habitatId: "habitat_test",
    habitatUuid: "habitat-test-uuid",
    displayName: "Test Habitat",
    habitat: {
      id: "habitat_test",
      habitatSlug: "test-habitat",
      displayName: "Test Habitat",
      catalogVersion: "test-catalog",
      status: "registered",
      lastSeenAt: null,
    },
    blueprints: overrides.blueprints,
  });
}

function seedInventory(tempDir: string, items: HabitatInventoryItem[]): void {
  writeJson(path.join(tempDir, "data", "inventory.json"), {
    items,
  });
}

function seedModules(tempDir: string, modules: HabitatModule[]): void {
  writeJson(path.join(tempDir, "data", "habitat-modules.json"), modules);
}

function readInventory(tempDir: string): { items: HabitatInventoryItem[] } {
  return readJson(path.join(tempDir, "data", "inventory.json"), { items: [] as HabitatInventoryItem[] });
}

function readConstruction(tempDir: string): { activeJob: null | { ticksRemaining: number } } {
  return readJson(path.join(tempDir, "data", "construction.json"), { activeJob: null });
}

function readModules(tempDir: string): HabitatModule[] {
  return readJson(path.join(tempDir, "data", "habitat-modules.json"), [] as HabitatModule[]);
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}
