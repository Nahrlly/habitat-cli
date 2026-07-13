import { randomUUID } from "node:crypto";
import { Command, InvalidArgumentError } from "commander";
import { advanceConstruction, loadConstructionState, saveConstructionState, startConstruction } from "./construction-state.js";
import { createKeplerCatalogClient, type KeplerCatalogBlueprint, type KeplerCatalogClient, type KeplerCatalogResource, type KeplerSolarIrradiance } from "./kepler-catalog.js";
import { fetchApiJson, fetchApiJsonOrNull, getApiBaseUrl, postApiJson } from "./api-client.js";
import { ensureDefaultModuleRuntimeStatus, loadKeplerRegistration, loadStateOrFail, saveState, clearLocalHabitatState } from "./state.js";
import { loadInventoryState } from "./inventory-state.js";
import {
  buildModuleStatusRows,
  formatConstructionReadinessReport,
  formatConstructionProgress,
  formatConstructionStatus,
  formatBlueprintList,
  formatBlueprintSummary,
  formatEnergyCost,
  formatInventoryList,
  formatModuleDetails,
  formatModuleSummary,
  formatPowerDraw,
  formatPowerOverview,
  formatResourceList,
  formatSolarIrradiance,
  getDeclaredModuleStatus,
  getModulePowerDraw,
  powerDrawToEnergyCost,
  renderTextTable,
  sumModulePowerDraw,
} from "./formatters.js";
import type {
  HabitatConstructionJob,
  HabitatConstructionState,
  HabitatInventoryItem,
  HabitatInventoryState,
  HabitatModule,
  HabitatBlueprint,
  KeplerBlueprint,
  KeplerStarterModule,
  KeplerRegistration,
} from "./types.js";

const apiClient = { getJson: fetchApiJson, postJson: postApiJson };
let keplerBaseUrl = "";
let keplerPlanetToken = "";
let keplerCatalogClient: KeplerCatalogClient | null = null;

type TickResponse = {
  tickCount: number;
  secondsPerTick: number;
  totalPowerDraw: number;
  totalSolarGeneration: number;
  batteryBefore: number;
  batteryAfter: number;
  solarChargeReason: string | null;
  activeConstructionJob: { pendingModuleName: string; ticksRemaining: number; ticksRequired: number } | null;
  completedModule: { displayName: string; selector: string } | null;
};

type ConstructionCancelResponse = {
  canceledJob: HabitatConstructionJob;
};

type ConstructionStatusResponse = {
  construction: HabitatConstructionState;
};

type PowerOverviewResponse = {
  registration: KeplerRegistration | null;
  solarIrradiance: { wPerM2: number; [key: string]: unknown };
};

export function createProgram(): Command {
  const program = new Command();
  keplerBaseUrl = process.env.KEPLER_BASE_URL ?? "";
  keplerPlanetToken = process.env.KEPLER_PLANET_TOKEN ?? "";
  keplerCatalogClient = null;
  program.name("habitat").description("Register this Habitat CLI with Kepler and inspect its status.").version("0.1.0");

  program
    .command("register")
    .description("Register this Habitat CLI with Kepler.")
    .requiredOption("--name <name>", "habitat name")
    .action(async (options: { name: string }) => {
      try {
        await postApiJson<{ registration: KeplerRegistration }>("/commands/register", { name: options.name });

        console.log(`Registered habitat ${options.name}.`);
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  program
    .command("status")
    .description("Show the current Kepler registration status.")
    .action(async () => {
      try {
        const registration = await loadRegistrationForRead();

        if (!registration) {
          console.log("Habitat is not registered with Kepler.");
          return;
        }

        const habitat = registration.habitat;

        console.log(`Habitat "${habitat.displayName}" is registered with Kepler.`);
        console.log(`Habitat ID: ${habitat.id}`);
        console.log(`Habitat slug: ${habitat.habitatSlug}`);
        console.log(`Kepler catalog version: ${habitat.catalogVersion}`);
        console.log(`Kepler status: ${habitat.status}`);
        console.log(`Last seen at: ${habitat.lastSeenAt ?? "unknown"}`);
        console.log(`Modules created: ${formatModuleSummary(registration)}`);
      } catch (error) {
        console.error((error as Error).message);
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
        const tickCount = Math.floor(options.ticks);
        const secondsPerTick = parseTickUnit(unit);

        if (tickCount <= 0) {
          throw new Error("ticks must be greater than zero.");
        }

        const result = await postApiJson<TickResponse>("/commands/tick", {
          ticks: tickCount,
          unit: unit ?? "seconds",
        });

        console.log(`Advanced ${result.tickCount} tick(s) at ${result.secondsPerTick} second(s) per tick.`);
        console.log(`Total power draw: ${formatEnergyCost(result.totalPowerDraw)} kWh.`);
        console.log(`Total solar generation: ${formatEnergyCost(result.totalSolarGeneration)} kWh.`);
        console.log(`Battery charge: ${result.batteryBefore} kWh -> ${result.batteryAfter} kWh.`);
        if (result.solarChargeReason) {
          console.log(result.solarChargeReason);
        }
        if (result.activeConstructionJob) {
          console.log(
            `Construction: ${result.activeConstructionJob.pendingModuleName} ${result.activeConstructionJob.ticksRemaining}/${result.activeConstructionJob.ticksRequired} ticks remaining.`,
          );
        }
        if (result.completedModule) {
          console.log(`Construction completed: ${result.completedModule.displayName} (${result.completedModule.selector}).`);
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
        const solarIrradiance = await loadSolarIrradianceForRead();
        console.log(formatSolarIrradiance(solarIrradiance));
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
        const result = await postApiJson<{ displayName: string }>("/commands/unregister", {});
        console.log(`Unregistered habitat ${result.displayName}.`);
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  const moduleCommand = program.command("module").description("Manage local Habitat modules.");
  const blueprintCommand = program.command("blueprint").description("Inspect the official Kepler blueprint catalog.");
  const resourceCommand = program.command("resource").description("Inspect the official Kepler resource catalog.");
  const inventoryCommand = program.command("inventory").description("Manage local habitat inventory.");
  const constructionCommand = program.command("construction").description("Inspect local module construction.");
  const constructAction = createConstructAction();
  const powerCommand = program.command("power").description("Inspect local power behavior.");

  blueprintCommand
    .command("list")
    .description("List official Kepler blueprints.")
    .action(async () => {
      try {
        const blueprints = await listBlueprintsForRead();
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
        const blueprint = await getBlueprintForRead(blueprintId);

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
        const resources = await listResourcesForRead();
        console.log(formatResourceList(resources));
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
        console.log(formatInventoryList(await loadInventoryForRead()));
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
          const item = (
            await apiClient.postJson<{ item: HabitatInventoryItem }>("/inventory/set", {
              resourceId: parseNonEmptyString(resourceId, "resource id"),
              quantity,
              displayName: options.name,
              unit: options.unit,
              category: options.category,
            })
          ).item;
          console.log(`Inventory set: ${item.resourceId} = ${item.quantity}${item.unit ? ` ${item.unit}` : ""}.`);
        } catch (error) {
          console.error((error as Error).message);
          process.exitCode = 1;
        }
    });

  constructionCommand
    .command("status")
    .description("Show construction progress.")
    .action(async () => {
      try {
        const state = await apiClient.getJson<ConstructionStatusResponse>("/construction");
        console.log(formatConstructionStatus(state.construction.activeJob));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  constructionCommand
    .command("cancel")
    .description("Cancel an in-progress construction job.")
    .argument("[selector]", "module selector")
    .action(async (selector: string | undefined) => {
      try {
        const result = await apiClient.postJson<ConstructionCancelResponse>("/commands/construction/cancel", { selector });
        console.log(`Construction canceled: ${result.canceledJob.selector}.`);
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
          const item = (
            await apiClient.postJson<{ item: HabitatInventoryItem }>("/inventory/add", {
              resourceId: parseNonEmptyString(resourceId, "resource id"),
              amount,
              displayName: options.name,
              unit: options.unit,
              category: options.category,
            })
          ).item;
          console.log(`Inventory added: ${item.resourceId} = ${item.quantity}${item.unit ? ` ${item.unit}` : ""}.`);
        } catch (error) {
          console.error((error as Error).message);
          process.exitCode = 1;
        }
    });

  moduleCommand
    .command("construct")
    .description("Start constructing a local module from a blueprint.")
    .argument("<blueprintId>", "blueprint id")
    .option("--dry-run", "validate requirements without changing state")
    .action(createConstructAction());

  program
    .command("construct")
    .description("Start constructing a local module from a blueprint.")
    .argument("<blueprintId>", "blueprint id")
    .option("--dry-run", "validate requirements without changing state")
    .action(createConstructAction());

  moduleCommand
    .command("status")
    .description("Show module power states and current draw.")
    .action(async () => {
      try {
        const registration = await apiClient.getJson<{ modules: HabitatModule[] }>("/modules");
        if (registration.modules.length === 0) {
          console.log("No modules found.");
          return;
        }

        const moduleState = { modules: registration.modules } as KeplerRegistration;
        const rows = buildModuleStatusRows(moduleState);
        console.log(renderTextTable(["Module", "Declared State", "Effective State", "Power Draw"], rows));
        console.log(
          `Total current power draw: ${formatPowerDraw(sumModulePowerDraw(moduleState))} kW; one tick energy cost: ${formatEnergyCost(powerDrawToEnergyCost(sumModulePowerDraw(moduleState), 1))} kWh.`,
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
        const response = await apiClient.getJson<PowerOverviewResponse>("/power/overview");
        if (!response.registration) {
          throw new Error("Habitat is not registered with Kepler.");
        }
        console.log(formatPowerOverview(response.registration, response.solarIrradiance));
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
        const result = await postApiJson<{
            selector: string;
            status: "offline" | "idle" | "online" | "active" | "damaged";
            powerDrawKw: number;
          }>("/commands/module/set-status", {
            moduleId,
            status,
          });

          console.log(
            `Module ${result.selector} status set to ${result.status}; current power draw ${formatPowerDraw(result.powerDrawKw)} kW.`,
          );
        console.log(
          `Module ${result.selector} status set to ${result.status}; current power draw ${formatPowerDraw(result.powerDrawKw)} kW.`,
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
    .action(async (
      name: string,
      options: {
        blueprintId?: string;
        connectedTo: string[];
        runtimeAttribute: string[];
        capability: string[];
      },
    ) => {
        try {
          const result = await postApiJson<{ module: HabitatModule }>("/commands/module/create", {
              name,
              blueprintId: options.blueprintId,
              connectedTo: options.connectedTo,
              runtimeAttribute: options.runtimeAttribute,
              capability: options.capability,
            });

          console.log(`Module created: ${result.module.displayName}`);
        } catch (error) {
          console.error((error as Error).message);
          process.exitCode = 1;
        }
    });

  moduleCommand
    .command("list")
    .description("List local modules.")
    .action(async () => {
      try {
        const registration = await loadRegistrationForReadOrFail();
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
        const registration = await loadRegistrationForReadOrFail();
        const constructionState = await loadConstructionForRead();
        console.log(formatModuleDetails(resolveModule(registration, selector), constructionState.activeJob));
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
    .action(async (
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
          if (getApiBaseUrl()) {
            const result = await postApiJson<{ module: HabitatModule }>("/commands/module/update", {
              selector,
              name: options.name,
              blueprintId: options.blueprintId,
              connectedTo: options.connectedTo,
              runtimeAttribute: options.runtimeAttribute,
              capability: options.capability,
            });

            console.log(`Module updated: ${result.module.displayName}`);
            return;
          }

          const registration = loadStateOrFail();
          const currentModule = resolveModule(registration, selector);

          if (options.blueprintId) {
            requireBlueprint(registration, options.blueprintId);
          }

          const nextModule: HabitatModule = {
            ...currentModule,
            selector: currentModule.selector,
            displayName: options.name ? parseNonEmptyString(options.name, "Module name") : currentModule.displayName,
            blueprintId: options.blueprintId ?? currentModule.blueprintId,
            connectedTo:
              options.connectedTo.length > 0 ? resolveModuleIds(registration, options.connectedTo) : currentModule.connectedTo,
            runtimeAttributes:
              options.runtimeAttribute.length > 0
                ? parseKeyValuePairs(options.runtimeAttribute, "runtime attribute")
                : currentModule.runtimeAttributes,
            capabilities:
              options.capability.length > 0 ? options.capability : currentModule.capabilities,
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
    });

  moduleCommand
    .command("delete")
    .description("Delete a local module.")
    .argument("<selector>", "module selector or id")
    .action(async (selector: string) => {
      try {
        if (getApiBaseUrl()) {
          const result = await postApiJson<{ module: HabitatModule }>("/commands/module/delete", { selector });
          console.log(`Module deleted: ${result.module.selector}`);
          return;
        }

        const registration = loadStateOrFail();
        const currentModule = resolveModule(registration, selector);

        saveState({
          ...registration,
          modules: registration.modules.filter((module) => module.id !== currentModule.id),
        });

        console.log(`Module deleted: ${currentModule.selector}`);
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
  const habitatUuid = randomUUID();
  const response = await fetch(`${keplerBaseUrl}/habitats/register`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${keplerPlanetToken}`,
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

  const payload = (await response.json()) as {
    habitatId: string;
    starterModules: KeplerStarterModule[];
    blueprints: KeplerBlueprint[];
  };

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
    habitat,
    modules: payload.starterModules.map((starterModule) =>
      ensureDefaultModuleRuntimeStatus({
        id: starterModule.id,
        selector: makeUniqueSelector(
          starterModule.id,
          payload.starterModules.map((module) => ({
            id: module.id,
            selector: deriveSelector(module.id),
            blueprintId: module.blueprintId,
            displayName: module.displayName,
            connectedTo: module.connectedTo,
            runtimeAttributes: module.runtimeAttributes,
            capabilities: module.capabilities,
          })),
        ),
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
  };
}

async function fetchKeplerHabitatStatus(habitatId: string): Promise<KeplerRegistration["habitat"]> {
  const response = await fetch(`${keplerBaseUrl}/habitats/${habitatId}`, {
    headers: {
      Authorization: `Bearer ${keplerPlanetToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Kepler habitat status failed with ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { habitat: KeplerRegistration["habitat"] };
  return payload.habitat;
}

async function unregisterFromKepler(habitatId: string): Promise<void> {
  const response = await fetch(`${keplerBaseUrl}/habitats/${habitatId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${keplerPlanetToken}`,
    },
  });

  if (response.status === 404) {
    clearLocalHabitatState();
    return;
  }

  if (!response.ok && response.status !== 204) {
    throw new Error(`Kepler unregister failed with ${response.status} ${response.statusText}`);
  }

  clearLocalHabitatState();
}

async function listBlueprints(): Promise<KeplerCatalogBlueprint[]> {
  return getKeplerCatalogClient().listBlueprints();
}

async function getBlueprint(blueprintId: string): Promise<KeplerCatalogBlueprint | null> {
  return getKeplerCatalogClient().getBlueprint(blueprintId);
}

async function listResources(): Promise<KeplerCatalogResource[]> {
  return getKeplerCatalogClient().listResources();
}

async function loadRegistrationForRead(): Promise<KeplerRegistration | null> {
  if (getApiBaseUrl()) {
    const payload = await fetchApiJsonOrNull<{ registration: KeplerRegistration }>("/registration");
    return payload?.registration ?? null;
  }

  return loadKeplerRegistration();
}

async function loadRegistrationForReadOrFail(): Promise<KeplerRegistration> {
  const registration = await loadRegistrationForRead();

  if (!registration) {
    throw new Error("Habitat is not registered with Kepler.");
  }

  return registration;
}

async function loadSolarIrradianceForRead(): Promise<KeplerSolarIrradiance> {
  if (getApiBaseUrl()) {
    const payload = await fetchApiJson<{ solarIrradiance: KeplerSolarIrradiance }>("/solar/status");
    return payload.solarIrradiance;
  }

  return getKeplerCatalogClient().getSolarIrradiance();
}

async function listBlueprintsForRead(): Promise<KeplerCatalogBlueprint[]> {
  if (getApiBaseUrl()) {
    const payload = await fetchApiJson<{ blueprints: KeplerCatalogBlueprint[] }>("/catalog/blueprints");
    return payload.blueprints;
  }

  return listBlueprints();
}

async function getBlueprintForRead(blueprintId: string): Promise<KeplerCatalogBlueprint | null> {
  if (getApiBaseUrl()) {
    const payload = await fetchApiJsonOrNull<{ blueprint: KeplerCatalogBlueprint }>(`/catalog/blueprints/${encodeURIComponent(blueprintId)}`);
    return payload?.blueprint ?? null;
  }

  return getBlueprint(blueprintId);
}

async function listResourcesForRead(): Promise<KeplerCatalogResource[]> {
  if (getApiBaseUrl()) {
    const payload = await fetchApiJson<{ resources: KeplerCatalogResource[] }>("/catalog/resources");
    return payload.resources;
  }

  return listResources();
}

async function loadInventoryForRead(): Promise<HabitatInventoryState> {
  if (getApiBaseUrl()) {
    const payload = await fetchApiJson<{ inventory: HabitatInventoryState }>("/inventory");
    return payload.inventory;
  }

  return loadInventoryState();
}

async function loadConstructionForRead(): Promise<HabitatConstructionState> {
  if (getApiBaseUrl()) {
    const payload = await fetchApiJson<{ construction: HabitatConstructionState }>("/construction");
    return payload.construction;
  }

  return loadConstructionState();
}

async function setInventoryRemote(input: {
  resourceId: string;
  quantity: number;
  displayName?: string;
  unit?: string;
  category?: string;
}): Promise<HabitatInventoryItem> {
  const payload = await postApiJson<{ item: HabitatInventoryItem }>("/commands/inventory/set", input);
  return payload.item;
}

async function addInventoryRemote(input: {
  resourceId: string;
  amount: number;
  displayName?: string;
  unit?: string;
  category?: string;
}): Promise<HabitatInventoryItem> {
  const payload = await postApiJson<{ item: HabitatInventoryItem }>("/commands/inventory/add", input);
  return payload.item;
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

function getKeplerCatalogClient(): KeplerCatalogClient {
  if (!keplerCatalogClient) {
    keplerCatalogClient = createKeplerCatalogClient(keplerBaseUrl, keplerPlanetToken);
  }

  return keplerCatalogClient;
}

function parsePositiveNumber(value: string, fieldName: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError(`${fieldName} must be a non-negative number.`);
  }

  return parsed;
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

function ensureKeplerBaseUrl(): void {
  if (!process.env.KEPLER_BASE_URL) {
    throw new Error("Missing KEPLER_BASE_URL in .env.");
  }
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

  let suffix = 2;
  while (takenSelectors.has(`${baseSelector}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseSelector}-${suffix}`;
}

function createConstructedModule(registration: KeplerRegistration, job: import("./types.js").HabitatConstructionJob): HabitatModule {
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

function createConstructAction(): (blueprintId: string, options: { dryRun?: boolean }) => Promise<void> {
  return async (blueprintId: string, options: { dryRun?: boolean }) => {
    try {
      if (getApiBaseUrl()) {
        const result = await postApiJson<{
          report: {
            blueprintId: string;
            displayName: string;
            canStart: boolean;
            checks: Array<{ label: string; ok: boolean; details: string }>;
            inventory: {
              ok: boolean;
              shortages: Array<{ resourceId: string; required: number; available: number }>;
              consumedInputs: Array<{ resourceId: string; amount: number }>;
            };
          };
          startedJob: {
            pendingModuleName: string;
            consumedInputs: Array<{ resourceId: string; amount: number }>;
            ticksRemaining: number;
            ticksRequired: number;
          } | null;
          completedModule: { displayName: string; selector: string } | null;
        }>("/commands/construct", {
          blueprintId,
          dryRun: options.dryRun ?? false,
        });

        const readinessReport = formatConstructionReadinessReport(result.report);

        if (options.dryRun || !result.report.canStart) {
          console.log(readinessReport);
          if (!result.report.canStart) {
            process.exitCode = 1;
          }
          return;
        }

        if (!result.startedJob) {
          throw new Error("Construction did not start.");
        }

        if (result.startedJob.ticksRemaining === 0 && result.completedModule) {
          console.log(`Construction completed immediately: ${result.completedModule.displayName} (${result.completedModule.selector}).`);
          return;
        }

        console.log(
          `Construction started for ${result.startedJob.pendingModuleName}. Consumed ${result.startedJob.consumedInputs
            .map((input) => `${input.resourceId}: ${input.amount}`)
            .join(", ") || "no resources"}. ${result.startedJob.ticksRemaining} tick(s) remaining.`,
        );
        return;
      }

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

