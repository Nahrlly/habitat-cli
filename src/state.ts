import { randomUUID } from "node:crypto";
import {
  type HabitatBlueprint,
  type HabitatModule,
  type KeplerBlueprint,
  type KeplerHabitat,
  type KeplerRegistration,
} from "./types.js";
import { ensureDataDirectory, withDatabase } from "./sqlite-state.js";

export function ensureKeplerEnv(baseUrl: string, planetToken: string): void {
  if (!baseUrl || !planetToken) {
    throw new Error("Missing KEPLER_BASE_URL or KEPLER_PLANET_TOKEN in .env.");
  }
}

export function loadKeplerRegistration(): KeplerRegistration | null {
  ensureDataDirectory();

  const registration = withDatabase((db) => {
    const row = db
      .query(
        `SELECT habitat_id AS habitatId, habitat_uuid AS habitatUuid, display_name AS displayName, habitat_json AS habitatJson, blueprints_json AS blueprintsJson
         FROM kepler_registration
         LIMIT 1`,
      )
      .get() as
      | {
          habitatId: string;
          habitatUuid: string;
          displayName: string;
          habitatJson: string;
          blueprintsJson: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    try {
      return {
        habitatId: row.habitatId,
        habitatUuid: row.habitatUuid,
        displayName: row.displayName,
        habitat: JSON.parse(row.habitatJson) as KeplerHabitat,
        modules: loadHabitatModules(),
        blueprints: JSON.parse(row.blueprintsJson) as HabitatBlueprint[],
      };
    } catch {
      return null;
    }
  });

  if (registration) {
    return registration;
  }

  return null;
}

export function saveKeplerRegistration(registration: KeplerRegistration): void {
  ensureDataDirectory();
  withDatabase((db) => {
    db.run("DELETE FROM kepler_registration;");
    db.query(
      `INSERT INTO kepler_registration (habitat_id, habitat_uuid, display_name, habitat_json, blueprints_json)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      registration.habitatId,
      registration.habitatUuid,
      registration.displayName,
      JSON.stringify(registration.habitat),
      JSON.stringify(registration.blueprints),
    );
  });
}

export function clearKeplerRegistration(): void {
  ensureDataDirectory();
  withDatabase((db) => {
    db.run("DELETE FROM kepler_registration;");
  });
}

export function clearLocalHabitatState(): void {
  ensureDataDirectory();
  withDatabase((db) => {
    db.transaction(() => {
      db.run("DELETE FROM kepler_registration;");
      db.run("DELETE FROM habitat_modules;");
      db.run("DELETE FROM inventory_items;");
      db.run("DELETE FROM construction_state;");
    })();
  });
}

export function saveHabitatModules(modules: HabitatModule[]): void {
  ensureDataDirectory();
  withDatabase((db) => {
    db.transaction(() => {
      db.run("DELETE FROM habitat_modules;");
      const insert = db.query(
        `INSERT INTO habitat_modules (id, selector, blueprint_id, display_name, connected_to_json, runtime_attributes_json, capabilities_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const module of modules) {
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
    })();
  });
}

export function loadHabitatModules(): HabitatModule[] {
  ensureDataDirectory();

  const modules = withDatabase((db) => {
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

    return rows.map((row) =>
      normalizeModule({
        id: row.id,
        selector: row.selector,
        blueprintId: row.blueprintId,
        displayName: row.displayName,
        connectedTo: JSON.parse(row.connectedToJson),
        runtimeAttributes: JSON.parse(row.runtimeAttributesJson),
        capabilities: JSON.parse(row.capabilitiesJson),
      }),
    );
  });

  if (modules.length > 0) {
    return modules;
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
  withDatabase((db) => {
    db.transaction(() => {
      db.run("DELETE FROM kepler_registration;");
      db.run("DELETE FROM habitat_modules;");
      db.query(
        `INSERT INTO kepler_registration (habitat_id, habitat_uuid, display_name, habitat_json, blueprints_json)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        registration.habitatId,
        registration.habitatUuid,
        registration.displayName,
        JSON.stringify(registration.habitat),
        JSON.stringify(registration.blueprints),
      );

      const insert = db.query(
        `INSERT INTO habitat_modules (id, selector, blueprint_id, display_name, connected_to_json, runtime_attributes_json, capabilities_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const module of registration.modules) {
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
    })();
  });
}

export function ensureDefaultModuleRuntimeStatus(module: HabitatModule): HabitatModule {
  if (!module.capabilities.includes("power-storage")) {
    return module;
  }

  if (isStarterBatteryModule(module)) {
    return {
      ...module,
      runtimeAttributes: {
        ...module.runtimeAttributes,
        status: "online",
      },
    };
  }

  const status = module.runtimeAttributes.status;

  if (
    status === "online" ||
    status === "offline" ||
    status === "idle" ||
    status === "active" ||
    status === "damaged"
  ) {
    return module;
  }

  return {
    ...module,
    runtimeAttributes: {
      ...module.runtimeAttributes,
      status: "online",
    },
  };
}

function normalizeModule(rawModule: unknown): HabitatModule {
  const input = isObject(rawModule) ? rawModule : {};
  const displayName = typeof input.displayName === "string" ? input.displayName : "Unnamed Module";
  const baseSelector =
    typeof input.selector === "string" ? input.selector : deriveSelector(typeof input.id === "string" ? input.id : displayName);

  return ensureDefaultModuleRuntimeStatus({
    id: typeof input.id === "string" ? input.id : randomUUID(),
    selector: baseSelector,
    blueprintId: typeof input.blueprintId === "string" ? input.blueprintId : "unknown-blueprint",
    displayName,
    connectedTo: Array.isArray(input.connectedTo) ? input.connectedTo.filter(isString) : [],
    runtimeAttributes: isObject(input.runtimeAttributes) ? input.runtimeAttributes : {},
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.filter(isString) : [],
  });
}

function isStarterBatteryModule(module: HabitatModule): boolean {
  return module.blueprintId === "basic-battery" || module.displayName.toLowerCase().includes("battery");
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
