import { randomUUID } from "node:crypto";
import { Command, InvalidArgumentError } from "commander";
import { advanceConstruction, cancelConstruction, loadConstructionState, saveConstructionState, startConstruction } from "./construction-state.js";
import { type KeplerCatalogBlueprint, type KeplerCatalogResource } from "./kepler-catalog.js";
import { addInventoryQuantity, loadInventoryState, setInventoryQuantity } from "./inventory-state.js";
import { assertModuleCanBeDeleted, listHumans } from "./human-domain.js";
import { createApiClient, ApiError } from "./api-client.js";
import {
  ensureKeplerEnv,
  ensureDefaultModuleRuntimeStatus,
  clearLocalHabitatState,
  loadStateOrFail,
  saveState,
  setModuleStatus,
} from "./state.js";
import { clearPowerHistory } from "./power-history.js";
import {
  applyTick,
  applyTickWithSolarIrradiance,
  buildModuleStatusRows,
  formatConstructionReadinessReport,
  formatConstructionProgress,
  formatConstructionStatus,
  formatConstructionShortages,
  formatBlueprintList,
  formatBlueprintSummary,
  formatEnergyCost,
  formatInventoryList,
  formatHumanList,
  formatModuleDetails,
  formatModuleSummary,
  formatPowerDraw,
  formatPowerOverview,
  formatResourceList,
  formatResourceScan,
  formatSolarIrradiance,
  getDeclaredModuleStatus,
  getModulePowerDraw,
  powerDrawToEnergyCost,
  renderTextTable,
  sumModulePowerDraw,
} from "./formatters.js";
import type {
  KeplerBlueprint,
  HabitatBlueprint,
  HabitatModule,
  KeplerRegistration,
  KeplerRegistrationResponse,
  KeplerStarterModule,
} from "./types.js";

let apiClient = createApiClient();
let keplerBaseUrl = "";
let keplerPlanetToken = "";

export function createProgram(): Command {
  const program = new Command();
  apiClient = createApiClient();

  program.name("habitat").description("Register this Habitat CLI with Kepler and inspect its status.").version("0.1.0");

  program
    .command("register")
    .description("Register this Habitat CLI with Kepler.")
    .requiredOption("--name <name>", "habitat name")
    .action(async (options: { name: string }) => {
      try {
        const registration = await registerWithKepler(options.name);
        saveState(registration);
        console.log(`Registered habitat ${registration.displayName}.`);
      } catch (error) {
        console.error(formatApiError(error));
        process.exitCode = 1;
      }
    });

  program
    .command("status")
    .description("Show the current Kepler registration status.")
    .action(async () => {
      try {
        const registration = await apiClient.getJson<KeplerRegistration>("/registration");
        const habitat = registration.habitat;

        console.log(`Habitat "${habitat.displayName}" is registered with Kepler.`);
        console.log(`Habitat ID: ${habitat.id}`);
        console.log(`Habitat slug: ${habitat.habitatSlug}`);
        console.log(`Kepler catalog version: ${habitat.catalogVersion}`);
        console.log(`Kepler status: ${habitat.status}`);
        console.log(`Last seen at: ${habitat.lastSeenAt ?? "unknown"}`);
        console.log(`Modules created: ${formatModuleSummary(registration)}`);
      } catch (error) {
        console.error(formatRecentCommandError(error, "Human move"));
        process.exitCode = 1;
      }
    });

  program
    .command("tick")
    .description("Advance habitat power consumption by one or more ticks.")
    .option("--ticks <ticks>", "number of ticks to advance", (value) => parsePositiveNumber(value, "ticks"), 1)
    .argument("[unit]", "seconds or hours")
    .action(async (unit: string | undefined, options: { ticks: number }) => {
      try {
        const registration = loadStateOrFail();
        const tickCount = Math.floor(options.ticks);
        const secondsPerTick = parseTickUnit(unit);
        if (tickCount <= 0) {
          throw new Error("ticks must be greater than zero.");
        }

        const solarResponse = normalizeSolarStatus(
          await apiClient.getJson<Record<string, unknown> | { solarIrradiance?: Record<string, unknown> }>("/solar/status"),
        );
        const nextState = applyTickWithSolarIrradiance(registration, tickCount * secondsPerTick, solarResponse.solarIrradiance);
        const constructionResult = advanceConstruction(tickCount * secondsPerTick);
        const completedModule = constructionResult.completedJob
          ? createConstructedModule(nextState.registration, constructionResult.completedJob)
          : null;
        const persistedRegistration =
          completedModule === null
            ? nextState.registration
            : {
                ...nextState.registration,
                modules: [...nextState.registration.modules, completedModule],
              };
        saveState(persistedRegistration);

        console.log(`Advanced ${tickCount} tick(s) at ${secondsPerTick} second(s) per tick.`);
        console.log(`Total power draw: ${formatEnergyCost(nextState.totalPowerDraw)} kWh.`);
        console.log(`Total solar generation: ${formatEnergyCost(nextState.totalSolarGeneration)} kWh.`);
        console.log(`Battery charge: ${nextState.batteryBefore} kWh -> ${nextState.batteryAfter} kWh.`);
        if (nextState.solarChargeReason) {
          console.log(nextState.solarChargeReason);
        }
        if (constructionResult.activeJob) {
          console.log(formatConstructionProgress(constructionResult.activeJob));
        }
        if (completedModule) {
          console.log(`Construction completed: ${completedModule.displayName} (${completedModule.selector}).`);
        }
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  const solarCommand = program.command("solar").description("Inspect solar conditions from Kepler.");

  solarCommand
    .command("status")
    .description("Show the current solar irradiance from Kepler.")
    .action(async () => {
      try {
        const solarResponse = normalizeSolarStatus(
          await apiClient.getJson<Record<string, unknown> | { solarIrradiance?: Record<string, unknown> }>("/solar/status"),
        );
        console.log(formatSolarIrradiance(solarResponse.solarIrradiance));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  program
    .command("unregister")
    .description("Unregister this Habitat CLI from Kepler.")
    .action(async () => {
      try {
        clearLocalHabitatState();
        clearPowerHistory();
        console.log("Habitat unregistered.");
      } catch (error) {
        console.error(formatApiError(error));
        process.exitCode = 1;
      }
    });

  const moduleCommand = program.command("module").description("Manage local Habitat modules.");
  const blueprintCommand = program.command("blueprint").description("Inspect the official Kepler blueprint catalog.");
  const resourceCommand = program.command("resource").description("Inspect the official Kepler resource catalog.");
  const inventoryCommand = program.command("inventory").description("Manage local habitat inventory.");
  const humanCommand = program.command("human").description("Inspect local Habitat humans.");
  const evaCommand = program.command("eva").description("Manage local EVA exploration.");

  evaCommand.command("status").description("Show EVA status.").action(async () => {
    try { console.log(JSON.stringify(await apiClient.getJson("/eva/status"), null, 2)); }
    catch (error) { console.error((error as Error).message); process.exitCode = 1; }
  });
  evaCommand.command("deploy").description("Deploy a human through the basic suitport.").argument("<human-id>", "human id").action(async (humanId: string) => {
    try { console.log(JSON.stringify((await apiClient.postJson(`/eva/deploy`, { humanId })), null, 2)); }
    catch (error) { console.error((error as Error).message); process.exitCode = 1; }
  });
  evaCommand.command("move").description("Move the deployed explorer.").argument("<x>", "x coordinate").argument("<y>", "y coordinate").action(async (x: string, y: string) => {
    try { console.log(JSON.stringify((await apiClient.postJson(`/eva/move`, { x: Number(x), y: Number(y) })), null, 2)); }
    catch (error) { console.error((error as Error).message); process.exitCode = 1; }
  });
  evaCommand.command("dock").description("Return the explorer through the basic suitport.").action(async () => {
    try { console.log(JSON.stringify((await apiClient.postJson(`/eva/dock`)), null, 2)); }
    catch (error) { console.error((error as Error).message); process.exitCode = 1; }
  });

  humanCommand
    .command("list")
    .description("List local Habitat humans.")
    .action(() => {
      try {
        console.log(formatHumanList(listHumans()));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  humanCommand
    .command("move")
    .description("Move a human to a local Habitat module.")
    .argument("<human-id>", "human id")
    .argument("<module-id>", "destination module id")
    .action(async (humanId: string, moduleId: string) => {
      try {
        const result = await apiClient.postJson<{ human: { displayName: string }; moduleSelector?: string }>(`/humans/${encodeURIComponent(humanId)}/move`, { moduleId });
        console.log(`${result.human.displayName} moved to ${result.moduleSelector ?? moduleId}.`);
      } catch (error) {
        console.error(formatRecentCommandError(error, "Human move"));
        process.exitCode = 1;
      }
    });
  const constructionCommand = program.command("construction").description("Inspect local module construction.");
  const constructAction = createConstructAction();
  const powerCommand = program.command("power").description("Inspect local power behavior.");

  blueprintCommand
    .command("list")
    .description("List official Kepler blueprints.")
    .action(async () => {
      try {
        const blueprints = (
          await apiClient.getJson<{ blueprints: KeplerCatalogBlueprint[] }>("/catalog/blueprints")
        ).blueprints;
        console.log(formatBlueprintList(blueprints));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  blueprintCommand
    .command("show")
    .description("Show an official Kepler blueprint.")
    .argument("<blueprintId>", "blueprint id")
    .action(async (blueprintId: string) => {
      try {
        const blueprint = (
          await apiClient.getJson<{ blueprint: KeplerCatalogBlueprint | null }>(
            `/catalog/blueprints/${encodeURIComponent(blueprintId)}`,
          )
        ).blueprint;

        if (!blueprint) {
          console.error(`Blueprint not found in the Kepler catalog: ${blueprintId}`);
          process.exitCode = 1;
          return;
        }

        console.log(formatBlueprintSummary(blueprint));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  resourceCommand
    .command("list")
    .description("List official Kepler resources.")
    .action(async () => {
      try {
        const resources = (await apiClient.getJson<{ resources: KeplerCatalogResource[] }>("/catalog/resources")).resources;
        console.log(formatResourceList(resources));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  program
    .command("scan")
    .description("Scan for hidden resources at world coordinates.")
    .requiredOption("--x <integer>", "current x coordinate", parseIntegerOption("x"))
    .requiredOption("--y <integer>", "current y coordinate", parseIntegerOption("y"))
    .requiredOption("--strength <0-100>", "effective sensor strength", parseBoundedIntegerOption("strength", 0, 100))
    .option("--radius <0-5>", "scan radius, default 0", parseBoundedIntegerOption("radius", 0, 5), 0)
    .option("--json", "print the complete JSON response")
    .action(async (options: { x: number; y: number; strength: number; radius: number; json?: boolean }) => {
      try {
        const path = `/world/scan?x=${options.x}&y=${options.y}&strength=${options.strength}&radius=${options.radius}`;
        const response = await apiClient.getJson<Record<string, unknown>>(path);
        console.log(options.json ? JSON.stringify(response, null, 2) : formatResourceScan(response));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  inventoryCommand
    .command("list")
    .description("List local habitat inventory.")
    .action(async () => {
      try {
        console.log(formatInventoryList(loadInventoryState()));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  inventoryCommand
    .command("set")
    .description("Set a local inventory quantity.")
    .argument("<resourceId>", "resource id")
    .argument("<quantity>", "inventory quantity", (value) => parsePositiveNumber(value, "quantity"))
    .option("--name <displayName>", "resource display name")
    .option("--unit <unit>", "resource unit")
    .option("--category <category>", "resource category")
    .action(async (
      resourceId: string,
      quantity: number,
      options: {
        name?: string;
        unit?: string;
        category?: string;
      },
    ) => {
        try {
          const item = setInventoryQuantity({
            resourceId: parseNonEmptyString(resourceId, "resource id"),
            quantity,
            displayName: options.name,
            unit: options.unit,
            category: options.category,
          });
          console.log(`Inventory set: ${item.resourceId} = ${item.quantity}${item.unit ? ` ${item.unit}` : ""}.`);
        } catch (error) {
          console.error((error as Error).message);
          process.exitCode = 1;
        }
    },
    );

  constructionCommand
    .command("status")
    .description("Show construction progress.")
    .action(() => {
      try {
        const state = loadConstructionState();
        console.log(formatConstructionStatus(state.activeJob));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  constructionCommand
    .command("cancel")
    .description("Cancel an in-progress construction job.")
    .argument("[selector]", "module selector")
    .action((selector: string | undefined) => {
      try {
        const registration = loadStateOrFail();
        const currentConstruction = loadConstructionState();
        const activeJob = currentConstruction.activeJob;
        const resolvedSelector =
          selector ??
          (activeJob?.fabricatorSelector || activeJob?.fabricatorId || activeJob?.selector || undefined);

        if (!resolvedSelector) {
          console.error("No active construction job to cancel.");
          process.exitCode = 1;
          return;
        }

        const resolvedModule = registration.modules.find((module) => module.selector === resolvedSelector || module.id === resolvedSelector) ?? null;

        if (resolvedModule && activeJob && resolvedModule.blueprintId === "workshop-fabricator") {
          saveConstructionState({ activeJob: null });
          console.log(`Construction canceled: ${resolvedSelector}.`);
          return;
        }

        const result = cancelConstruction(resolvedSelector);

        if (!result.canceledJob) {
          console.error(`No active construction job matches ${resolvedSelector}.`);
          process.exitCode = 1;
          return;
        }

        console.log(`Construction canceled: ${resolvedSelector}.`);
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  inventoryCommand
    .command("add")
    .description("Add to a local inventory quantity.")
    .argument("<resourceId>", "resource id")
    .argument("<amount>", "amount to add", (value) => parsePositiveNumber(value, "amount"))
    .option("--name <displayName>", "resource display name")
    .option("--unit <unit>", "resource unit")
    .option("--category <category>", "resource category")
    .action(async (
      resourceId: string,
      amount: number,
      options: {
        name?: string;
        unit?: string;
        category?: string;
      },
    ) => {
        try {
          const item = addInventoryQuantity({
            resourceId: parseNonEmptyString(resourceId, "resource id"),
            amount,
            displayName: options.name,
            unit: options.unit,
            category: options.category,
          });
          console.log(`Inventory added: ${item.resourceId} = ${item.quantity}${item.unit ? ` ${item.unit}` : ""}.`);
        } catch (error) {
          console.error((error as Error).message);
          process.exitCode = 1;
        }
    },
    );

  moduleCommand
    .command("construct")
    .description("Start constructing a local module from a blueprint.")
    .argument("<blueprintId>", "blueprint id")
    .option("--dry-run", "validate requirements without changing state")
    .action(constructAction);

  program
    .command("construct")
    .description("Start constructing a local module from a blueprint.")
    .argument("<blueprintId>", "blueprint id")
    .option("--dry-run", "validate requirements without changing state")
    .action(constructAction);

  moduleCommand
    .command("status")
    .description("Show module power states and current draw.")
    .action(() => {
      try {
        const registration = loadStateOrFail();
        if (registration.modules.length === 0) {
          console.log("No modules found.");
          return;
        }

        const rows = buildModuleStatusRows(registration);
        console.log(renderTextTable(["Module", "Declared State", "Effective State", "Power Draw"], rows));
        console.log(
          `Total current power draw: ${formatPowerDraw(sumModulePowerDraw(registration))} kW; one tick energy cost: ${formatEnergyCost(powerDrawToEnergyCost(sumModulePowerDraw(registration), 1))} kWh.`,
        );
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  powerCommand
    .command("overview")
    .description("Show the current power sources and sinks.")
    .action(async () => {
      try {
        const registration = loadStateOrFail();
        const solarResponse = normalizeSolarStatus(
          await apiClient.getJson<Record<string, unknown> | { solarIrradiance?: Record<string, unknown> }>("/solar/status"),
        );
        console.log(formatPowerOverview(registration, solarResponse.solarIrradiance));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  moduleCommand
    .command("set-status")
    .description("Set a local module runtime status.")
    .argument("<moduleId>", "module id")
    .argument("<status>", "offline, idle, online, active, or damaged")
    .action(async (moduleId: string, status: string) => {
      try {
        const registration = loadStateOrFail();
        const module = resolveModule(registration, moduleId);
        const nextRegistration = setModuleStatus(registration, module.id, parseModuleStatus(status));
        const nextModule = nextRegistration.modules.find((entry) => entry.id === module.id)!;
        saveState(nextRegistration);
        console.log(
          `Module ${nextModule.selector} status set to ${getDeclaredModuleStatus(nextModule)}; current power draw ${formatPowerDraw(getModulePowerDraw(nextModule))} kW.`,
        );
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  moduleCommand
    .command("create")
    .description("Create a local module record.")
    .argument("<name>", "module name")
    .option("--blueprint-id <blueprintId>", "source blueprint id")
    .option("--connected-to <moduleId>", "module id to connect to", collectOption, [])
    .option("--runtime-attribute <key=value>", "runtime attribute to set", collectOption, [])
    .option("--capability <capability>", "capability to add", collectOption, [])
    .action(
      async (
        name: string,
        options: {
          blueprintId?: string;
          connectedTo: string[];
          runtimeAttribute: string[];
          capability: string[];
        },
      ) => {
        try {
          const registration = loadStateOrFail();
          const module = ensureDefaultModuleRuntimeStatus({
            id: randomUUID(),
            selector: makeUniqueSelector(randomUUID(), registration.modules),
            blueprintId: options.blueprintId ?? "custom-module",
            displayName: parseNonEmptyString(name, "Module name"),
            connectedTo: options.connectedTo,
            runtimeAttributes: options.runtimeAttribute.length > 0 ? parseKeyValuePairs(options.runtimeAttribute, "runtime attribute") : {},
            capabilities: options.capability,
          });
          saveState({
            ...registration,
            modules: [...registration.modules, module],
          });
          console.log(`Module created: ${module.displayName}`);
        } catch (error) {
          console.error((error as Error).message);
          process.exitCode = 1;
        }
      },
    );

  moduleCommand
    .command("list")
    .description("List local modules.")
    .action(async () => {
      try {
        const registration = loadStateOrFail();
        if (registration.modules.length === 0) {
          console.log("No modules found.");
          return;
        }

        for (const module of registration.modules) {
          console.log(module.selector);
        }
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  moduleCommand
    .command("show")
    .description("Show a local module.")
    .argument("<selector>", "module selector or id")
    .action(async (selector: string) => {
      try {
        const registration = loadStateOrFail();
        const module = resolveModule(registration, selector);
        console.log(formatModuleDetails(module, loadConstructionState().activeJob));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  moduleCommand
    .command("update")
    .description("Update a local module.")
    .argument("<selector>", "module selector or id")
    .option("--name <name>", "new module name")
    .option("--blueprint-id <blueprintId>", "new blueprint id")
    .option("--connected-to <moduleId>", "module id to connect to", collectOption, [])
    .option("--runtime-attribute <key=value>", "runtime attribute to set", collectOption, [])
    .option("--capability <capability>", "capability to replace", collectOption, [])
    .action(
      async (
        selector: string,
        options: {
          name?: string;
          blueprintId?: string;
          connectedTo: string[];
          runtimeAttribute: string[];
          capability: string[];
        },
      ) => {
        try {
          const registration = loadStateOrFail();
          const currentModule = resolveModule(registration, selector);
          const nextModule: HabitatModule = {
            ...currentModule,
            displayName: options.name?.trim() || currentModule.displayName,
            blueprintId: options.blueprintId ?? currentModule.blueprintId,
            connectedTo: options.connectedTo.length > 0 ? options.connectedTo : currentModule.connectedTo,
            runtimeAttributes:
              options.runtimeAttribute.length > 0 ? parseKeyValuePairs(options.runtimeAttribute, "runtime attribute") : currentModule.runtimeAttributes,
            capabilities: options.capability.length > 0 ? options.capability : currentModule.capabilities,
          };
          saveState({
            ...registration,
            modules: registration.modules.map((module) => (module.id === currentModule.id ? nextModule : module)),
          });
          console.log(`Module updated: ${nextModule.displayName}`);
        } catch (error) {
          console.error((error as Error).message);
          process.exitCode = 1;
        }
      },
    );

  moduleCommand
    .command("delete")
    .description("Delete a local module.")
    .argument("<selector>", "module selector or id")
    .action(async (selector: string) => {
      try {
        const registration = loadStateOrFail();
        const currentModule = resolveModule(registration, selector);
        assertModuleCanBeDeleted(currentModule.id);
        saveState({
          ...registration,
          modules: registration.modules.filter((module) => module.id !== currentModule.id),
        });
        console.log(`Module deleted: ${selector}`);
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  program.on("command:*", ([commandName]) => {
    console.error(`Unknown command: ${commandName}`);
    console.error("Try `habitat --help` to see the available commands.");
    process.exitCode = 1;
  });

  return program;
}

async function registerWithKepler(displayName: string): Promise<KeplerRegistration> {
  const keplerBaseUrl = process.env.KEPLER_BASE_URL ?? "https://planet.turingguild.com";
  const keplerPlanetToken = process.env.KEPLER_PLANET_TOKEN ?? "";

  const habitatUuid = randomUUID();
  const response = await fetch(`${keplerBaseUrl}/habitats/register`, {
    method: "POST",
    headers: {
      ...(keplerPlanetToken ? { Authorization: `Bearer ${keplerPlanetToken}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      habitatUuid,
      displayName,
    }),
  });

  if (!response.ok) {
    throw new Error(`Kepler registration failed with ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as KeplerRegistrationResponse;

  const habitat = await fetchKeplerHabitatStatus(payload.habitatId).catch(() => ({
    id: payload.habitatId,
    habitatSlug: displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    displayName,
    catalogVersion: "unknown",
    status: "registered",
    lastSeenAt: null,
  }));

  return {
    habitatId: payload.habitatId,
    habitatUuid,
    displayName,
    streamUrl: payload.streamUrl ?? "wss://planet.turingguild.com/planet/stream",
    apiToken: payload.apiToken ?? "",
    stream:
      payload.stream ?? {
        protocolVersion: "1.0",
        subscriptions: ["ticks"],
        currentTick: 0,
        tickIntervalMs: 1000,
        ticksPerPulse: 1,
        status: "paused",
      },
    contracts: payload.contracts ?? {
      alerts: {
        schemaVersion: "1.0",
        schema: {},
      },
    },
    habitat,
    modules: payload.starterModules.map((starterModule, index) =>
      ensureDefaultModuleRuntimeStatus({
        id: starterModule.id,
        selector: getStarterModuleSelector(starterModule, index, payload.starterModules),
        blueprintId: starterModule.blueprintId,
        displayName: starterModule.displayName,
        connectedTo: starterModule.connectedTo,
        runtimeAttributes: {
          ...starterModule.runtimeAttributes,
          ...(starterModule.capabilities.includes("power-storage") ? { status: "online" } : {}),
        },
        capabilities: starterModule.capabilities,
      }),
    ),
    blueprints: payload.blueprints.map((blueprint) => ({
      blueprintId: blueprint.blueprintId,
      displayName: blueprint.displayName,
      description: blueprint.description ?? "",
      output: blueprint.output,
      inputs: blueprint.inputs,
      productionCost: blueprint.productionCost ?? {},
      requiredFacility: blueprint.requiredFacility ?? {},
      buildTicks: blueprint.buildTicks,
      prerequisites: blueprint.prerequisites ?? [],
      unlocks: blueprint.unlocks ?? [],
      repeatable: blueprint.repeatable ?? false,
      level: blueprint.level ?? null,
      target: blueprint.target ?? {},
      facilityLevel: blueprint.facilityLevel ?? {},
      attachmentPoints: blueprint.attachmentPoints ?? {},
      attachmentRequirements: blueprint.attachmentRequirements ?? [],
      runtimeAttributes: blueprint.runtimeAttributes ?? {},
        capabilities: blueprint.capabilities ?? [],
      })),
    humans: (payload.starterHumans ?? []).map((human) => ({
      id: human.id,
      displayName: human.displayName,
      locationModuleId: human.locationModuleId,
      status: "present",
    })),
    alerts: [],
  };
}

async function fetchKeplerHabitatStatus(habitatId: string): Promise<KeplerRegistration["habitat"]> {
  const keplerBaseUrl = process.env.KEPLER_BASE_URL ?? "https://planet.turingguild.com";
  const keplerPlanetToken = process.env.KEPLER_PLANET_TOKEN ?? "";

  const response = await fetch(`${keplerBaseUrl}/habitats/${habitatId}`, {
    headers: {
      ...(keplerPlanetToken ? { Authorization: `Bearer ${keplerPlanetToken}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Kepler habitat status failed with ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { habitat: KeplerRegistration["habitat"] };
  return payload.habitat;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseNonEmptyString(value: string, fieldName: string): string {
  if (!value.trim()) {
    throw new InvalidArgumentError(`${fieldName} must not be empty.`);
  }

  return value;
}

function parsePositiveNumber(value: string, fieldName: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError(`${fieldName} must be a non-negative number.`);
  }

  return parsed;
}

function parseIntegerOption(fieldName: string) {
  return (value: string): number => {
    if (!/^-?\d+$/.test(value)) {
      throw new InvalidArgumentError(`${fieldName} must be an integer.`);
    }
    return Number(value);
  };
}

function parseBoundedIntegerOption(fieldName: string, minimum: number, maximum: number) {
  return (value: string): number => {
    const parsed = parseIntegerOption(fieldName)(value);
    if (parsed < minimum || parsed > maximum) {
      throw new InvalidArgumentError(`${fieldName} must be an integer from ${minimum} through ${maximum}.`);
    }
    return parsed;
  };
}

function parseModuleStatus(value: string): "offline" | "idle" | "online" | "active" | "damaged" {
  if (
    value === "offline" ||
    value === "idle" ||
    value === "online" ||
    value === "active" ||
    value === "damaged"
  ) {
    return value;
  }

  throw new InvalidArgumentError("Status must be offline, idle, online, active, or damaged.");
}

function parseKeyValuePairs(values: string[], label: string): Record<string, unknown> {
  return values.reduce<Record<string, unknown>>((accumulator, value) => {
    const [key, rawValue] = value.split("=", 2);

    if (!key || rawValue === undefined) {
      throw new InvalidArgumentError(`Each ${label} must be in key=value format.`);
    }

    accumulator[key] = rawValue;
    return accumulator;
  }, {});
}

function parseTickUnit(value: string | undefined): number {
  if (!value || value === "second" || value === "seconds") {
    return 1;
  }

  if (value === "hour") {
    return 3600;
  }

  throw new InvalidArgumentError("Tick unit must be seconds or hours.");
}

function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return (error as Error).message;
}

function formatRecentCommandError(error: unknown, action: string): string {
  if (error instanceof ApiError && error.status === 404 && /^404\s+not found\.?$/i.test(error.message)) {
    return `${action} failed: the local Habitat API does not expose this route. Restart the Habitat API and try again.`;
  }

  return formatApiError(error);
}

function normalizeSolarStatus(payload: Record<string, unknown>): { solarIrradiance: { wPerM2: number; [key: string]: unknown } } {
  if ("solarIrradiance" in payload && payload.solarIrradiance && typeof payload.solarIrradiance === "object") {
    return {
      solarIrradiance: payload.solarIrradiance as { wPerM2: number; [key: string]: unknown },
    };
  }

  return {
    solarIrradiance: payload as { wPerM2: number; [key: string]: unknown },
  };
}

function resolveModule(registration: KeplerRegistration, selector: string): HabitatModule {
  const exactMatches = registration.modules.filter(
    (module) => module.id === selector || module.selector === selector || module.blueprintId === selector,
  );

  if (exactMatches.length > 0) {
    return exactMatches[0];
  }

  const matches = registration.modules.filter(
    (module) =>
      module.id.startsWith(selector) || module.selector.startsWith(selector) || module.blueprintId.startsWith(selector),
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new Error(
      `Module selector is ambiguous: ${selector}. Matches: ${matches
        .map((module) => `${module.selector} (${module.id})`)
        .join(", ")}`,
    );
  }

  throw new Error(`Module not found: ${selector}`);
}

function resolveModuleIds(registration: KeplerRegistration, selectors: string[]): string[] {
  return selectors.map((selector) => resolveModule(registration, selector).id);
}

function requireBlueprint(registration: KeplerRegistration, blueprintId: string): HabitatBlueprint {
  const blueprint = registration.blueprints.find((candidate) => candidate.blueprintId === blueprintId);

  if (!blueprint) {
    throw new Error(`Blueprint not found: ${blueprintId}`);
  }

  return blueprint;
}

function deriveSelector(identifier: string): string {
  const rawParts = identifier.toLowerCase().split("_");
  const body = rawParts[0] === "habitat" && rawParts.length > 6 ? rawParts.slice(6).join("_") : identifier.toLowerCase();
  const normalized = body
    .replace(/_[0-9]+$/, "-1")
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    return "module";
  }

  return normalized;
}

function getStarterModuleSelector(
  starterModule: KeplerStarterModule,
  index: number,
  starterModules: KeplerStarterModule[],
): string {
  const base = deriveSelector(starterModule.blueprintId);
  const occurrence = starterModules.slice(0, index + 1).filter((module) => module.blueprintId === starterModule.blueprintId).length;
  return `${base}-${occurrence}`;
}

function makeUniqueSelector(identifier: string, modules: HabitatModule[], currentId?: string): string {
  const baseSelector = deriveSelector(identifier);
  const takenSelectors = new Set(
    modules
      .filter((module) => module.id !== currentId)
      .map((module) => module.selector),
  );

  if (!takenSelectors.has(baseSelector)) {
    return baseSelector;
  }

  const match = baseSelector.match(/^(.*)-(\d+)$/);
  const selectorRoot = match?.[1] ?? baseSelector;
  let suffix = match ? Number(match[2]) + 1 : 2;
  while (takenSelectors.has(`${selectorRoot}-${suffix}`)) {
    suffix += 1;
  }

  return `${selectorRoot}-${suffix}`;
}

export function createConstructedModule(registration: KeplerRegistration, job: import("./types.js").HabitatConstructionJob): HabitatModule {
  const existingModuleCount = registration.modules.filter((module) => module.blueprintId === job.blueprintId).length;
  const nextNumber = existingModuleCount + 1;
  const identifier = `${registration.habitatId}_${job.moduleType}_${nextNumber}`;
  const selectorSeed = `${job.moduleType}_${nextNumber}`;

  return ensureDefaultModuleRuntimeStatus({
    id: identifier,
    selector: makeUniqueSelector(selectorSeed, registration.modules),
    blueprintId: job.blueprintId,
    displayName: job.pendingModuleName,
    connectedTo: job.connectedTo,
    runtimeAttributes: job.runtimeAttributes,
    capabilities: job.capabilities,
  });
}

function stripBlueprintSuffix(displayName: string): string {
  return displayName.replace(/\s+Blueprint$/, "").trim() || displayName;
}

function createConstructAction(): (blueprintId: string, options: { dryRun?: boolean }) => void {
  return (blueprintId: string, options: { dryRun?: boolean }) => {
    try {
      const registration = loadStateOrFail();
      ensureHabitatIsConnected(registration);
      const blueprint = requireBlueprint(registration, blueprintId);
      const result = startConstruction({
        blueprint,
        modules: registration.modules,
        dryRun: options.dryRun ?? false,
      });
      const readinessReport = formatConstructionReadinessReport(result.report);

      if (options.dryRun) {
        console.log(readinessReport);
        return;
      }

      if (!result.report.canStart) {
        console.log(readinessReport);
        process.exitCode = 1;
        return;
      }

      if (!result.startedJob) {
        throw new Error("Construction did not start.");
      }

      if (result.startedJob.ticksRemaining === 0) {
        const completedModule = createConstructedModule(registration, result.startedJob);
        saveState({
          ...registration,
          modules: [...registration.modules, completedModule],
        });
        advanceConstruction(0);
        console.log(`Construction completed immediately: ${completedModule.displayName} (${completedModule.selector}).`);
        return;
      }

      console.log(
        `Construction started for ${result.startedJob.pendingModuleName}. Consumed ${result.startedJob.consumedInputs
          .map((input) => `${input.resourceId}: ${input.amount}`)
          .join(", ") || "no resources"}. ${result.startedJob.ticksRemaining} tick(s) remaining.`,
      );
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  };
}

function ensureHabitatIsConnected(registration: KeplerRegistration): void {
  const commandModule = registration.modules.find((module) => module.blueprintId === "command-module");

  if (!commandModule) {
    throw new Error("Habitat is not connected. The command module is missing.");
  }

  const status = getDeclaredModuleStatus(commandModule);

  if (status !== "online" && status !== "active") {
    throw new Error("Habitat is not connected. The command module is offline.");
  }
}
