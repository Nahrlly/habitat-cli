import type { ServerWebSocket } from "bun";
import type { HabitatAlert, HabitatClockState, HabitatHuman, HabitatModule, KeplerRegistration } from "./types.js";
import type { KeplerSolarIrradiance } from "./kepler-catalog.js";
import type { PowerHistoryPoint } from "./power-history.js";

export type SolarStatusResponse = {
  solarIrradiance: KeplerSolarIrradiance;
};

export type PowerOverviewResponse = {
  generationKw: number;
  consumptionKw: number;
  netKw: number;
  solarIrradiance: KeplerSolarIrradiance;
};

export type PowerHistoryResponse = {
  history: PowerHistoryPoint[];
};

export type HabitatRealtimeSnapshot = {
  registration: KeplerRegistration | null;
  modules: HabitatModule[];
  humans: HabitatHuman[];
  solar: SolarStatusResponse | null;
  power: PowerOverviewResponse | null;
  powerHistory: PowerHistoryPoint[];
  alerts: HabitatAlert[];
  clock: HabitatClockState | null;
};

export type HabitatRealtimeEvent =
  | { type: "snapshot"; snapshot: HabitatRealtimeSnapshot; emittedAt: string }
  | { type: "error"; message: string };

const clients = new Set<ServerWebSocket<unknown>>();
let snapshotQueue = Promise.resolve();

export function addRealtimeClient(client: ServerWebSocket<unknown>): void {
  clients.add(client);
}

export function removeRealtimeClient(client: ServerWebSocket<unknown>): void {
  clients.delete(client);
}

export function broadcastRealtimeSnapshot(
  snapshot: HabitatRealtimeSnapshot,
  emittedAt = new Date().toISOString(),
): void {
  const message = JSON.stringify({ type: "snapshot", snapshot, emittedAt } satisfies HabitatRealtimeEvent);

  for (const client of clients) {
    try {
      client.send(message);
    } catch {
      clients.delete(client);
    }
  }
}

export function enqueueRealtimeSnapshot(
  buildSnapshot: () => Promise<HabitatRealtimeSnapshot>,
  target?: ServerWebSocket<unknown>,
): Promise<void> {
  const delivery = snapshotQueue.then(async () => {
    const snapshot = await buildSnapshot();
    const message = JSON.stringify({ type: "snapshot", snapshot, emittedAt: new Date().toISOString() } satisfies HabitatRealtimeEvent);
    const recipients = target ? [target] : [...clients];
    for (const client of recipients) {
      try {
        client.send(message);
      } catch {
        clients.delete(client);
      }
    }
  });
  snapshotQueue = delivery.catch(() => undefined);
  return delivery;
}
