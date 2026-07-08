import { randomUUID } from "node:crypto";
import { Command, InvalidArgumentError } from "commander";
import { createKeplerCatalogClient, type KeplerCatalogBlueprint, type KeplerCatalogResource } from "./kepler-catalog.js";
import {
  ensureKeplerEnv,
  clearKeplerRegistration,
  loadKeplerRegistration,
  loadStateOrFail,
  saveState,
} from "./state.js";
import {
  applyTick,
  buildModuleStatusRows,
  formatBlueprintList,
  formatBlueprintSummary,
  formatEnergyCost,
  formatModuleSummary,
  formatPowerDraw,
  formatResourceList,
  getModulePowerDraw,
  powerDrawToEnergyCost,
  renderTextTable,
  sumModulePowerDraw,
} from "./formatters.js";
import type { KeplerBlueprint, HabitatBlueprint, HabitatModule, KeplerRegistration, KeplerStarterModule } from "./types.js";

const keplerBaseUrl = process.env.KEPLER_BASE_URL ?? "";
const keplerPlanetToken = process.env.KEPLER_PLANET_TOKEN ?? "";
const keplerCatalogClient = createKeplerCatalogClient(keplerBaseUrl, keplerPlanetToken);

export function createProgram(): Command {
  const program = new Command();

  program.name("habitat").description("Register this Habitat CLI with Kepler and inspect its status.").version("0.1.0");

  program
    .command("register")
    .description("Register this Habitat CLI with Kepler.")
    .requiredOption("--name <name>", "habitat name")
    .action(async (options: { name: string }) => {
      try {
        if (loadKeplerRegistration()) {
          console.error("Habitat is already registered. Run `habitat unregister` first.");
          process.exitCode = 1;
          return;
        }

        const registration = await registerWithKepler(options.name);
        saveState(registration);
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
        const registration = loadKeplerRegistration();

        if (!registration) {
          console.log("Habitat is not registered with Kepler.");
          return;
        }

        const habitat = await fetchKeplerHabitatStatus(registration.habitatId).catch(() => registration.habitat);
        const refreshedRegistration: KeplerRegistration = {
          ...registration,
          habitat,
        };
        saveState(refreshedRegistration);

        console.log(`Habitat "${habitat.displayName}" is registered with Kepler.`);
        console.log(`Habitat ID: ${habitat.id}`);
        console.log(`Habitat slug: ${habitat.habitatSlug}`);
        console.log(`Kepler catalog version: ${habitat.catalogVersion}`);
        console.log(`Kepler status: ${habitat.status}`);
        console.log(`Last seen at: ${habitat.lastSeenAt ?? "unknown"}`);
        console.log(`Modules created: ${formatModuleSummary(refreshedRegistration)}`);
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  program
    .command("tick")
    .description("Advance habitat power consumption by one or more ticks.")
    .option("--ticks <ticks>", "number of ticks to advance", (value) => parsePositiveNumber(value, "ticks"), 1)
    .action((options: { ticks: number }) => {
      try {
        const registration = loadStateOrFail();
        const tickCount = Math.floor(options.ticks);

        if (tickCount <= 0) {
          throw new Error("ticks must be greater than zero.");
        }

        const nextState = applyTick(registration, tickCount);
        saveState(nextState.registration);

        console.log(`Advanced ${tickCount} tick(s).`);
        console.log(`Total power draw: ${formatEnergyCost(nextState.totalPowerDraw)} kWh.`);
        console.log(`Battery charge: ${nextState.batteryBefore} kWh -> ${nextState.batteryAfter} kWh.`);
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
        const registration = loadKeplerRegistration();

        if (!registration) {
          console.log("Habitat is not registered with Kepler.");
          return;
        }

        await unregisterFromKepler(registration.habitatId);
        console.log(`Unregistered habitat ${registration.displayName}.`);
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

  const moduleCommand = program.command("module").description("Manage local Habitat modules.");
  const blueprintCommand = program.command("blueprint").description("Inspect the official Kepler blueprint catalog.");
  const resourceCommand = program.command("resource").description("Inspect the official Kepler resource catalog.");

  blueprintCommand
    .command("list")
    .description("List official Kepler blueprints.")
    .action(async () => {
      try {
        const blueprints = await listBlueprints();
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
        const blueprint = await getBlueprint(blueprintId);

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
        const resources = await listResources();
        console.log(formatResourceList(resources));
      } catch (error) {
        console.error((error as Error).message);
        process.exitCode = 1;
      }
    });

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
        console.log(renderTextTable(["Module", "State", "Power Draw"], rows));
        console.log(
          `Total current power draw: ${formatPowerDraw(sumModulePowerDraw(registration))} kW; one tick energy cost: ${formatEnergyCost(powerDrawToEnergyCost(sumModulePowerDraw(registration), 1))} kWh.`,
        );
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
    .action((moduleId: string, status: string) => {
      try {
        const registration = loadStateOrFail();
        const nextStatus = parseModuleStatus(status);
        const currentModule = resolveModule(registration, moduleId);

        const nextModule = {
          ...currentModule,
          runtimeAttributes: {
            ...currentModule.runtimeAttributes,
            status: nextStatus,
          },
        };

        saveState({
          ...registration,
          modules: registration.modules.map((module) => (module.id === currentModule.id ? nextModule : module)),
        });

        console.log(
          `Module ${currentModule.selector} status set to ${nextStatus}; current power draw ${formatPowerDraw(getModulePowerDraw(nextModule))} kW.`,
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
      (
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
          const blueprintId = options.blueprintId ?? "";

          if (blueprintId) {
            requireBlueprint(registration, blueprintId);
          }

          const runtimeAttributes = parseKeyValuePairs(options.runtimeAttribute, "runtime attribute");
          const connectedTo = resolveModuleIds(registration, options.connectedTo);
          const id = randomUUID();
          const newModule: HabitatModule = {
            id,
            selector: makeUniqueSelector(id, registration.modules),
            blueprintId: blueprintId || "custom-module",
            displayName: parseNonEmptyString(name, "Module name"),
            connectedTo,
            runtimeAttributes,
            capabilities: options.capability,
          };

          saveState({
            ...registration,
            modules: [...registration.modules, newModule],
          });

          console.log(`Module created: ${newModule.displayName}`);
        } catch (error) {
          console.error((error as Error).message);
          process.exitCode = 1;
        }
      },
    );

  moduleCommand
    .command("list")
    .description("List local modules.")
    .action(() => {
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
    .action((selector: string) => {
      try {
        const registration = loadStateOrFail();
        console.log(JSON.stringify(resolveModule(registration, selector), null, 2));
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
      (
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
      },
    );

  moduleCommand
    .command("delete")
    .description("Delete a local module.")
    .argument("<selector>", "module selector or id")
    .action((selector: string) => {
      try {
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
  ensureKeplerEnv(keplerBaseUrl, keplerPlanetToken);

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
    modules: payload.starterModules.map((starterModule) => ({
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
      runtimeAttributes: starterModule.runtimeAttributes,
      capabilities: starterModule.capabilities,
    })),
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
  ensureKeplerEnv(keplerBaseUrl, keplerPlanetToken);

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
  ensureKeplerEnv(keplerBaseUrl, keplerPlanetToken);

  const response = await fetch(`${keplerBaseUrl}/habitats/${habitatId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${keplerPlanetToken}`,
    },
  });

  if (response.status === 404) {
    clearKeplerRegistration();
    return;
  }

  if (!response.ok && response.status !== 204) {
    throw new Error(`Kepler unregister failed with ${response.status} ${response.statusText}`);
  }

  clearKeplerRegistration();
}

async function listBlueprints(): Promise<KeplerCatalogBlueprint[]> {
  ensureKeplerEnv(keplerBaseUrl, keplerPlanetToken);
  return keplerCatalogClient.listBlueprints();
}

async function getBlueprint(blueprintId: string): Promise<KeplerCatalogBlueprint | null> {
  ensureKeplerEnv(keplerBaseUrl, keplerPlanetToken);
  return keplerCatalogClient.getBlueprint(blueprintId);
}

async function listResources(): Promise<KeplerCatalogResource[]> {
  ensureKeplerEnv(keplerBaseUrl, keplerPlanetToken);
  return keplerCatalogClient.listResources();
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

function resolveModule(registration: KeplerRegistration, selector: string): HabitatModule {
  const exactMatches = registration.modules.filter((module) => module.id === selector || module.selector === selector);

  if (exactMatches.length > 0) {
    return exactMatches[0];
  }

  const matches = registration.modules.filter((module) => module.id.startsWith(selector));

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
