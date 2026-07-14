import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { HabitatModule, KeplerBlueprint, KeplerRegistration, KeplerStarterModule } from "./types.js";
import { loadKeplerRegistration } from "./state.js";
import { clearLocalHabitatState, ensureKeplerEnv, ensureDefaultModuleRuntimeStatus, saveState } from "./state.js";
import { createKeplerCatalogClient } from "./kepler-catalog.js";
import { createKeplerWorldClient } from "./kepler-world.js";
import { addInventoryQuantity, loadInventoryState, saveInventoryState, setInventoryQuantity } from "./inventory-state.js";
import { loadConstructionState, saveConstructionState } from "./construction-state.js";

export const app = new Hono();

app.use("*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  const routeSummary = summarizeRoute(c.req.method, c.req.path, c.res.status);
  console.log(`[api] ${c.req.method} ${c.req.path} -> ${c.res.status} ${routeSummary}`);
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > 0) {
    void elapsedMs;
  }
});

app.get("/health", (c) => {
  return c.json({
    ok: true,
    service: "habitat-backend",
  });
});

app.get("/registration", (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json(
      {
        error: "Habitat is not registered.",
      },
      404,
    );
  }

  return c.json(registration);
});

app.get("/modules", (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  return c.json({ modules: registration.modules });
});

app.get("/modules/:selector", (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  const module = resolveModule(registration.modules, c.req.param("selector"));

  if (!module) {
    return c.json({ error: "Module not found." }, 404);
  }

  return c.json({ module, construction: loadConstructionState().activeJob });
});

app.post("/modules", async (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  const body = (await c.req.json().catch(() => null)) as
    | {
        name?: string;
        blueprintId?: string;
        connectedTo?: string[];
        runtimeAttributes?: Record<string, unknown>;
        capabilities?: string[];
      }
    | null;

  const name = body?.name?.trim();
  if (!name) {
    return c.json({ error: "name is required." }, 400);
  }

  if (body?.blueprintId) {
    const blueprint = registration.blueprints.find((candidate) => candidate.blueprintId === body.blueprintId);
    if (!blueprint) {
      return c.json({ error: `Blueprint not found: ${body.blueprintId}` }, 404);
    }
  }

  const module: HabitatModule = ensureDefaultModuleRuntimeStatus({
    id: randomUUID(),
    selector: makeUniqueSelector(randomUUID(), registration.modules),
    blueprintId: body?.blueprintId ?? "custom-module",
    displayName: name,
    connectedTo: Array.isArray(body?.connectedTo) ? body!.connectedTo : [],
    runtimeAttributes: isRecord(body?.runtimeAttributes) ? body!.runtimeAttributes : {},
    capabilities: Array.isArray(body?.capabilities) ? body!.capabilities : [],
  });

  saveState({ ...registration, modules: [...registration.modules, module] });
  return c.json({ module }, 201);
});

app.patch("/modules/:selector", async (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  const currentModule = resolveModule(registration.modules, c.req.param("selector"));
  if (!currentModule) {
    return c.json({ error: "Module not found." }, 404);
  }

  const body = (await c.req.json().catch(() => null)) as Partial<{
    name: string;
    blueprintId: string;
    connectedTo: string[];
    runtimeAttributes: Record<string, unknown>;
    capabilities: string[];
  }> | null;

  const nextModule: HabitatModule = {
    ...currentModule,
    displayName: body?.name?.trim() || currentModule.displayName,
    blueprintId: body?.blueprintId ?? currentModule.blueprintId,
    connectedTo: Array.isArray(body?.connectedTo) ? body.connectedTo : currentModule.connectedTo,
    runtimeAttributes: isRecord(body?.runtimeAttributes) ? body.runtimeAttributes : currentModule.runtimeAttributes,
    capabilities: Array.isArray(body?.capabilities) ? body.capabilities : currentModule.capabilities,
  };

  saveState({
    ...registration,
    modules: registration.modules.map((module) => (module.id === currentModule.id ? nextModule : module)),
  });

  return c.json({ module: nextModule });
});

app.delete("/modules/:selector", (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  const currentModule = resolveModule(registration.modules, c.req.param("selector"));
  if (!currentModule) {
    return c.json({ error: "Module not found." }, 404);
  }

  saveState({
    ...registration,
    modules: registration.modules.filter((module) => module.id !== currentModule.id),
  });

  return c.json({ ok: true });
});

app.patch("/modules/:selector/status", async (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  const currentModule = resolveModule(registration.modules, c.req.param("selector"));
  if (!currentModule) {
    return c.json({ error: "Module not found." }, 404);
  }

  const body = (await c.req.json().catch(() => null)) as { status?: string } | null;
  if (!body?.status) {
    return c.json({ error: "status is required." }, 400);
  }

  const nextModule = {
    ...currentModule,
    runtimeAttributes: { ...currentModule.runtimeAttributes, status: body.status },
  };

  saveState({
    ...registration,
    modules: registration.modules.map((module) => (module.id === currentModule.id ? nextModule : module)),
  });

  return c.json({ module: nextModule });
});

app.get("/inventory", () => {
  return Response.json({ inventory: loadInventoryState() });
});

app.post("/inventory/set", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { resourceId?: string; quantity?: number; displayName?: string; unit?: string; category?: string }
    | null;

  if (!body?.resourceId || typeof body.quantity !== "number") {
    return c.json({ error: "resourceId and quantity are required." }, 400);
  }

  const item = setInventoryQuantity({
    resourceId: body.resourceId,
    quantity: body.quantity,
    displayName: body.displayName,
    unit: body.unit,
    category: body.category,
  });

  return c.json({ item });
});

app.post("/inventory/add", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { resourceId?: string; amount?: number; displayName?: string; unit?: string; category?: string }
    | null;

  if (!body?.resourceId || typeof body.amount !== "number") {
    return c.json({ error: "resourceId and amount are required." }, 400);
  }

  const item = addInventoryQuantity({
    resourceId: body.resourceId,
    amount: body.amount,
    displayName: body.displayName,
    unit: body.unit,
    category: body.category,
  });

  return c.json({ item });
});

app.post("/commands/register", async (c) => {
  try {
    const body = (await c.req.json().catch(() => null)) as { name?: string } | null;
    const name = body?.name?.trim();

    if (!name) {
      return c.json({ error: "name is required." }, 400);
    }

    if (loadKeplerRegistration()) {
      return c.json({ error: "Habitat is already registered. Run habitat unregister first." }, 409);
    }

    const registration = await registerWithKepler(name);
    saveState(registration);

    return c.json({ registration });
  } catch (error) {
    return friendlyError(c, error);
  }
});

app.post("/commands/unregister", async (c) => {
  try {
    const registration = loadKeplerRegistration();

    if (!registration) {
      return c.json({ error: "Habitat is not registered." }, 404);
    }

    await unregisterFromKepler(registration.habitatId);
    return c.json({ ok: true });
  } catch (error) {
    return friendlyError(c, error);
  }
});

app.get("/catalog/blueprints", async (c) => {
  try {
    const catalog = await createCatalogClient().listBlueprints();
    return c.json({ blueprints: catalog });
  } catch (error) {
    return friendlyError(c, error);
  }
});

app.get("/catalog/blueprints/:blueprintId", async (c) => {
  try {
    const blueprint = await createCatalogClient().getBlueprint(c.req.param("blueprintId"));

    if (!blueprint) {
      return c.json({ error: "Blueprint not found." }, 404);
    }

    return c.json({ blueprint });
  } catch (error) {
    return friendlyError(c, error);
  }
});

app.get("/catalog/resources", async (c) => {
  try {
    const catalog = await createCatalogClient().listResources();
    return c.json({ resources: catalog });
  } catch (error) {
    return friendlyError(c, error);
  }
});

app.get("/solar/status", async (c) => {
  try {
    const solarIrradiance = await createCatalogClient().getSolarIrradiance();
    return c.json({ solarIrradiance });
  } catch (error) {
    return friendlyError(c, error);
  }
});

app.get("/world/scan", async (c) => {
  try {
    const registration = loadKeplerRegistration();
    if (!registration) {
      return c.json({ error: "Habitat is not registered." }, 404);
    }

    const query = c.req.query();
    const x = parseIntegerQuery(query.x, "x");
    const y = parseIntegerQuery(query.y, "y");
    const sensorStrength = parseIntegerQuery(query.strength ?? query.sensorStrength, "sensor strength");
    const radiusTiles = parseIntegerQuery(query.radius ?? query.radiusTiles ?? "0", "radius");

    if (sensorStrength < 0 || sensorStrength > 100) {
      return c.json({ error: "sensor strength must be an integer from 0 through 100." }, 400);
    }
    if (radiusTiles < 0 || radiusTiles > 5) {
      return c.json({ error: "radius must be an integer from 0 through 5." }, 400);
    }

    const scan = await createWorldClient().scan({
      habitatId: registration.habitatId,
      x,
      y,
      sensorStrength,
      radiusTiles,
    });
    return c.json(scan);
  } catch (error) {
    return friendlyError(c, error);
  }
});

app.get("/", (c) => {
  return c.json({
    service: "habitat-backend",
    routes: [
      "GET /health",
      "GET /registration",
      "GET /modules",
      "GET /inventory",
      "GET /catalog/blueprints",
      "GET /catalog/resources",
      "GET /solar/status",
      "GET /world/scan",
    ],
  });
});

const host = process.env.HABITAT_API_HOST ?? "127.0.0.1";
const port = Number(process.env.HABITAT_API_PORT ?? 8787);

if (import.meta.main) {
  console.log(`Habitat backend listening on http://${host}:${port}`);

  Bun.serve({
    hostname: host,
    port,
    fetch: app.fetch,
  });
}

async function registerWithKepler(displayName: string): Promise<KeplerRegistration> {
  const keplerBaseUrl = process.env.KEPLER_BASE_URL ?? "";
  const keplerPlanetToken = process.env.KEPLER_PLANET_TOKEN ?? "";
  ensureKeplerEnv(keplerBaseUrl, keplerPlanetToken);

  const habitatUuid = randomUUID();
  const response = await fetch(`${keplerBaseUrl}/habitats/register`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${keplerPlanetToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ habitatUuid, displayName }),
  });

  if (!response.ok) {
    throw new Error(`Kepler registration failed with ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    habitatId: string;
    starterModules: KeplerStarterModule[];
    blueprints: KeplerBlueprint[];
  };

  const habitat = {
    id: payload.habitatId,
    habitatSlug: displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    displayName,
    catalogVersion: "unknown",
    status: "registered",
    lastSeenAt: null,
  };

  return {
    habitatId: payload.habitatId,
    habitatUuid,
    displayName,
    habitat,
    modules: payload.starterModules.map((starterModule) =>
      ensureStarterModuleRuntimeStatus({
        id: starterModule.id,
        selector: starterModule.id,
        blueprintId: starterModule.blueprintId,
        displayName: starterModule.displayName,
        connectedTo: starterModule.connectedTo,
        runtimeAttributes: starterModule.runtimeAttributes,
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

async function unregisterFromKepler(habitatId: string): Promise<void> {
  const keplerBaseUrl = process.env.KEPLER_BASE_URL ?? "";
  const keplerPlanetToken = process.env.KEPLER_PLANET_TOKEN ?? "";
  ensureKeplerEnv(keplerBaseUrl, keplerPlanetToken);

  const response = await fetch(`${keplerBaseUrl}/habitats/${habitatId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${keplerPlanetToken}`,
    },
  });

  if (response.status === 404 || response.status === 204) {
    clearLocalHabitatState();
    return;
  }

  if (!response.ok) {
    throw new Error(`Kepler unregister failed with ${response.status} ${response.statusText}`);
  }

  clearLocalHabitatState();
}

function createCatalogClient() {
  const keplerBaseUrl = process.env.KEPLER_BASE_URL ?? "";
  const keplerPlanetToken = process.env.KEPLER_PLANET_TOKEN ?? "";
  ensureKeplerEnv(keplerBaseUrl, keplerPlanetToken);
  return createKeplerCatalogClient(keplerBaseUrl, keplerPlanetToken, loggedKeplerFetch);
}

function createWorldClient() {
  const keplerBaseUrl = process.env.KEPLER_BASE_URL ?? "";
  const keplerPlanetToken = process.env.KEPLER_PLANET_TOKEN ?? "";
  ensureKeplerEnv(keplerBaseUrl, keplerPlanetToken);
  return createKeplerWorldClient(keplerBaseUrl, keplerPlanetToken, loggedKeplerFetch);
}

function ensureStarterModuleRuntimeStatus(module: HabitatModule): HabitatModule {
  if (module.blueprintId === "basic-battery" || module.displayName.toLowerCase().includes("battery")) {
    return {
      ...module,
      runtimeAttributes: {
        ...module.runtimeAttributes,
        status: "online",
      },
    };
  }

  if (!module.capabilities.includes("power-storage")) {
    return ensureDefaultModuleRuntimeStatus(module);
  }

  return ensureDefaultModuleRuntimeStatus(module);
}

function resolveModule(modules: HabitatModule[], selector: string): HabitatModule | null {
  return modules.find((module) => module.id === selector || module.selector === selector || module.blueprintId === selector) ?? null;
}

function makeUniqueSelector(identifier: string, modules: HabitatModule[]): string {
  const baseSelector = identifier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "module";
  const taken = new Set(modules.map((module) => module.selector));

  if (!taken.has(baseSelector)) {
    return baseSelector;
  }

  let suffix = 2;
  while (taken.has(`${baseSelector}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseSelector}-${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function loggedKeplerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET");
  const response = await fetch(input, init);
  console.log(`[kepler] ${method} ${new URL(requestUrl).pathname} -> ${response.status}`);
  return response;
}

function summarizeRoute(method: string, path: string, status: number): string {
  if (path === "/commands/register" && method === "POST" && status >= 200 && status < 300) {
    return "registered habitat";
  }

  if (path === "/commands/unregister" && method === "POST" && status >= 200 && status < 300) {
    return "unregistered habitat";
  }

  if (path === "/registration" && method === "GET") {
    return status === 200 ? "returned registration" : "registration missing";
  }

  if (path === "/modules" && method === "GET") {
    return "returned module list";
  }

  if (path.startsWith("/modules/") && method === "GET") {
    return "returned module";
  }

  if (path === "/inventory" && method === "GET") {
    return "returned inventory";
  }

  if (path === "/inventory/set" && method === "POST") {
    return "updated inventory";
  }

  if (path === "/inventory/add" && method === "POST") {
    return "added inventory";
  }

  if (path === "/catalog/blueprints" && method === "GET") {
    return "returned blueprints";
  }

  if (path.startsWith("/catalog/blueprints/") && method === "GET") {
    return "returned blueprint";
  }

  if (path === "/catalog/resources" && method === "GET") {
    return "returned resources";
  }

  if (path === "/solar/status" && method === "GET") {
    return "returned solar status";
  }

  if (path === "/world/scan" && method === "GET") {
    return "returned world scan";
  }

  return "completed";
}

function parseIntegerQuery(value: string | undefined, fieldName: string): number {
  if (value === undefined || !/^-?\d+$/.test(value)) {
    throw new Error(`${fieldName} must be an integer.`);
  }
  return Number(value);
}

function friendlyError(c: { json: (value: unknown, status?: number) => Response }, error: unknown): Response {
  const message = error instanceof Error ? error.message : "Unexpected backend error.";
  return c.json({ error: message }, 500);
}
