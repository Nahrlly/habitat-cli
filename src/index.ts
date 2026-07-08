#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";

type KeplerHabitat = {
  id: string;
  habitatSlug: string;
  displayName: string;
  catalogVersion: string;
  status: string;
  lastSeenAt: string | null;
};

type KeplerStarterModule = {
  id: string;
  blueprintId: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

type KeplerBlueprint = {
  id: string;
  blueprintId: string;
  displayName: string;
  description?: string;
  status?: string;
  output: Record<string, unknown>;
  inputs: Record<string, unknown>;
  productionCost?: Record<string, unknown>;
  requiredFacility?: Record<string, unknown>;
  buildTicks: number;
  prerequisites?: string[];
  unlocks?: string[];
  repeatable?: boolean;
  level?: number | null;
  target?: Record<string, unknown>;
  facilityLevel?: Record<string, unknown>;
  attachmentPoints?: Record<string, unknown>;
  attachmentRequirements?: Array<Record<string, unknown>>;
  runtimeAttributes?: Record<string, unknown>;
  capabilities?: string[];
};

type KeplerRegistration = {
  habitatId: string;
  habitatUuid: string;
  displayName: string;
  habitat: KeplerHabitat;
  modules: HabitatModule[];
  blueprints: HabitatBlueprint[];
};

type HabitatModule = {
  id: string;
  selector: string;
  blueprintId: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

type HabitatBlueprint = {
  blueprintId: string;
  displayName: string;
  description: string;
  output: Record<string, unknown>;
  inputs: Record<string, unknown>;
  productionCost: Record<string, unknown>;
  requiredFacility: Record<string, unknown>;
  buildTicks: number;
  prerequisites: string[];
  unlocks: string[];
  repeatable: boolean;
  level: number | null;
  target: Record<string, unknown>;
  facilityLevel: Record<string, unknown>;
  attachmentPoints: Record<string, unknown>;
  attachmentRequirements: Array<Record<string, unknown>>;
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

type LoadableKeplerState = Partial<KeplerRegistration>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, "../data");
const keplerStateFilePath = path.join(dataDirectory, "kepler.json");
const habitatModulesFilePath = path.join(dataDirectory, "habitat-modules.json");
const keplerBaseUrl = process.env.KEPLER_BASE_URL ?? "";
const keplerPlanetToken = process.env.KEPLER_PLANET_TOKEN ?? "";

function ensureKeplerEnv(): void {
  if (!keplerBaseUrl || !keplerPlanetToken) {
    throw new Error("Missing KEPLER_BASE_URL or KEPLER_PLANET_TOKEN in .env.");
  }
}

function ensureKeplerStateFile(): void {
  mkdirSync(dataDirectory, { recursive: true });

  try {
    readFileSync(keplerStateFilePath, "utf8");
  } catch {
    writeFileSync(keplerStateFilePath, "{}\n", "utf8");
  }
}

function ensureHabitatModulesFile(): void {
  mkdirSync(dataDirectory, { recursive: true });

  try {
    readFileSync(habitatModulesFilePath, "utf8");
  } catch {
    writeFileSync(habitatModulesFilePath, "[]\n", "utf8");
  }
}

function loadHabitatModules(): HabitatModule[] {
  ensureHabitatModulesFile();

  try {
    const raw = JSON.parse(readFileSync(habitatModulesFilePath, "utf8"));

    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map(normalizeModule);
    }
  } catch {
    // Fall through to legacy migration below.
  }

  try {
    const legacyRegistration = JSON.parse(readFileSync(keplerStateFilePath, "utf8")) as LoadableKeplerState;

    if (Array.isArray(legacyRegistration.modules) && legacyRegistration.modules.length > 0) {
      const modules = legacyRegistration.modules.map(normalizeModule);
      saveHabitatModules(modules);
      return modules;
    }
  } catch {
    // Ignore malformed legacy cache and return an empty module list.
  }

  return [];
}

function saveHabitatModules(modules: HabitatModule[]): void {
  ensureHabitatModulesFile();
  const temporaryFilePath = `${habitatModulesFilePath}.${process.pid}.tmp`;
  writeFileSync(temporaryFilePath, `${JSON.stringify(modules, null, 2)}\n`, "utf8");
  renameSync(temporaryFilePath, habitatModulesFilePath);
}

function loadKeplerRegistration(): KeplerRegistration | null {
  ensureKeplerStateFile();

  try {
    const raw = JSON.parse(readFileSync(keplerStateFilePath, "utf8")) as LoadableKeplerState;

    if (
      typeof raw.habitatId === "string" &&
      typeof raw.habitatUuid === "string" &&
      typeof raw.displayName === "string" &&
      raw.habitat !== undefined &&
      raw.habitat !== null
    ) {
      return {
        habitatId: raw.habitatId,
        habitatUuid: raw.habitatUuid,
        displayName: raw.displayName,
        habitat: raw.habitat as KeplerHabitat,
        modules: loadHabitatModules(),
        blueprints: Array.isArray(raw.blueprints) ? raw.blueprints.map(normalizeBlueprint) : [],
      };
    }
  } catch {
    // Ignore malformed cache and treat as unregistered.
  }

  return null;
}

function saveKeplerRegistration(registration: KeplerRegistration): void {
  ensureKeplerStateFile();
  const temporaryFilePath = `${keplerStateFilePath}.${process.pid}.tmp`;
  writeFileSync(
    temporaryFilePath,
    `${JSON.stringify(
      {
        habitatId: registration.habitatId,
        habitatUuid: registration.habitatUuid,
        displayName: registration.displayName,
        habitat: registration.habitat,
        blueprints: registration.blueprints,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  renameSync(temporaryFilePath, keplerStateFilePath);
}

function clearKeplerRegistration(): void {
  ensureKeplerStateFile();
  writeFileSync(keplerStateFilePath, "{}\n", "utf8");
}

function normalizeModule(rawModule: unknown): HabitatModule {
  const input = isObject(rawModule) ? rawModule : {};
  const displayName = typeof input.displayName === "string" ? input.displayName : "Unnamed Module";
  const baseSelector = typeof input.selector === "string" ? input.selector : deriveSelector(typeof input.id === "string" ? input.id : displayName);

  return {
    id: typeof input.id === "string" ? input.id : randomUUID(),
    selector: baseSelector,
    blueprintId: typeof input.blueprintId === "string" ? input.blueprintId : "unknown-blueprint",
    displayName,
    connectedTo: Array.isArray(input.connectedTo) ? input.connectedTo.filter(isString) : [],
    runtimeAttributes: isObject(input.runtimeAttributes) ? input.runtimeAttributes : {},
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.filter(isString) : [],
  };
}

function normalizeBlueprint(rawBlueprint: unknown): HabitatBlueprint {
  const input = isObject(rawBlueprint) ? rawBlueprint : {};

  return {
    blueprintId: typeof input.blueprintId === "string" ? input.blueprintId : "unknown-blueprint",
    displayName: typeof input.displayName === "string" ? input.displayName : "Unnamed Blueprint",
    description: typeof input.description === "string" ? input.description : "",
    output: isObject(input.output) ? input.output : {},
    inputs: isObject(input.inputs) ? input.inputs : {},
    productionCost: isObject(input.productionCost) ? input.productionCost : {},
    requiredFacility: isObject(input.requiredFacility) ? input.requiredFacility : {},
    buildTicks: typeof input.buildTicks === "number" ? input.buildTicks : 0,
    prerequisites: Array.isArray(input.prerequisites) ? input.prerequisites.filter(isString) : [],
    unlocks: Array.isArray(input.unlocks) ? input.unlocks.filter(isString) : [],
    repeatable: typeof input.repeatable === "boolean" ? input.repeatable : false,
    level: typeof input.level === "number" || input.level === null ? input.level : null,
    target: isObject(input.target) ? input.target : {},
    facilityLevel: isObject(input.facilityLevel) ? input.facilityLevel : {},
    attachmentPoints: isObject(input.attachmentPoints) ? input.attachmentPoints : {},
    attachmentRequirements: Array.isArray(input.attachmentRequirements)
      ? input.attachmentRequirements.filter(isObject)
      : [],
    runtimeAttributes: isObject(input.runtimeAttributes) ? input.runtimeAttributes : {},
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.filter(isString) : [],
  };
}

function moduleCount(registration: KeplerRegistration | null): number {
  return registration?.modules.length ?? 0;
}

function getModuleStatus(module: HabitatModule): string {
  const status = module.runtimeAttributes.status;

  if (
    status === "online" ||
    status === "offline" ||
    status === "idle" ||
    status === "active" ||
    status === "damaged"
  ) {
    return status;
  }

  return "online";
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

function getModulePowerDraw(module: HabitatModule): number {
  const powerDrawKw = module.runtimeAttributes.powerDrawKw;
  const status = getModuleStatus(module);

  if (typeof powerDrawKw === "number") {
    return powerDrawKw;
  }

  if (isObject(powerDrawKw)) {
    const draw = powerDrawKw[status];

    if (typeof draw === "number") {
      return draw;
    }
  }

  return 0;
}

function isBatteryModule(module: HabitatModule): boolean {
  return module.capabilities.includes("power-storage");
}

function getBatteryModules(registration: KeplerRegistration): HabitatModule[] {
  return registration.modules.filter(isBatteryModule);
}

function getBatteryCharge(module: HabitatModule): number {
  const currentEnergyKwh = module.runtimeAttributes.currentEnergyKwh;

  return typeof currentEnergyKwh === "number" ? currentEnergyKwh : 0;
}

function setBatteryCharge(module: HabitatModule, currentEnergyKwh: number): HabitatModule {
  return {
    ...module,
    runtimeAttributes: {
      ...module.runtimeAttributes,
      currentEnergyKwh,
    },
  };
}

function formatPowerDraw(powerDraw: number): string {
  return Number.isInteger(powerDraw) ? `${powerDraw}` : powerDraw.toFixed(1).replace(/\.0$/, "");
}

function formatEnergyCost(energyCost: number): string {
  if (energyCost === 0) {
    return "0";
  }

  if (energyCost < 0.01) {
    return energyCost.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }

  return energyCost.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function renderTextTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join(" | ");
  const separator = widths.map((width) => "-".repeat(width)).join("-|-");

  return [formatRow(headers), separator, ...rows.map(formatRow)].join("\n");
}

function buildModuleStatusRows(registration: KeplerRegistration): string[][] {
  return registration.modules.map((module) => [
    module.selector,
    getModuleStatus(module),
    `${formatPowerDraw(getModulePowerDraw(module))} kW`,
  ]);
}

function getTotalBatteryCharge(registration: KeplerRegistration): number {
  return getBatteryModules(registration).reduce((total, module) => total + getBatteryCharge(module), 0);
}

function sumModulePowerDraw(registration: KeplerRegistration): number {
  return registration.modules.reduce((total, module) => total + getModulePowerDraw(module), 0);
}

function powerDrawToEnergyCost(powerDrawKw: number, ticks: number): number {
  return (powerDrawKw * ticks) / 3600;
}

function applyTick(registration: KeplerRegistration, ticks: number): {
  registration: KeplerRegistration;
  totalPowerDraw: number;
  batteryBefore: number;
  batteryAfter: number;
} {
  const totalPowerDraw = powerDrawToEnergyCost(sumModulePowerDraw(registration), ticks);
  const batteryBefore = getTotalBatteryCharge(registration);
  const batteryAfter = Math.max(0, batteryBefore - totalPowerDraw);
  const batteryDrain = batteryBefore - batteryAfter;
  const batteryModules = getBatteryModules(registration);
  const updatedBatteryModules: HabitatModule[] = [];
  let remainingDrain = batteryDrain;

  for (const module of batteryModules) {
    const currentCharge = getBatteryCharge(module);
    const nextCharge = Math.max(0, currentCharge - remainingDrain);
    remainingDrain -= currentCharge - nextCharge;
    updatedBatteryModules.push(setBatteryCharge(module, nextCharge));
  }

  return {
    registration: {
      ...registration,
      modules: registration.modules.map((module) => {
        const updatedBatteryModule = updatedBatteryModules.find((candidate) => candidate.id === module.id);

        return updatedBatteryModule ?? module;
      }),
    },
    totalPowerDraw,
    batteryBefore,
    batteryAfter,
  };
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

function findBlueprint(registration: KeplerRegistration, blueprintId: string): HabitatBlueprint | undefined {
  return registration.blueprints.find((blueprint) => blueprint.blueprintId === blueprintId);
}

function findModuleMatches(registration: KeplerRegistration, selector: string): HabitatModule[] {
  const exactMatches = registration.modules.filter(
    (module) => module.id === selector || module.selector === selector,
  );

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  return registration.modules.filter((module) => module.id.startsWith(selector));
}

function resolveModule(registration: KeplerRegistration, selector: string): HabitatModule {
  const matches = findModuleMatches(registration, selector);

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
  const blueprint = findBlueprint(registration, blueprintId);

  if (!blueprint) {
    throw new Error(`Blueprint not found: ${blueprintId}`);
  }

  return blueprint;
}

async function registerWithKepler(displayName: string): Promise<KeplerRegistration> {
  ensureKeplerEnv();

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
      selector: makeUniqueSelector(starterModule.id, payload.starterModules.map((module) => ({
        id: module.id,
        selector: deriveSelector(module.id),
        blueprintId: module.blueprintId,
        displayName: module.displayName,
        connectedTo: module.connectedTo,
        runtimeAttributes: module.runtimeAttributes,
        capabilities: module.capabilities,
      }))),
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

async function fetchKeplerHabitatStatus(habitatId: string): Promise<KeplerHabitat> {
  ensureKeplerEnv();

  const response = await fetch(`${keplerBaseUrl}/habitats/${habitatId}`, {
    headers: {
      Authorization: `Bearer ${keplerPlanetToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Kepler habitat status failed with ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { habitat: KeplerHabitat };
  return payload.habitat;
}

async function unregisterFromKepler(habitatId: string): Promise<void> {
  ensureKeplerEnv();

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function parseNonEmptyString(value: string, fieldName: string): string {
  if (!value.trim()) {
    throw new InvalidArgumentError(`${fieldName} must not be empty.`);
  }

  return value;
}

function parseBoolean(value: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new InvalidArgumentError("Value must be 'true' or 'false'.");
}

function parsePositiveNumber(value: string, fieldName: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError(`${fieldName} must be a non-negative number.`);
  }

  return parsed;
}

function loadStateOrFail(): KeplerRegistration {
  const registration = loadKeplerRegistration();

  if (!registration) {
    throw new Error("Habitat is not registered with Kepler.");
  }

  return registration;
}

function saveState(registration: KeplerRegistration): void {
  saveKeplerRegistration(registration);
  saveHabitatModules(registration.modules);
}

const program = new Command();

program
  .name("habitat")
  .description("Register this Habitat CLI with Kepler and inspect its status.")
  .version("0.1.0");

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
      const moduleSummary =
        refreshedRegistration.modules.length === 0
          ? "No modules created yet."
          : `${refreshedRegistration.modules.length} module(s): ${refreshedRegistration.modules
              .map((module) => `${module.selector} (${module.displayName})`)
              .join(", ")}`;

      console.log(`Habitat "${habitat.displayName}" is registered with Kepler.`);
      console.log(`Habitat ID: ${habitat.id}`);
      console.log(`Habitat slug: ${habitat.habitatSlug}`);
      console.log(`Kepler catalog version: ${habitat.catalogVersion}`);
      console.log(`Kepler status: ${habitat.status}`);
      console.log(`Last seen at: ${habitat.lastSeenAt ?? "unknown"}`);
      console.log(`Modules created: ${moduleSummary}`);
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

      const nextModule: HabitatModule = {
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

await program.parseAsync(process.argv);

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseKeyValuePairs(values: string[], fieldName: string): Record<string, unknown> {
  return values.reduce<Record<string, unknown>>((accumulator, item) => {
    const separatorIndex = item.indexOf("=");

    if (separatorIndex <= 0 || separatorIndex === item.length - 1) {
      throw new InvalidArgumentError(`${fieldName} must use key=value format.`);
    }

    const key = item.slice(0, separatorIndex);
    const value = item.slice(separatorIndex + 1);
    accumulator[key] = value;
    return accumulator;
  }, {});
}
