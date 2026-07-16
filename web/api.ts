export type Registration = {
  displayName: string;
  habitat?: { displayName?: string; status?: string };
  modules: Array<{ id: string; selector: string; blueprintId: string; displayName: string; connectedTo: string[]; capabilities: string[]; runtimeAttributes: Record<string, unknown>; statusOptions?: string[] }>;
};

export type SolarStatus = { solarIrradiance: { wPerM2: number; condition?: string } };
export type PowerOverview = SolarStatus & { generationKw: number; consumptionKw: number; netKw: number };
export type PowerHistoryPoint = { recordedAt: string; generationKw: number; consumptionKw: number; netKw: number; modules: Array<{ selector: string; displayName: string; powerKw: number }> };
export type ClockStatus = {
  mode: "manual" | "kepler";
  listening: boolean;
  manualTicksAllowed: boolean;
  connectionStatus: "disconnected" | "connecting" | "connected" | "error";
  latestAbsoluteTick: number | null;
  latestAdvancedBy: number | null;
  lastConnectionAt: string | null;
  lastMessageAt: string | null;
  latestError: string | null;
};
export type HabitatRealtimeSnapshot = { registration: Registration | null; modules: Registration["modules"]; humans: Human[]; solar: SolarStatus | null; power: PowerOverview | null; powerHistory: PowerHistoryPoint[]; alerts: Array<Record<string, unknown>>; clock?: ClockStatus | null };
export type Human = { id: string; displayName: string; locationModuleId: string; status: string };
export type EvaResource = { resourceId: string; quantityKg: number };
export type EvaStatus = { deployedHumanId: string | null; x: number; y: number; carriedResources: EvaResource[]; maxCarryingCapacityKg: number; suitBattery: number; maxSuitBattery: number; suitOxygen: number; maxSuitOxygen: number; estimatedTicksRemaining: number; exhausted: boolean };
export type ResourceScan = { tiles?: Array<{ x: number; y: number; terrain?: string; probabilities?: Array<{ resourceType: string | null; probabilityPct: number }>; topCandidate?: { resourceType: string | null; probabilityPct: number }; quantityEstimate?: { resourceType?: string; estimatedKg?: number; minimumKg?: number; maximumKg?: number } | null }>; [key: string]: unknown };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`);
  return body as T;
}

function isNotRegistered(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("not registered");
}

export async function loadDashboardSnapshot(): Promise<HabitatRealtimeSnapshot> {
  const results = await Promise.allSettled([
    habitatApi.registration(),
    habitatApi.modules(),
    habitatApi.humans(),
    habitatApi.solar(),
    habitatApi.power(),
    habitatApi.powerHistory(),
    habitatApi.alerts(),
    habitatApi.clockStatus(),
  ]);
  const [registrationResult, modulesResult, humansResult, solarResult, powerResult, historyResult, alertsResult, clockResult] = results;
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<unknown> => result.status === "fulfilled");
  if (!fulfilled.length && !results.some((result) => result.status === "rejected" && isNotRegistered(result.reason))) {
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    throw failure?.reason instanceof Error ? failure.reason : new Error("Unable to load dashboard state.");
  }

  const registration = registrationResult.status === "fulfilled" ? registrationResult.value : null;
  return {
    registration,
    modules: modulesResult.status === "fulfilled" ? modulesResult.value.modules : registration?.modules ?? [],
    humans: humansResult.status === "fulfilled" ? humansResult.value.humans : [],
    solar: solarResult.status === "fulfilled" ? solarResult.value : null,
    power: powerResult.status === "fulfilled" ? powerResult.value : null,
    powerHistory: historyResult.status === "fulfilled" ? historyResult.value.history : [],
    alerts: alertsResult.status === "fulfilled" ? alertsResult.value.alerts ?? [] : [],
    clock: clockResult.status === "fulfilled" ? clockResult.value : null,
  };
}

export const habitatApi = {
  registration: () => request<Registration>("/registration"),
  modules: () => request<{ modules: Registration["modules"] }>("/modules"),
  humans: () => request<{ humans: Human[] }>("/humans"),
  moveHuman: (humanId: string, moduleId: string) => request<{ human: Human }>(`/humans/${encodeURIComponent(humanId)}/move`, { method: "POST", body: JSON.stringify({ moduleId }) }),
  evaStatus: () => request<{ eva: EvaStatus }>("/eva/status"),
  deployEva: (humanId: string) => request<{ eva: EvaStatus }>("/eva/deploy", { method: "POST", body: JSON.stringify({ humanId }) }),
  moveEva: (x: number, y: number) => request<{ eva: EvaStatus }>("/eva/move", { method: "POST", body: JSON.stringify({ x, y }) }),
  scan: async (strength: number, radius: number) => { const result = await request<ResourceScan>(`/world/scan?strength=${strength}&radius=${radius}`); window.dispatchEvent(new CustomEvent("habitat-scan-result", { detail: { result, strength, radius } })); return result; },
  collect: (quantityKg: number) => request<Record<string, unknown>>("/world/collect", { method: "POST", body: JSON.stringify({ quantityKg }) }),
  dockEva: () => request<{ eva: EvaStatus }>("/eva/dock", { method: "POST" }),
  module: (selector: string) => request<{ module: Registration["modules"][number]; construction: Record<string, unknown> | null }>(`/modules/${encodeURIComponent(selector)}`),
  solar: () => request<SolarStatus>("/solar/status"),
  power: () => request<PowerOverview>("/power/overview"),
  powerHistory: (limit = 120) => request<{ history: PowerHistoryPoint[] }>(`/power/history?limit=${limit}`),
  clockStatus: () => request<ClockStatus>("/clock/status"),
  listenToClock: () => request<ClockStatus>("/clock/listen/on", { method: "POST" }),
  stopClock: () => request<ClockStatus>("/clock/listen/off", { method: "POST" }),
  setModuleStatus: (selector: string, status: string) => request<{ module: Registration["modules"][number] }>(`/modules/${encodeURIComponent(selector)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  tick: (ticks: number) => request<{ registration: Registration }>("/commands/tick", { method: "POST", body: JSON.stringify({ ticks }) }),
  register: (name: string) => request<{ registration: Registration }>("/commands/register", { method: "POST", body: JSON.stringify({ name }) }),
  unregister: () => request<{ ok: true }>("/commands/unregister", { method: "POST" }),
  alerts: () => request<{ alerts: Array<Record<string, unknown>> }>("/alerts"),
  createAlert: (alert: { type: string; severity: string; source: string; message: string }) => request<{ alert: Record<string, unknown> }>("/alerts", { method: "POST", body: JSON.stringify(alert) }),
};
