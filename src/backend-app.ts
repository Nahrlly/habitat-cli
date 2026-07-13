import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { advanceConstruction, cancelConstruction, loadConstructionState, saveConstructionState, startConstruction } from "./construction-state.js";
import { createKeplerCatalogClient } from "./kepler-catalog.js";
import { addInventoryQuantity, loadInventoryState, setInventoryQuantity } from "./inventory-state.js";
import { applyTickWithSolarIrradiance, getDeclaredModuleStatus, getModulePowerDraw } from "./formatters.js";
import {
  clearLocalHabitatState,
  ensureDefaultModuleRuntimeStatus,
  loadKeplerRegistration,
  loadStateOrFail,
  saveState,
} from "./state.js";
import type { KeplerCatalogBlueprint, KeplerCatalogResource, KeplerSolarIrradiance } from "./kepler-catalog.js";
import type {
  HabitatBlueprint,
  HabitatConstructionJob,
  HabitatConstructionState,
  HabitatInventoryItem,
  HabitatInventoryState,
  HabitatModule,
  KeplerBlueprint,
  KeplerRegistration,
  KeplerStarterModule,
} from "./types.js";

type BackendRegistrationResponse = {
  registration: KeplerRegistration;
};

type BackendModulesResponse = {
  modules: KeplerRegistration["modules"];
};

type BackendInventoryResponse = {
  inventory: HabitatInventoryState;
};

type BackendConstructionResponse = {
  construction: HabitatConstructionState;
};

type BackendPowerOverviewResponse = {
  registration: KeplerRegistration | null;
  solarIrradiance: KeplerSolarIrradiance;
};

type BackendSolarResponse = {
  solarIrradiance: KeplerSolarIrradiance;
};

export function createBackendApp(): Hono {
  const app = new Hono();
  const loggingEnabled = process.env.HABITAT_API_LOG !== "false";
  const keplerBaseUrl = process.env.KEPLER_BASE_URL ?? "";
  const keplerPlanetToken = process.env.KEPLER_PLANET_TOKEN ?? "";
  const keplerCatalogClient = createKeplerCatalogClient(keplerBaseUrl, keplerPlanetToken);

  app.use("*", async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    const method = c.req.method;
    const body = await readRequestBody(c.req.raw);
    if (loggingEnabled) {
      console.log(`[habitat-api] ${method} ${pathname}${body ? ` ${body}` : ""}`);
    }
    await next();
    if (loggingEnabled) {
      console.log(`[habitat-api] ${method} ${pathname} -> ${c.res.status}`);
    }
  });

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/registration", (c) => {
    const registration = loadKeplerRegistration();

    if (!registration) {
      return c.json({ error: "Habitat is not registered with Kepler." }, 404);
    }

    return c.json<BackendRegistrationResponse>({ registration });
  });

  app.get("/modules", (c) => {
    const registration = loadKeplerRegistration();

    if (!registration) {
      return c.json({ error: "Habitat is not registered with Kepler." }, 404);
    }

    return c.json<BackendModulesResponse>({ modules: registration.modules });
  });

  app.get("/modules/:moduleId", (c) => {
    const registration = loadKeplerRegistration();

    if (!registration) {
      return c.json({ error: "Habitat is not registered with Kepler." }, 404);
    }

    const module = registration.modules.find((candidate) => candidate.id === c.req.param("moduleId"));

    if (!module) {
      return c.json({ error: `Module not found: ${c.req.param("moduleId")}` }, 404);
    }

    return c.json({ module });
  });

  app.get("/inventory", (c) => c.json<BackendInventoryResponse>({ inventory: loadInventoryState() }));

  app.get("/construction", (c) => c.json<BackendConstructionResponse>({ construction: loadConstructionState() }));

  app.get("/catalog/blueprints", async (c) => {
    const blueprints = await keplerCatalogClient.listBlueprints();
    return c.json<{ blueprints: KeplerCatalogBlueprint[] }>({ blueprints });
  });

  app.get("/catalog/blueprints/:blueprintId", async (c) => {
    const blueprint = await keplerCatalogClient.getBlueprint(c.req.param("blueprintId"));

    if (!blueprint) {
      return c.json({ error: `Blueprint not found: ${c.req.param("blueprintId")}` }, 404);
    }

    return c.json<{ blueprint: KeplerCatalogBlueprint }>({ blueprint });
  });

  app.get("/catalog/resources", async (c) => {
    const resources = await keplerCatalogClient.listResources();
    return c.json<{ resources: KeplerCatalogResource[] }>({ resources });
  });

  app.get("/solar/status", async (c) => {
    const solarIrradiance = await keplerCatalogClient.getSolarIrradiance();
    return c.json<BackendSolarResponse>({ solarIrradiance });
  });

  app.get("/power/overview", async (c) => {
    const registration = loadKeplerRegistration();
    const solarIrradiance = await keplerCatalogClient.getSolarIrradiance();
    return c.json<BackendPowerOverviewResponse>({ registration, solarIrradiance });
  });

  app.post("/commands/register", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: string } | null;
    const name = body?.name?.trim();

    if (!name) {
      return c.json({ error: "habitat name must not be empty." }, 400);
    }

    if (loadKeplerRegistration()) {
      return c.json({ error: "Habitat is already registered. Run `habitat unregister` first." }, 409);
    }

    const registration = await registerWithKepler(keplerBaseUrl, keplerPlanetToken, name);
    saveState(registration);
    return c.json({ registration });
  });

  app.post("/commands/unregister", async (c) => {
    const registration = loadKeplerRegistration();

    if (!registration) {
      return c.json({ error: "Habitat is not registered with Kepler." }, 404);
    }

    await unregisterFromKepler(keplerBaseUrl, keplerPlanetToken, registration.habitatId);
    clearLocalHabitatState();
    return c.json({ displayName: registration.displayName });
  });

  app.post("/commands/tick", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { ticks?: number; unit?: string } | null;
    const tickCount = parsePositiveTickCount(body?.ticks);
    const secondsPerTick = parseTickUnit(body?.unit);
    const registration = loadStateOrFail();
    const solarIrradiance = await keplerCatalogClient.getSolarIrradiance();
    const nextState = applyTickWithSolarIrradiance(registration, tickCount * secondsPerTick, solarIrradiance);
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

    return c.json({
      tickCount,
      secondsPerTick,
      totalPowerDraw: nextState.totalPowerDraw,
      totalSolarGeneration: nextState.totalSolarGeneration,
      batteryBefore: nextState.batteryBefore,
      batteryAfter: nextState.batteryAfter,
      solarChargeReason: nextState.solarChargeReason,
      activeConstructionJob: constructionResult.activeJob
        ? {
            pendingModuleName: constructionResult.activeJob.pendingModuleName,
            ticksRemaining: constructionResult.activeJob.ticksRemaining,
            ticksRequired: constructionResult.activeJob.ticksRequired,
          }
        : null,
      completedModule: completedModule ? { displayName: completedModule.displayName, selector: completedModule.selector } : null,
    });
  });

  app.post("/commands/inventory/set", handleInventorySet);
  app.post("/inventory/set", handleInventorySet);

  app.post("/commands/inventory/add", handleInventoryAdd);
  app.post("/inventory/add", handleInventoryAdd);

  app.post("/commands/module/set-status", handleModuleStatus);
  app.patch("/modules/:moduleId/status", handleModuleStatus);
  app.post("/modules/:moduleId/status", handleModuleStatus);

  app.post("/commands/module/create", handleModuleCreate);
  app.post("/modules", handleModuleCreate);

  app.post("/commands/module/update", handleModuleUpdate);
  app.patch("/modules/:moduleId", handleModuleUpdate);
  app.post("/modules/:moduleId", handleModuleUpdate);

  app.post("/commands/module/delete", handleModuleDelete);
  app.delete("/modules/:moduleId", handleModuleDelete);
  app.post("/modules/:moduleId/delete", handleModuleDelete);

  app.post("/commands/construct", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { blueprintId?: string; dryRun?: boolean } | null;
    const blueprintId = body?.blueprintId?.trim();
    const dryRun = body?.dryRun ?? false;

    if (!blueprintId) {
      return c.json({ error: "blueprint id must not be empty." }, 400);
    }

    const registration = loadStateOrFail();
    ensureHabitatIsConnected(registration);
    const blueprint = requireBlueprint(registration, blueprintId);
    const result = startConstruction({
      blueprint,
      modules: registration.modules,
      dryRun,
    });

    if (dryRun) {
      return c.json({ report: result.report });
    }

    if (!result.report.canStart) {
      return c.json({ report: result.report });
    }

    if (!result.startedJob) {
      return c.json({ error: "Construction did not start." }, 500);
    }

    if (result.startedJob.ticksRemaining === 0) {
      const completedModule = createConstructedModule(registration, result.startedJob);
      saveState({
        ...registration,
        modules: [...registration.modules, completedModule],
      });
      advanceConstruction(0);
      return c.json({
        report: result.report,
        startedJob: result.startedJob,
        completedModule: {
          displayName: completedModule.displayName,
          selector: completedModule.selector,
        },
      });
    }

    return c.json({
      report: result.report,
      startedJob: result.startedJob,
      completedModule: null,
    });
  });

  app.post("/commands/construction/cancel", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { selector?: string } | null;
    const registration = loadStateOrFail();
    const currentConstruction = loadConstructionState();
    const activeJob = currentConstruction.activeJob;
    const resolvedSelector =
      body?.selector?.trim() ||
      activeJob?.fabricatorSelector ||
      activeJob?.fabricatorId ||
      activeJob?.selector ||
      "";

    if (!resolvedSelector) {
      return c.json({ error: "No active construction job to cancel." }, 404);
    }

    const resolvedModule = registration.modules.find(
      (module) => module.selector === resolvedSelector || module.id === resolvedSelector,
    ) ?? null;

    if (resolvedModule && activeJob && resolvedModule.blueprintId === "workshop-fabricator") {
      saveConstructionState({ activeJob: null });
      return c.json({ canceledJob: activeJob });
    }

    const result = cancelConstruction(resolvedSelector);

    if (!result.canceledJob) {
      return c.json({ error: `No active construction job matches ${resolvedSelector}.` }, 404);
    }

    return c.json({ canceledJob: result.canceledJob });
  });

  return app;
}

async function registerWithKepler(baseUrl: string, planetToken: string, displayName: string): Promise<KeplerRegistration> {
  const habitatUuid = randomUUID();
  const response = await fetch(`${baseUrl}/habitats/register`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${planetToken}`,
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

  const habitat = await fetchKeplerHabitatStatus(baseUrl, planetToken, payload.habitatId).catch(() => ({
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

async function fetchKeplerHabitatStatus(baseUrl: string, planetToken: string, habitatId: string): Promise<KeplerRegistration["habitat"]> {
  const response = await fetch(`${baseUrl}/habitats/${habitatId}`, {
    headers: {
      Authorization: `Bearer ${planetToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Kepler habitat status failed with ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { habitat: KeplerRegistration["habitat"] };
  return payload.habitat;
}

async function unregisterFromKepler(baseUrl: string, planetToken: string, habitatId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/habitats/${habitatId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${planetToken}`,
    },
  });

  if (response.status === 404) {
    return;
  }

  if (!response.ok && response.status !== 204) {
    throw new Error(`Kepler unregister failed with ${response.status} ${response.statusText}`);
  }
}

function createConstructedModule(registration: KeplerRegistration, job: HabitatConstructionJob): HabitatModule {
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

function parsePositiveTickCount(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 0) {
    throw new Error("ticks must be greater than zero.");
  }

  return Math.floor(value);
}

function parseTickUnit(value: string | undefined): number {
  if (!value || value === "second" || value === "seconds") {
    return 1;
  }

  if (value === "hour") {
    return 3600;
  }

  throw new Error("Tick unit must be seconds or hours.");
}

function parseKeyValuePairs(values: string[], label: string): Record<string, unknown> {
  return values.reduce<Record<string, unknown>>((accumulator, value) => {
    const [key, rawValue] = value.split("=", 2);

    if (!key || rawValue === undefined) {
      throw new Error(`Each ${label} must be in key=value format.`);
    }

    accumulator[key] = rawValue;
    return accumulator;
  }, {});
}

function resolveModuleIds(registration: KeplerRegistration, selectors: string[]): string[] {
  return selectors.map((selector) => resolveModule(registration, selector).id);
}

function parseModuleStatus(value: string | undefined): "offline" | "idle" | "online" | "active" | "damaged" {
  if (
    value === "offline" ||
    value === "idle" ||
    value === "online" ||
    value === "active" ||
    value === "damaged"
  ) {
    return value;
  }

  throw new Error("Status must be offline, idle, online, active, or damaged.");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

function requireBlueprint(registration: KeplerRegistration, blueprintId: string): HabitatBlueprint {
  const blueprint = registration.blueprints.find((candidate) => candidate.blueprintId === blueprintId);

  if (!blueprint) {
    throw new Error(`Blueprint not found: ${blueprintId}`);
  }

  return blueprint;
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

async function readRequestBody(request: Request): Promise<string | null> {
  if (request.method === "GET" || request.method === "HEAD") {
    return null;
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";
    const cloned = request.clone();

    if (contentType.includes("application/json")) {
      const payload = await cloned.json();
      return JSON.stringify(payload);
    }

    const text = await cloned.text();
    return text.trim() || null;
  } catch {
    return null;
  }
}

async function handleInventorySet(c: Context): Promise<Response> {
  const body = (await c.req.json().catch(() => null)) as {
    resourceId?: string;
    quantity?: number;
    displayName?: string;
    unit?: string;
    category?: string;
  } | null;

  const resourceId = body?.resourceId?.trim();

  if (!resourceId) {
    return c.json({ error: "resource id must not be empty." }, 400);
  }

  if (!isFiniteNumber(body?.quantity)) {
    return c.json({ error: "quantity must be a non-negative number." }, 400);
  }

  const item = setInventoryQuantity({
    resourceId,
    quantity: body?.quantity ?? 0,
    displayName: body?.displayName,
    unit: body?.unit,
    category: body?.category,
  });

  return c.json<{ item: HabitatInventoryItem }>({ item });
}

async function handleInventoryAdd(c: Context): Promise<Response> {
  const body = (await c.req.json().catch(() => null)) as {
    resourceId?: string;
    amount?: number;
    displayName?: string;
    unit?: string;
    category?: string;
  } | null;

  const resourceId = body?.resourceId?.trim();

  if (!resourceId) {
    return c.json({ error: "resource id must not be empty." }, 400);
  }

  if (!isFiniteNumber(body?.amount) || (body?.amount ?? 0) < 0) {
    return c.json({ error: "amount must be a non-negative number." }, 400);
  }

  const item = addInventoryQuantity({
    resourceId,
    amount: body?.amount ?? 0,
    displayName: body?.displayName,
    unit: body?.unit,
    category: body?.category,
  });

  return c.json<{ item: HabitatInventoryItem }>({ item });
}

async function handleModuleStatus(c: Context): Promise<Response> {
  const body = (await c.req.json().catch(() => null)) as { moduleId?: string; status?: string } | null;
  const moduleId = body?.moduleId?.trim() || c.req.param("moduleId")?.trim();
  const nextStatus = parseModuleStatus(body?.status);

  if (!moduleId) {
    return c.json({ error: "module id must not be empty." }, 400);
  }

  const registration = loadStateOrFail();
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

  return c.json({
    selector: currentModule.selector,
    status: nextStatus,
    powerDrawKw: getModulePowerDraw(nextModule),
  });
}

async function handleModuleCreate(c: Context): Promise<Response> {
  const body = (await c.req.json().catch(() => null)) as {
    name?: string;
    blueprintId?: string;
    connectedTo?: string[];
    runtimeAttribute?: string[];
    capability?: string[];
  } | null;

  const name = body?.name?.trim();

  if (!name) {
    return c.json({ error: "Module name must not be empty." }, 400);
  }

  const registration = loadStateOrFail();
  const blueprintId = body?.blueprintId?.trim() ?? "";

  if (blueprintId) {
    requireBlueprint(registration, blueprintId);
  }

  const runtimeAttributes = parseKeyValuePairs(body?.runtimeAttribute ?? [], "runtime attribute");
  const connectedTo = resolveModuleIds(registration, body?.connectedTo ?? []);
  const id = randomUUID();
  const newModule: HabitatModule = {
    id,
    selector: makeUniqueSelector(id, registration.modules),
    blueprintId: blueprintId || "custom-module",
    displayName: name,
    connectedTo,
    runtimeAttributes,
    capabilities: body?.capability ?? [],
  };

  const createdModule = ensureDefaultModuleRuntimeStatus(newModule);
  saveState({
    ...registration,
    modules: [...registration.modules, createdModule],
  });

  return c.json({ module: createdModule });
}

async function handleModuleUpdate(c: Context): Promise<Response> {
  const body = (await c.req.json().catch(() => null)) as {
    selector?: string;
    name?: string;
    blueprintId?: string;
    connectedTo?: string[];
    runtimeAttribute?: string[];
    capability?: string[];
  } | null;

  const selector = body?.selector?.trim() || c.req.param("moduleId")?.trim();

  if (!selector) {
    return c.json({ error: "Module selector must not be empty." }, 400);
  }

  const registration = loadStateOrFail();
  const currentModule = resolveModule(registration, selector);

  if (body?.blueprintId?.trim()) {
    requireBlueprint(registration, body.blueprintId.trim());
  }

  const nextModule: HabitatModule = {
    ...currentModule,
    selector: currentModule.selector,
    displayName: body?.name?.trim() ? body.name.trim() : currentModule.displayName,
    blueprintId: body?.blueprintId?.trim() ? body.blueprintId.trim() : currentModule.blueprintId,
    connectedTo:
      (body?.connectedTo?.length ?? 0) > 0 ? resolveModuleIds(registration, body?.connectedTo ?? []) : currentModule.connectedTo,
    runtimeAttributes:
      (body?.runtimeAttribute?.length ?? 0) > 0
        ? parseKeyValuePairs(body?.runtimeAttribute ?? [], "runtime attribute")
        : currentModule.runtimeAttributes,
    capabilities: (body?.capability?.length ?? 0) > 0 ? body?.capability ?? [] : currentModule.capabilities,
  };

  saveState({
    ...registration,
    modules: registration.modules.map((module) => (module.id === currentModule.id ? nextModule : module)),
  });

  return c.json({ module: nextModule });
}

async function handleModuleDelete(c: Context): Promise<Response> {
  const body = (await c.req.json().catch(() => null)) as { selector?: string } | null;
  const selector = body?.selector?.trim() || c.req.param("moduleId")?.trim();

  if (!selector) {
    return c.json({ error: "Module selector must not be empty." }, 400);
  }

  const registration = loadStateOrFail();
  const currentModule = resolveModule(registration, selector);

  saveState({
    ...registration,
    modules: registration.modules.filter((module) => module.id !== currentModule.id),
  });

  return c.json({ module: currentModule });
}
