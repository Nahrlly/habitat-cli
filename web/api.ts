export type Registration = {
  displayName: string;
  habitat?: { displayName?: string; status?: string };
  modules: Array<{ id: string; selector: string; blueprintId: string; displayName: string; connectedTo: string[]; capabilities: string[]; runtimeAttributes: Record<string, unknown> }>;
};

export type SolarStatus = { solarIrradiance: { wPerM2: number; condition?: string } };
export type PowerOverview = SolarStatus & { generationKw: number; consumptionKw: number; netKw: number };
export type Human = { id: string; displayName: string; locationModuleId: string; status: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`);
  return body as T;
}

export const habitatApi = {
  registration: () => request<Registration>("/registration"),
  modules: () => request<{ modules: Registration["modules"] }>("/modules"),
  humans: () => request<{ humans: Human[] }>("/humans"),
  module: (selector: string) => request<{ module: Registration["modules"][number]; construction: Record<string, unknown> | null }>(`/modules/${encodeURIComponent(selector)}`),
  solar: () => request<SolarStatus>("/solar/status"),
  power: () => request<PowerOverview>("/power/overview"),
  powerHistory: (limit = 120) => request<{ history: Array<{ recordedAt: string; generationKw: number; consumptionKw: number; netKw: number; modules: Array<{ selector: string; displayName: string; powerKw: number }> }> }>(`/power/history?limit=${limit}`),
  setModuleStatus: (selector: string, status: string) => request<{ module: Registration["modules"][number] }>(`/modules/${encodeURIComponent(selector)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  tick: (ticks: number) => request<{ registration: Registration }>("/commands/tick", { method: "POST", body: JSON.stringify({ ticks }) }),
  register: (name: string) => request<{ registration: Registration }>("/commands/register", { method: "POST", body: JSON.stringify({ name }) }),
  unregister: () => request<{ ok: true }>("/commands/unregister", { method: "POST" }),
  alerts: () => request<{ alerts: Array<Record<string, unknown>> }>("/alerts"),
  createAlert: (alert: { type: string; severity: string; source: string; message: string }) => request<{ alert: Record<string, unknown> }>("/alerts", { method: "POST", body: JSON.stringify(alert) }),
};
