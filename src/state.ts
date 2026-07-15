import { randomUUID } from "node:crypto";
import {
  type HabitatBlueprint,
  type HabitatAlert,
  type HabitatHuman,
  type HabitatModule,
  type HabitatEvaState,
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
        `SELECT habitat_id AS habitatId, habitat_uuid AS habitatUuid, display_name AS displayName, stream_url AS streamUrl, api_token AS apiToken, stream_json AS streamJson, contracts_json AS contractsJson, habitat_json AS habitatJson, blueprints_json AS blueprintsJson
         FROM kepler_registration
         LIMIT 1`,
      )
      .get() as
      | {
          habitatId: string;
          habitatUuid: string;
          displayName: string;
          streamUrl: string | null;
          apiToken: string | null;
          streamJson: string | null;
          contractsJson: string | null;
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
        streamUrl: row.streamUrl ?? "",
        apiToken: row.apiToken ?? "",
        stream: row.streamJson ? JSON.parse(row.streamJson) : { protocolVersion: "1.0", subscriptions: ["ticks"], currentTick: 0, tickIntervalMs: 1000, ticksPerPulse: 1, status: "paused" },
        contracts: row.contractsJson ? JSON.parse(row.contractsJson) : { alerts: { schemaVersion: "1.0", schema: {} } },
        habitat: JSON.parse(row.habitatJson) as KeplerHabitat,
        modules: loadHabitatModules(),
        humans: loadHabitatHumans(),
        alerts: loadHabitatAlerts(),
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
      `INSERT INTO kepler_registration (habitat_id, habitat_uuid, display_name, stream_url, api_token, stream_json, contracts_json, habitat_json, blueprints_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      registration.habitatId,
      registration.habitatUuid,
      registration.displayName,
      registration.streamUrl,
      registration.apiToken,
      JSON.stringify(registration.stream),
      JSON.stringify(registration.contracts),
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
      db.run("DELETE FROM habitat_humans;");
      db.run("DELETE FROM habitat_alerts;");
      db.run("DELETE FROM habitat_modules;");
      db.run("DELETE FROM inventory_items;");
      db.run("DELETE FROM construction_state;");
      db.run("DELETE FROM eva_state;");
    })();
  });
}

export function loadEvaState(): HabitatEvaState | null {
  ensureDataDirectory();
  return withDatabase((db) => {
    const row = db.query(`SELECT deployed_human_id AS deployedHumanId, x, y, carried_resources_json AS carriedResourcesJson, max_carrying_capacity_kg AS maxCarryingCapacityKg FROM eva_state WHERE id = 1`).get() as { deployedHumanId: string | null; x: number; y: number; carriedResourcesJson: string; maxCarryingCapacityKg: number } | undefined;
    return row ? { deployedHumanId: row.deployedHumanId, x: row.x, y: row.y, carriedResources: JSON.parse(row.carriedResourcesJson), maxCarryingCapacityKg: row.maxCarryingCapacityKg } : null;
  });
}

export function saveEvaState(state: HabitatEvaState): void {
  ensureDataDirectory();
  withDatabase((db) => db.query(`INSERT INTO eva_state (id, deployed_human_id, x, y, carried_resources_json, max_carrying_capacity_kg) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET deployed_human_id=excluded.deployed_human_id, x=excluded.x, y=excluded.y, carried_resources_json=excluded.carried_resources_json, max_carrying_capacity_kg=excluded.max_carrying_capacity_kg`).run(state.deployedHumanId, state.x, state.y, JSON.stringify(state.carriedResources), state.maxCarryingCapacityKg));
}

export function saveHabitatHumans(humans: HabitatHuman[]): void {
  ensureDataDirectory();
  withDatabase((db) => {
    db.transaction(() => {
      db.run("DELETE FROM habitat_humans;");
      const insert = db.query(
        `INSERT INTO habitat_humans (id, display_name, location_module_id, status)
         VALUES (?, ?, ?, ?)`,
      );
      for (const human of humans) {
        insert.run(human.id, human.displayName, human.locationModuleId, human.status);
      }
    })();
  });
}

export function loadHabitatHumans(): HabitatHuman[] {
  ensureDataDirectory();
  return withDatabase((db) => {
    const rows = db
      .query(`SELECT id, display_name AS displayName, location_module_id AS locationModuleId, status FROM habitat_humans`)
      .all() as Array<{ id: string; displayName: string; locationModuleId: string; status: string }>;
    return rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      locationModuleId: row.locationModuleId,
      status: row.status,
    }));
  });
}

export function saveHabitatAlerts(alerts: HabitatAlert[]): void {
  ensureDataDirectory();
  withDatabase((db) => {
    db.transaction(() => {
      db.run("DELETE FROM habitat_alerts;");
      const insert = db.query(
        `INSERT INTO habitat_alerts (id, schema_version, type, severity, status, source, message, created_at, updated_at, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const alert of alerts) {
        insert.run(
          alert.id,
          alert.schemaVersion,
          alert.type,
          alert.severity,
          alert.status,
          alert.source,
          alert.message,
          alert.createdAt,
          alert.updatedAt,
          JSON.stringify(alert.details),
        );
      }
    })();
  });
}

export function loadHabitatAlerts(): HabitatAlert[] {
  ensureDataDirectory();
  return withDatabase((db) => {
    const rows = db
      .query(
        `SELECT id, schema_version AS schemaVersion, type, severity, status, source, message, created_at AS createdAt, updated_at AS updatedAt, details_json AS detailsJson
         FROM habitat_alerts`,
      )
      .all() as Array<{
      id: string;
      schemaVersion: string;
      type: string;
      severity: string;
      status: string;
      source: string;
      message: string;
      createdAt: string;
      updatedAt: string;
      detailsJson: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      schemaVersion: row.schemaVersion,
      type: row.type,
      severity: row.severity,
      status: row.status,
      source: row.source,
      message: row.message,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      details: JSON.parse(row.detailsJson),
    }));
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
  validateRegistrationPersistence(registration);
  withDatabase((db) => {
    db.transaction(() => {
      db.run("DELETE FROM kepler_registration;");
      db.run("DELETE FROM habitat_humans;");
      db.run("DELETE FROM habitat_alerts;");
      db.run("DELETE FROM habitat_modules;");
      db.query(
        `INSERT INTO kepler_registration (habitat_id, habitat_uuid, display_name, stream_url, api_token, stream_json, contracts_json, habitat_json, blueprints_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        registration.habitatId,
        registration.habitatUuid,
        registration.displayName,
        registration.streamUrl,
        registration.apiToken,
        JSON.stringify(registration.stream),
        JSON.stringify(registration.contracts),
        JSON.stringify(registration.habitat),
        JSON.stringify(registration.blueprints),
      );

      const humanInsert = db.query(
        `INSERT INTO habitat_humans (id, display_name, location_module_id, status)
         VALUES (?, ?, ?, ?)`,
      );
      for (const human of registration.humans) {
        humanInsert.run(human.id, human.displayName, human.locationModuleId, human.status);
      }

      const alertInsert = db.query(
        `INSERT INTO habitat_alerts (id, schema_version, type, severity, status, source, message, created_at, updated_at, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const alert of registration.alerts) {
        alertInsert.run(
          alert.id,
          alert.schemaVersion,
          alert.type,
          alert.severity,
          alert.status,
          alert.source,
          alert.message,
          alert.createdAt,
          alert.updatedAt,
          JSON.stringify(alert.details),
        );
      }

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

export function setModuleStatus(registration: KeplerRegistration, moduleId: string, status: string): KeplerRegistration {
  const currentModule = registration.modules.find((module) => module.id === moduleId);
  if (!currentModule) throw new Error(`Module not found: ${moduleId}.`);

  const commandModuleId = registration.modules.find((module) => module.blueprintId === "command-module")?.id;
  const batteryModuleId = registration.modules.find((module) => module.capabilities.includes("power-storage"))?.id;
  const commandIsOffline = currentModule.id === commandModuleId && status === "offline";
  const commandIsRecovering = currentModule.id === commandModuleId && status === "online";
  const commandAlreadyOffline = registration.modules.some(
    (module) => module.id === commandModuleId && module.runtimeAttributes.status === "offline",
  );

  return {
    ...registration,
    modules: registration.modules.map((module) => ({
      ...module,
      runtimeAttributes: {
        ...module.runtimeAttributes,
        status: commandIsRecovering && (module.id === commandModuleId || module.id === batteryModuleId)
          ? "online"
          : commandIsOffline || (commandAlreadyOffline && !commandIsRecovering)
          ? "offline"
          : module.id === currentModule.id
            ? status
            : module.runtimeAttributes.status,
      },
    })),
  };
}

function validateRegistrationPersistence(registration: KeplerRegistration): void {
  if (!Array.isArray(registration.modules) || !Array.isArray(registration.humans)) {
    throw new Error("Registration modules and humans must be arrays.");
  }

  for (const human of registration.humans) {
    if (!human.id || !human.displayName || !human.locationModuleId) {
      throw new Error("Every registered human must have an id, display name, and assigned module id.");
    }
  }

  for (const module of registration.modules) {
    if (!module.id || !module.selector || !module.blueprintId) {
      throw new Error("Every registered module must have an id, selector, and blueprint id.");
    }
  }
}

export function ensureDefaultModuleRuntimeStatus(module: HabitatModule): HabitatModule {
  if (!module.capabilities.includes("power-storage")) {
    return module;
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
