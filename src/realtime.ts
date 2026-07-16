import type { ServerWebSocket } from "bun";
import type { HabitatAlert, HabitatHuman, HabitatModule, KeplerRegistration } from "./types.js";

export type HabitatRealtimeSnapshot = {
  registration: KeplerRegistration | null;
  modules: HabitatModule[];
  humans: HabitatHuman[];
  solar: unknown;
  power: unknown;
  powerHistory: unknown[];
  alerts: HabitatAlert[];
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
