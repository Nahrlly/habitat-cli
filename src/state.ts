import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type HabitatBlueprint,
  type HabitatModule,
  type KeplerBlueprint,
  type KeplerHabitat,
  type KeplerRegistration,
  type LoadableKeplerState,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDataDirectory = path.resolve(__dirname, "../data");

export function ensureKeplerEnv(baseUrl: string, planetToken: string): void {
  if (!baseUrl || !planetToken) {
    throw new Error("Missing KEPLER_BASE_URL or KEPLER_PLANET_TOKEN in .env.");
  }
}

export function loadKeplerRegistration(): KeplerRegistration | null {
  ensureKeplerStateFile();

  try {
    const raw = JSON.parse(readFileSync(getKeplerStateFilePath(), "utf8")) as LoadableKeplerState;

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

export function saveKeplerRegistration(registration: KeplerRegistration): void {
  ensureKeplerStateFile();
  const filePath = getKeplerStateFilePath();
  const temporaryFilePath = `${filePath}.${process.pid}.tmp`;
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
  renameSync(temporaryFilePath, filePath);
}

export function clearKeplerRegistration(): void {
  ensureKeplerStateFile();
  writeFileSync(getKeplerStateFilePath(), "{}\n", "utf8");
}

export function saveHabitatModules(modules: HabitatModule[]): void {
  ensureHabitatModulesFile();
  const filePath = getHabitatModulesFilePath();
  const temporaryFilePath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryFilePath, `${JSON.stringify(modules, null, 2)}\n`, "utf8");
  renameSync(temporaryFilePath, filePath);
}

export function loadHabitatModules(): HabitatModule[] {
  ensureHabitatModulesFile();

  try {
    const raw = JSON.parse(readFileSync(getHabitatModulesFilePath(), "utf8"));

    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map(normalizeModule);
    }
  } catch {
    // Fall through to legacy migration below.
  }

  try {
    const legacyRegistration = JSON.parse(readFileSync(getKeplerStateFilePath(), "utf8")) as LoadableKeplerState;

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

export function loadStateOrFail(): KeplerRegistration {
  const registration = loadKeplerRegistration();

  if (!registration) {
    throw new Error("Habitat is not registered with Kepler.");
  }

  return registration;
}

export function saveState(registration: KeplerRegistration): void {
  saveKeplerRegistration(registration);
  saveHabitatModules(registration.modules);
}

function ensureKeplerStateFile(): void {
  mkdirSync(getDataDirectory(), { recursive: true });

  try {
    readFileSync(getKeplerStateFilePath(), "utf8");
  } catch {
    writeFileSync(getKeplerStateFilePath(), "{}\n", "utf8");
  }
}

function ensureHabitatModulesFile(): void {
  mkdirSync(getDataDirectory(), { recursive: true });

  try {
    readFileSync(getHabitatModulesFilePath(), "utf8");
  } catch {
    writeFileSync(getHabitatModulesFilePath(), "[]\n", "utf8");
  }
}

function getDataDirectory(): string {
  return process.env.HABITAT_DATA_DIRECTORY
    ? path.resolve(process.env.HABITAT_DATA_DIRECTORY)
    : defaultDataDirectory;
}

function getKeplerStateFilePath(): string {
  return path.join(getDataDirectory(), "kepler.json");
}

function getHabitatModulesFilePath(): string {
  return path.join(getDataDirectory(), "habitat-modules.json");
}

function normalizeModule(rawModule: unknown): HabitatModule {
  const input = isObject(rawModule) ? rawModule : {};
  const displayName = typeof input.displayName === "string" ? input.displayName : "Unnamed Module";
  const baseSelector =
    typeof input.selector === "string" ? input.selector : deriveSelector(typeof input.id === "string" ? input.id : displayName);

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
