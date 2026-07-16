import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  HabitatAlert,
  HabitatHuman,
  HabitatModule,
  KeplerBlueprint,
  KeplerRegistration,
  KeplerRegistrationResponse,
  KeplerStarterModule,
} from "./types.js";
import { loadKeplerRegistration, setModuleStatus } from "./state.js";
import { clearLocalHabitatState, ensureKeplerEnv, ensureDefaultModuleRuntimeStatus, loadEvaState, saveEvaState, saveState } from "./state.js";
import { createKeplerCatalogClient } from "./kepler-catalog.js";
import { createKeplerWorldClient } from "./kepler-world.js";
import { addInventoryQuantity, loadInventoryState, saveInventoryState, setInventoryQuantity } from "./inventory-state.js";
import { advanceConstruction, cancelConstruction, loadConstructionState, saveConstructionState, startConstruction } from "./construction-state.js";
import { assertModuleCanBeDeleted, createHuman, deleteHuman, listHumans, moveHuman, updateHuman } from "./human-domain.js";
import { deployEva, dockEva, getEvaStatus, moveEva, type EvaSectorBounds, SUIT_BATTERY_PER_TICK, SUIT_OXYGEN_PER_TICK } from "./eva-domain.js";
import { applyTickWithSolarIrradiance, getModulePowerDraw } from "./formatters.js";
import { clearPowerHistory, loadPowerHistory, recordPowerHistory } from "./power-history.js";
import { createConstructedModule } from "./commands.js";
import { createOperationalAlert } from "./alerts-domain.js";
import { addRealtimeClient, broadcastRealtimeSnapshot, removeRealtimeClient, type HabitatRealtimeSnapshot } from "./realtime.js";

export const app = new Hono();

export function buildRealtimeSnapshot(): HabitatRealtimeSnapshot {
  const registration = loadKeplerRegistration();
  return {
    registration,
    modules: registration?.modules ?? [],
    humans: listHumans(),
    solar: null,
    power: null,
    powerHistory: loadPowerHistory(),
    alerts: registration?.alerts ?? [],
  };
}

export function broadcastCurrentSnapshot(): void {
  broadcastRealtimeSnapshot(buildRealtimeSnapshot());
}

function sendRealtimeSnapshot(client: Parameters<typeof addRealtimeClient>[0]): void {
  const snapshot = buildRealtimeSnapshot();
  client.send(JSON.stringify({ type: "snapshot", snapshot, emittedAt: new Date().toISOString() }));
}

app.use("*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  const routeSummary = summarizeRoute(c.req.method, c.req.path, c.res.status);
  console.log(`[habitat] ${c.req.method} ${c.req.path} -> ${c.res.status} ${routeSummary}`);
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

app.get("/ws", (c) => c.text("WebSocket upgrade required.", 426));

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

app.get("/humans", (c) => {
  try {
    return c.json({ humans: listHumans() });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 404);
  }
});

app.get("/eva/status", (c) => {
  try { return c.json({ eva: getEvaStatus() }); }
  catch (error) { return c.json({ error: (error as Error).message }, 404); }
});
app.post("/eva/deploy", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { humanId?: string } | null;
  if (!body?.humanId?.trim()) return c.json({ error: "humanId is required." }, 400);
  try { return c.json({ eva: deployEva(body.humanId.trim()) }); }
  catch (error) { return c.json({ error: (error as Error).message }, 409); }
});
app.post("/eva/move", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { x?: number; y?: number } | null;
  if (!Number.isFinite(body?.x) || !Number.isFinite(body?.y)) return c.json({ error: "x and y coordinates are required." }, 400);
  try {
    const registration = loadKeplerRegistration();
    if (!registration) return c.json({ error: "Habitat is not registered." }, 404);
    const sector = await createWorldClient().getCurrentSector(registration.habitatId);
    return c.json({ eva: moveEva(body!.x!, body!.y!, readSectorBounds(sector)) });
  }
  catch (error) { return c.json({ error: (error as Error).message }, 409); }
});
app.post("/eva/dock", (c) => {
  try { return c.json({ eva: dockEva() }); }
  catch (error) { return c.json({ error: (error as Error).message }, 409); }
});

app.post("/humans", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { displayName?: string; locationModuleId?: string } | null;
  if (!body?.displayName?.trim() || !body?.locationModuleId?.trim()) {
    return c.json({ error: "displayName and locationModuleId are required." }, 400);
  }

  try {
    const human = createHuman(body.displayName, body.locationModuleId);
    broadcastCurrentSnapshot();
    return c.json({ human }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 404);
  }
});

app.patch("/humans/:id", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Partial<Pick<HabitatHuman, "displayName" | "locationModuleId" | "status">> | null;
  try {
    const human = updateHuman(c.req.param("id"), body ?? {});
    broadcastCurrentSnapshot();
    return c.json({ human });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 404);
  }
});

app.delete("/humans/:id", (c) => {
  try {
    deleteHuman(c.req.param("id"));
    broadcastCurrentSnapshot();
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 404);
  }
});

app.post("/humans/:id/move", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { moduleId?: string } | null;
  if (!body?.moduleId?.trim()) {
    return c.json({ error: "moduleId is required." }, 400);
  }

  try {
    const human = moveHuman(c.req.param("id"), body.moduleId.trim());
    broadcastCurrentSnapshot();
    const module = loadKeplerRegistration()?.modules.find((entry) => entry.id === human.locationModuleId);
    return c.json({ human, moduleSelector: module?.selector ?? human.locationModuleId });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ error: message }, message.startsWith("Human not found:") || message.startsWith("Destination module not found:") ? 404 : 409);
  }
});

app.get("/alerts", (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  return c.json({ alerts: registration.alerts, contract: registration.contracts.alerts });
});

app.post("/alerts", async (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  const body = (await c.req.json().catch(() => null)) as Partial<HabitatAlert> | null;
  if (!body?.type?.trim() || !body?.severity?.trim() || !body?.message?.trim()) {
    return c.json({ error: "type, severity, and message are required." }, 400);
  }

  const now = new Date().toISOString();
  const alert: HabitatAlert = {
    id: randomUUID(),
    schemaVersion: registration.contracts.alerts.schemaVersion,
    type: body.type.trim(),
    severity: body.severity.trim(),
    status: body.status?.trim() || "open",
    source: body.source?.trim() || "habitat-local",
    message: body.message.trim(),
    createdAt: now,
    updatedAt: now,
    occurrenceCount: 1,
    details: body.details && typeof body.details === "object" ? body.details : {},
  };

  saveState({ ...registration, alerts: [...registration.alerts, alert] });
  broadcastCurrentSnapshot();
  return c.json({ alert }, 201);
});

app.patch("/alerts/:id", async (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  const currentAlert = registration.alerts.find((alert) => alert.id === c.req.param("id"));
  if (!currentAlert) {
    return c.json({ error: `Alert not found: ${c.req.param("id")}.` }, 404);
  }

  const body = (await c.req.json().catch(() => null)) as Partial<HabitatAlert> | null;
  const nextAlert: HabitatAlert = {
    ...currentAlert,
    type: body?.type?.trim() || currentAlert.type,
    severity: body?.severity?.trim() || currentAlert.severity,
    status: body?.status?.trim() || currentAlert.status,
    source: body?.source?.trim() || currentAlert.source,
    message: body?.message?.trim() || currentAlert.message,
    updatedAt: new Date().toISOString(),
    details: body?.details && typeof body.details === "object" ? body.details : currentAlert.details,
  };
  if (!["open", "acknowledged", "resolved"].includes(nextAlert.status)) {
    return c.json({ error: "Alert status must be open, acknowledged, or resolved." }, 400);
  }

  saveState({
    ...registration,
    alerts: registration.alerts.map((alert) => (alert.id === nextAlert.id ? nextAlert : alert)),
  });
  broadcastCurrentSnapshot();

  return c.json({ alert: nextAlert });
});

app.delete("/alerts/:id", (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  const nextAlerts = registration.alerts.filter((alert) => alert.id !== c.req.param("id"));
  if (nextAlerts.length === registration.alerts.length) {
    return c.json({ error: `Alert not found: ${c.req.param("id")}.` }, 404);
  }

  saveState({ ...registration, alerts: nextAlerts });
  broadcastCurrentSnapshot();
  return c.json({ ok: true });
});

app.get("/modules/:selector", (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  const module = resolveModule(registration.modules, c.req.param("selector"));

  if (!module) {
    return c.json({ error: `Module not found: ${c.req.param("selector")}.` }, 404);
  }

  const activeJob = loadConstructionState().activeJob;
  const isFabricator = activeJob !== null && (
    activeJob.fabricatorId === module.id ||
    activeJob.fabricatorSelector === module.selector ||
    activeJob.selector === module.selector
  );

  return c.json({ module, construction: isFabricator ? activeJob : null });
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
  broadcastCurrentSnapshot();
  return c.json({ module }, 201);
});

app.patch("/modules/:selector", async (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  const currentModule = resolveModule(registration.modules, c.req.param("selector"));
  if (!currentModule) {
    return c.json({ error: `Module not found: ${c.req.param("selector")}.` }, 404);
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
  broadcastCurrentSnapshot();

  return c.json({ module: nextModule });
});

app.delete("/modules/:selector", (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  const currentModule = resolveModule(registration.modules, c.req.param("selector"));
  if (!currentModule) {
    return c.json({ error: `Module not found: ${c.req.param("selector")}.` }, 404);
  }

  try {
    assertModuleCanBeDeleted(currentModule.id);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 409);
  }

  saveState({
    ...registration,
    modules: registration.modules.filter((module) => module.id !== currentModule.id),
  });
  broadcastCurrentSnapshot();

  return c.json({ ok: true });
});

app.patch("/modules/:selector/status", async (c) => {
  const registration = loadKeplerRegistration();

  if (!registration) {
    return c.json({ error: "Habitat is not registered." }, 404);
  }

  const currentModule = resolveModule(registration.modules, c.req.param("selector"));
  if (!currentModule) {
    return c.json({ error: `Module not found: ${c.req.param("selector")}.` }, 404);
  }

  const body = (await c.req.json().catch(() => null)) as { status?: string } | null;
  if (!body?.status) {
    return c.json({ error: "status is required." }, 400);
  }

  const validStatuses = new Set(["offline", "idle", "online", "active", "damaged"]);
  if (!validStatuses.has(body.status)) {
    return c.json({ error: "status must be offline, idle, online, active, or damaged." }, 400);
  }

  const nextRegistration = setModuleStatus(registration, currentModule.id, body.status);
  saveState(nextRegistration);
  broadcastCurrentSnapshot();

  return c.json({ module: nextRegistration.modules.find((module) => module.id === currentModule.id), modules: nextRegistration.modules });
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

  broadcastCurrentSnapshot();

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

  broadcastCurrentSnapshot();

  return c.json({ item });
});

app.post("/world/collect", async (c) => {
  try {
    const registration = loadKeplerRegistration();
    if (!registration) {
      return c.json({ error: "Habitat is not registered." }, 404);
    }

    const body = (await c.req.json().catch(() => null)) as { quantityKg?: number } | null;
    const eva = loadEvaState();
    if (!eva?.deployedHumanId) {
      return c.json({ error: "EVA is not deployed; deploy a human before collecting." }, 409);
    }
    if (eva.exhausted) return c.json({ error: "EVA is exhausted: the human did not return in time." }, 409);
    if (typeof body?.quantityKg !== "number" || !Number.isSafeInteger(body.quantityKg) || body.quantityKg <= 0) {
      return c.json({ error: "quantity-kg must be a positive whole number." }, 400);
    }
    const carriedKg = eva.carriedResources.reduce((total, resource) => total + resource.quantityKg, 0);
    if (carriedKg + body.quantityKg > eva.maxCarryingCapacityKg) {
      return c.json({ error: `Collection exceeds EVA carrying capacity: ${carriedKg} kg carried, ${eva.maxCarryingCapacityKg} kg maximum.` }, 409);
    }

    let collection: Record<string, unknown>;
    try {
      collection = await createWorldClient().collect({ habitatId: registration.habitatId, x: eva.x, y: eva.y, quantityKg: body.quantityKg });
    } catch (error) {
      createOperationalAlert({ type: "collection-failed", message: `Collection failed at (${eva.x}, ${eva.y}): ${(error as Error).message}`, details: { x: eva.x, y: eva.y, quantityKg: body.quantityKg } });
      throw error;
    }

    const resourceId = extractCollectedResourceId(collection);
    const collectedQuantityKg = extractCollectedQuantity(collection, body.quantityKg);
    if (!resourceId || collectedQuantityKg <= 0) {
      return c.json({ error: "Kepler collection succeeded without returning a material and quantity." }, 502);
    }
    const existingResource = eva.carriedResources.find((resource) => resource.resourceId === resourceId);
    saveEvaState({
      ...eva,
      carriedResources: existingResource
        ? eva.carriedResources.map((resource) => resource.resourceId === resourceId ? { ...resource, quantityKg: resource.quantityKg + collectedQuantityKg } : resource)
        : [...eva.carriedResources, { resourceId, quantityKg: collectedQuantityKg }],
    });
    if (carriedKg + collectedQuantityKg >= eva.maxCarryingCapacityKg) {
      createOperationalAlert({ type: "eva-carrying-capacity-reached", message: `EVA carrying capacity reached (${eva.maxCarryingCapacityKg} kg).`, subject: { type: "human", id: eva.deployedHumanId }, details: { capacityKg: eva.maxCarryingCapacityKg } });
    }

    return c.json(collection);
  } catch (error) {
    return friendlyError(c, error);
  }
});

function extractCollectedResourceId(collection: Record<string, unknown>): string | null {
  const direct = [collection.resourceId, collection.materialId, collection.collectedResource, collection.resourceName, collection.materialName];
  for (const value of direct) if (typeof value === "string" && value.trim()) return value;
  if (typeof collection.material === "string" && collection.material.trim()) return collection.material;
  if (typeof collection.resource === "string" && collection.resource.trim()) return collection.resource;
  for (const key of ["material", "resource", "collected", "collection", "result"]) {
    const nested = collection[key];
    if (isRecord(nested)) {
      const id = extractCollectedResourceId(nested);
      if (id) return id;
    }
  }
  for (const [key, value] of Object.entries(collection)) {
    if (typeof value === "string" && /(material|resource)/i.test(key) && value.trim()) return value;
    if (isRecord(value) && /(material|resource)/i.test(key)) {
      for (const nestedKey of ["id", "resourceId", "materialId", "name", "slug"]) {
        if (typeof value[nestedKey] === "string" && value[nestedKey].trim()) return value[nestedKey] as string;
      }
    }
    if (isRecord(value)) {
      const id = extractCollectedResourceId(value);
      if (id) return id;
    }
  }
  return null;
}

function extractCollectedQuantity(collection: Record<string, unknown>, requestedQuantityKg: number): number {
  for (const key of ["quantityKg", "collectedQuantityKg", "collectedQuantity", "amountKg", "collectedAmountKg", "quantity", "amount"]) {
    const value = collection[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  for (const key of ["material", "resource", "collected", "collection", "result"]) {
    const nested = collection[key];
    if (isRecord(nested)) {
      const quantity = extractCollectedQuantity(nested, requestedQuantityKg);
      if (quantity !== requestedQuantityKg) return quantity;
    }
  }
  for (const [key, value] of Object.entries(collection)) {
    if (typeof value === "number" && Number.isFinite(value) && /(quantity|amount|weight|mass)/i.test(key)) return value;
    if (isRecord(value)) {
      const quantity = extractCollectedQuantity(value, requestedQuantityKg);
      if (quantity !== requestedQuantityKg) return quantity;
    }
  }
  return requestedQuantityKg;
}

app.get("/world/sectors/current", async (c) => {
  try {
    const registration = loadKeplerRegistration();
    if (!registration) {
      return c.json({ error: "Habitat is not registered." }, 404);
    }

    const habitatId = c.req.query("habitatId") ?? registration.habitatId;
    const sector = await createWorldClient().getCurrentSector(habitatId);
    return c.json(sector);
  } catch (error) {
    return friendlyError(c, error);
  }
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
    broadcastCurrentSnapshot();

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
    clearPowerHistory();
    broadcastCurrentSnapshot();
    return c.json({ ok: true });
  } catch (error) {
    return friendlyError(c, error);
  }
});

app.post("/commands/tick", async (c) => {
  const registration = loadKeplerRegistration();
  if (!registration) return c.json({ error: "Habitat is not registered." }, 404);
  const body = (await c.req.json().catch(() => null)) as { ticks?: number } | null;
  if (!Number.isSafeInteger(body?.ticks) || body!.ticks! <= 0) {
    return c.json({ error: "ticks must be a positive whole number." }, 400);
  }

  try {
    const solarIrradiance = await createCatalogClient().getSolarIrradiance();
    const report = applyTickWithSolarIrradiance(registration, body!.ticks!, solarIrradiance);
    const construction = advanceConstruction(body!.ticks!);
    const completedModule = construction.completedJob ? createConstructedModule(report.registration, construction.completedJob) : null;
    const persistedRegistration = completedModule ? { ...report.registration, modules: [...report.registration.modules, completedModule] } : report.registration;
    const eva = getEvaStatus();
    if (eva.deployedHumanId && !eva.exhausted) {
      const suitBattery = Math.max(0, eva.suitBattery - body!.ticks! * SUIT_BATTERY_PER_TICK);
      const suitOxygen = Math.max(0, eva.suitOxygen - body!.ticks! * SUIT_OXYGEN_PER_TICK);
      const exhausted = suitBattery <= 0 || suitOxygen <= 0;
      const nextEva = { ...eva, suitBattery, suitOxygen, estimatedTicksRemaining: Math.min(Math.ceil(suitBattery / SUIT_BATTERY_PER_TICK), Math.ceil(suitOxygen / SUIT_OXYGEN_PER_TICK)), exhausted };
      const alerts = [...persistedRegistration.alerts];
      if ((suitBattery <= eva.maxSuitBattery * 0.25 || suitOxygen <= eva.maxSuitOxygen * 0.25) && !alerts.some((alert) => alert.id === `eva-low-${eva.deployedHumanId}`)) alerts.push({ id: `eva-low-${eva.deployedHumanId}`, schemaVersion: persistedRegistration.contracts.alerts.schemaVersion, type: "eva-resource-low", severity: "warning", status: "open", source: "habitat-local", message: `EVA suit resources are low: battery ${suitBattery}/${eva.maxSuitBattery}, oxygen ${suitOxygen}/${eva.maxSuitOxygen}.`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), occurrenceCount: 1, subject: { type: "human", id: eva.deployedHumanId }, details: { suitBattery, suitOxygen } });
      if (exhausted && !alerts.some((alert) => alert.id === `eva-exhausted-${eva.deployedHumanId}`)) alerts.push({ id: `eva-exhausted-${eva.deployedHumanId}`, schemaVersion: persistedRegistration.contracts.alerts.schemaVersion, type: "eva-resource-exhausted", severity: "critical", status: "open", source: "habitat-local", message: "EVA exhausted: the human did not return in time.", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), occurrenceCount: 1, subject: { type: "human", id: eva.deployedHumanId }, details: { suitBattery, suitOxygen } });
      saveState({ ...persistedRegistration, alerts }, nextEva);
    } else {
      saveState(persistedRegistration);
    }
    broadcastCurrentSnapshot();
    return c.json({ ticks: body!.ticks, registration: persistedRegistration, construction, completedModule, totalPowerDraw: report.totalPowerDraw, totalSolarGeneration: report.totalSolarGeneration, batteryBefore: report.batteryBefore, batteryAfter: report.batteryAfter, solarChargeReason: report.solarChargeReason });
  } catch (error) {
    return friendlyError(c, error);
  }
});

app.post("/commands/construct", async (c) => {
  const registration = loadKeplerRegistration();
  if (!registration) return c.json({ error: "Habitat is not registered." }, 404);
  const body = (await c.req.json().catch(() => null)) as { blueprintId?: string; dryRun?: boolean } | null;
  const blueprint = registration.blueprints.find((candidate) => candidate.blueprintId === body?.blueprintId);
  if (!blueprint) return c.json({ error: `Blueprint not found: ${body?.blueprintId ?? ""}.` }, 404);
  const result = startConstruction({ blueprint, modules: registration.modules, dryRun: body?.dryRun ?? false });
  if (result.startedJob?.ticksRemaining === 0) {
    const completedModule = createConstructedModule(registration, result.startedJob);
    saveState({ ...registration, modules: [...registration.modules, completedModule] });
    saveConstructionState({ activeJob: null });
    broadcastCurrentSnapshot();
    return c.json({ ...result, completedModule });
  }
  if (result.startedJob) broadcastCurrentSnapshot();
  return c.json(result);
});

app.get("/construction/status", (c) => c.json({ construction: loadConstructionState() }));

app.post("/construction/cancel", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { selector?: string } | null;
  const activeJob = loadConstructionState().activeJob;
  const selector = body?.selector?.trim() || activeJob?.fabricatorSelector || activeJob?.fabricatorId || activeJob?.selector;
  if (!selector) return c.json({ error: "No active construction job to cancel." }, 409);
  const result = cancelConstruction(selector);
  if (!result.canceledJob) return c.json({ error: `No active construction job matches ${selector}.` }, 404);
  broadcastCurrentSnapshot();
  return c.json({ canceledJob: result.canceledJob });
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
    return c.json({ error: `Blueprint not found in the Kepler catalog: ${c.req.param("blueprintId")}.` }, 404);
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

app.get("/power/overview", async (c) => {
  const registration = loadKeplerRegistration();
  if (!registration) return c.json({ error: "Habitat is not registered." }, 404);
  try {
    const solarIrradiance = await createCatalogClient().getSolarIrradiance();
    const report = applyTickWithSolarIrradiance(registration, 3600, solarIrradiance);
    recordPowerHistory({ recordedAt: new Date().toISOString(), generationKw: report.totalSolarGeneration, consumptionKw: report.totalPowerDraw, netKw: report.totalSolarGeneration - report.totalPowerDraw, modules: registration.modules.map((module) => ({ selector: module.selector, displayName: module.displayName, powerKw: getModulePowerDraw(module) })) });
    return c.json({ generationKw: report.totalSolarGeneration, consumptionKw: report.totalPowerDraw, netKw: report.totalSolarGeneration - report.totalPowerDraw, solarIrradiance });
  } catch (error) {
    return friendlyError(c, error);
  }
});

app.get("/power/history", (c) => c.json({ history: loadPowerHistory(Number(c.req.query("limit") ?? 120)) }));

app.get("/world/scan", async (c) => {
  try {
    const registration = loadKeplerRegistration();
    if (!registration) {
      return c.json({ error: "Habitat is not registered." }, 404);
    }

    const query = c.req.query();
    let x: number;
    let y: number;
    let sensorStrength: number;
    let radiusTiles: number;

    try {
      const eva = loadEvaState();
      if (!eva?.deployedHumanId) throw new Error("EVA is not deployed; deploy a human before scanning.");
      if (eva.exhausted) throw new Error("EVA is exhausted: the human did not return in time.");
      x = eva.x;
      y = eva.y;
      sensorStrength = parseIntegerQuery(query.strength ?? query.sensorStrength, "sensor strength");
      radiusTiles = parseIntegerQuery(query.radius ?? query.radiusTiles ?? "0", "radius");
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid scan parameters." }, 400);
    }

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

const dashboardRoutes = new Set(["/", "/dashboard", "/modules", "/humans", "/weather", "/reports", "/settings"]);
const dashboardDistDirectory = path.resolve(process.env.HABITAT_DIST_DIRECTORY ?? "dist");

app.get("/", () => serveDashboardEntry());

app.get("/assets/*", async (c) => {
  const file = Bun.file(path.join(dashboardDistDirectory, c.req.path.slice(1)));
  if (!(await file.exists())) return c.notFound();
  return new Response(await file.arrayBuffer(), { headers: { "Content-Type": contentTypeForPath(c.req.path) } });
});

app.get("*", async (c) => {
  if (!dashboardRoutes.has(c.req.path)) return c.notFound();
  return serveDashboardEntry();
});

async function serveDashboardEntry(): Promise<Response> {
  const file = Bun.file(path.join(dashboardDistDirectory, "index.html"));
  if (!(await file.exists())) return new Response("Dashboard build is unavailable.\n", { status: 503 });
  return new Response(file, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
}

const host = process.env.HABITAT_API_HOST ?? "127.0.0.1";
const port = Number(process.env.HABITAT_API_PORT ?? 8787);

if (import.meta.main) {
  console.log(`Habitat backend listening on http://${host}:${port}`);

  Bun.serve({
    hostname: host,
    port,
    fetch(request, server) {
      if (new URL(request.url).pathname === "/ws" && server.upgrade(request)) {
        return undefined;
      }
      return app.fetch(request);
    },
    websocket: {
      open(client) {
        addRealtimeClient(client);
        sendRealtimeSnapshot(client);
      },
      message() {},
      close(client) {
        removeRealtimeClient(client);
      },
    },
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

  const payload = (await response.json()) as KeplerRegistrationResponse;

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
      ensureStarterModuleRuntimeStatus({
        id: starterModule.id,
        selector: getStarterModuleSelector(starterModule, index, payload.starterModules),
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
    humans: (payload.starterHumans ?? []).map((human) => ({
      id: human.id,
      displayName: human.displayName,
      locationModuleId: human.locationModuleId,
      status: "present",
    })),
    alerts: [],
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

function getStarterModuleSelector(
  starterModule: KeplerStarterModule,
  index: number,
  starterModules: KeplerStarterModule[],
): string {
  const base = starterModule.blueprintId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "module";
  const occurrence = starterModules.slice(0, index + 1).filter((module) => module.blueprintId === starterModule.blueprintId).length;
  return `${base}-${occurrence}`;
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

function readSectorBounds(payload: Record<string, unknown>): EvaSectorBounds | undefined {
  const candidates = [payload, isRecord(payload.sector) ? payload.sector : null, isRecord(payload.bounds) ? payload.bounds : null];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const minX = candidate.minX ?? candidate.xMin;
    const maxX = candidate.maxX ?? candidate.xMax;
    const minY = candidate.minY ?? candidate.yMin;
    const maxY = candidate.maxY ?? candidate.yMax;
    if ([minX, maxX, minY, maxY].every((value) => typeof value === "number" && Number.isFinite(value))) {
      return { minX: minX as number, maxX: maxX as number, minY: minY as number, maxY: maxY as number };
    }
  }
  return undefined;
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

function contentTypeForPath(path: string): string {
  if (path.endsWith(".css")) return "text/css; charset=UTF-8";
  if (path.endsWith(".js")) return "application/javascript; charset=UTF-8";
  return "application/octet-stream";
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
