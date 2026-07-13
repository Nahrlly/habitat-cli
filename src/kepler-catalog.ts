export type KeplerCatalogBlueprint = {
  blueprintId: string;
  displayName: string;
  description?: string;
  output?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
  productionCost?: Record<string, unknown>;
  requiredFacility?: Record<string, unknown>;
  buildTicks?: number;
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

export type KeplerCatalogResource = {
  resourceId: string;
  displayName: string;
  description?: string;
  category?: string;
  unit?: string;
  unitLabel?: string;
  density?: number | null;
  massPerUnitKg?: number | null;
  storageHint?: string;
  tags?: string[];
};

type KeplerBlueprintCatalogResponse = {
  blueprints?: KeplerCatalogBlueprint[];
  catalog?: KeplerCatalogBlueprint[];
};

type KeplerBlueprintResponse = {
  blueprint?: KeplerCatalogBlueprint;
};

type KeplerResourceCatalogResponse = {
  resources?: KeplerCatalogResource[];
  catalog?: KeplerCatalogResource[];
};

type KeplerSolarIrradianceResponse = {
  solarIrradiance?: unknown;
};

export type KeplerCatalogClient = {
  listBlueprints: () => Promise<KeplerCatalogBlueprint[]>;
  getBlueprint: (blueprintId: string) => Promise<KeplerCatalogBlueprint | null>;
  listResources: () => Promise<KeplerCatalogResource[]>;
  getSolarIrradiance: () => Promise<KeplerSolarIrradiance>;
};

export type KeplerSolarIrradiance = {
  wPerM2: number;
  [key: string]: unknown;
};

export function createKeplerCatalogClient(baseUrl: string, planetToken: string): KeplerCatalogClient {
  const normalizedBaseUrl = baseUrl.trim();
  const normalizedPlanetToken = planetToken.trim();

  return {
    async listBlueprints() {
      const response = await fetch(`${normalizedBaseUrl}/catalog/blueprints`, {
        headers: {
          Authorization: `Bearer ${normalizedPlanetToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Kepler blueprint catalog request failed with ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as KeplerBlueprintCatalogResponse;
      return normalizeBlueprintList(payload);
    },
    async getBlueprint(blueprintId: string) {
      const response = await fetch(`${normalizedBaseUrl}/catalog/blueprints/${encodeURIComponent(blueprintId)}`, {
        headers: {
          Authorization: `Bearer ${normalizedPlanetToken}`,
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`Kepler blueprint lookup failed with ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as KeplerBlueprintResponse;
      return normalizeBlueprintResponse(payload.blueprint ?? null);
    },
    async listResources() {
      const response = await fetch(`${normalizedBaseUrl}/catalog/resources`, {
        headers: {
          Authorization: `Bearer ${normalizedPlanetToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Kepler resource catalog request failed with ${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as KeplerResourceCatalogResponse;
      return normalizeResourceList(payload);
    },
    async getSolarIrradiance() {
      const response = await fetch(`${normalizedBaseUrl}/world/solar-irradiance`);

      if (!response.ok) {
        throw new Error(`Kepler solar irradiance request failed with ${response.status} ${response.statusText}`);
      }

      return normalizeSolarIrradiance(await response.json());
    },
  };
}

function normalizeBlueprintList(payload: KeplerBlueprintCatalogResponse): KeplerCatalogBlueprint[] {
  if (Array.isArray(payload.blueprints)) {
    return payload.blueprints
      .map(normalizeBlueprintRecord)
      .filter((blueprint): blueprint is KeplerCatalogBlueprint => blueprint !== null);
  }

  if (Array.isArray(payload.catalog)) {
    return payload.catalog
      .map(normalizeBlueprintRecord)
      .filter((blueprint): blueprint is KeplerCatalogBlueprint => blueprint !== null);
  }

  return [];
}

function normalizeBlueprintRecord(rawBlueprint: unknown): KeplerCatalogBlueprint | null {
  if (!rawBlueprint || typeof rawBlueprint !== "object") {
    return null;
  }

  const input = rawBlueprint as Record<string, unknown>;
  const blueprintId = typeof input.blueprintId === "string" ? input.blueprintId : typeof input.id === "string" ? input.id : "";
  const displayName =
    typeof input.displayName === "string" ? input.displayName : typeof input.name === "string" ? input.name : blueprintId;

  if (!blueprintId) {
    return null;
  }

  return {
    blueprintId,
    displayName,
    description: typeof input.description === "string" ? input.description : "",
    output: isRecord(input.output) ? input.output : {},
    inputs: isRecord(input.inputs) ? input.inputs : {},
    productionCost: isRecord(input.productionCost) ? input.productionCost : {},
    requiredFacility: isRecord(input.requiredFacility) ? input.requiredFacility : {},
    buildTicks: typeof input.buildTicks === "number" ? input.buildTicks : 0,
    prerequisites: Array.isArray(input.prerequisites) ? input.prerequisites.filter(isString) : [],
    unlocks: Array.isArray(input.unlocks) ? input.unlocks.filter(isString) : [],
    repeatable: typeof input.repeatable === "boolean" ? input.repeatable : false,
    level: typeof input.level === "number" || input.level === null ? input.level : null,
    target: isRecord(input.target) ? input.target : {},
    facilityLevel: isRecord(input.facilityLevel) ? input.facilityLevel : {},
    attachmentPoints: isRecord(input.attachmentPoints) ? input.attachmentPoints : {},
    attachmentRequirements: Array.isArray(input.attachmentRequirements)
      ? input.attachmentRequirements.filter(isRecord)
      : [],
    runtimeAttributes: isRecord(input.runtimeAttributes) ? input.runtimeAttributes : {},
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.filter(isString) : [],
  };
}

function normalizeBlueprintResponse(rawBlueprint: KeplerCatalogBlueprint | null): KeplerCatalogBlueprint | null {
  if (!rawBlueprint) {
    return null;
  }

  return {
    blueprintId: rawBlueprint.blueprintId,
    displayName: rawBlueprint.displayName,
    description: rawBlueprint.description ?? "",
    output: rawBlueprint.output ?? {},
    inputs: rawBlueprint.inputs ?? {},
    productionCost: rawBlueprint.productionCost ?? {},
    requiredFacility: rawBlueprint.requiredFacility ?? {},
    buildTicks: rawBlueprint.buildTicks ?? 0,
    prerequisites: rawBlueprint.prerequisites ?? [],
    unlocks: rawBlueprint.unlocks ?? [],
    repeatable: rawBlueprint.repeatable ?? false,
    level: rawBlueprint.level ?? null,
    target: rawBlueprint.target ?? {},
    facilityLevel: rawBlueprint.facilityLevel ?? {},
    attachmentPoints: rawBlueprint.attachmentPoints ?? {},
    attachmentRequirements: rawBlueprint.attachmentRequirements ?? [],
    runtimeAttributes: rawBlueprint.runtimeAttributes ?? {},
    capabilities: rawBlueprint.capabilities ?? [],
  };
}

function normalizeResourceList(payload: KeplerResourceCatalogResponse): KeplerCatalogResource[] {
  if (Array.isArray(payload.resources)) {
    return payload.resources
      .map(normalizeResourceRecord)
      .filter((resource): resource is KeplerCatalogResource => resource !== null);
  }

  if (Array.isArray(payload.catalog)) {
    return payload.catalog
      .map(normalizeResourceRecord)
      .filter((resource): resource is KeplerCatalogResource => resource !== null);
  }

  return [];
}

function normalizeResourceRecord(rawResource: unknown): KeplerCatalogResource | null {
  if (!rawResource || typeof rawResource !== "object") {
    return null;
  }

  const input = rawResource as Record<string, unknown>;
  const resourceId = typeof input.resourceId === "string" ? input.resourceId : typeof input.id === "string" ? input.id : "";
  const displayName =
    typeof input.displayName === "string" ? input.displayName : typeof input.name === "string" ? input.name : resourceId;

  if (!resourceId) {
    return null;
  }

  return {
    resourceId,
    displayName,
    description: typeof input.description === "string" ? input.description : "",
    category: typeof input.category === "string" ? input.category : undefined,
    unit: typeof input.unit === "string" ? input.unit : undefined,
    unitLabel: typeof input.unitLabel === "string" ? input.unitLabel : undefined,
    density: typeof input.density === "number" ? input.density : null,
    massPerUnitKg: typeof input.massPerUnitKg === "number" ? input.massPerUnitKg : null,
    storageHint: typeof input.storageHint === "string" ? input.storageHint : undefined,
    tags: Array.isArray(input.tags) ? input.tags.filter(isString) : [],
  };
}

function normalizeSolarIrradiance(rawSolarIrradiance: unknown): KeplerSolarIrradiance {
  if (isRecord(rawSolarIrradiance) && "solarIrradiance" in rawSolarIrradiance) {
    return normalizeSolarIrradiance((rawSolarIrradiance as KeplerSolarIrradianceResponse).solarIrradiance);
  }

  if (!isRecord(rawSolarIrradiance)) {
    return { wPerM2: 0 };
  }

  return {
    wPerM2: typeof rawSolarIrradiance.wPerM2 === "number" ? rawSolarIrradiance.wPerM2 : 0,
    ...rawSolarIrradiance,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
