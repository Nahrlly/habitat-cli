import { KeplerClockClient, type KeplerClockClientOptions, type KeplerClockTick } from "./kepler-clock.js";
import { loadClockState, updateClockState } from "./clock-state.js";
import { toClockStatusJson, type HabitatClockEvent, type HabitatClockStatusJson } from "./clock-formatters.js";
import { loadKeplerRegistration } from "./state.js";

export type ClockClient = Pick<KeplerClockClient, "start" | "stop">;
export type ClockClientFactory = (options: KeplerClockClientOptions) => ClockClient;
export type ClockEventListener = (event: HabitatClockEvent) => void;

export type ClockEventManagerOptions = {
  createClient?: ClockClientFactory;
  applyTick: (advancedBy: number) => Promise<void>;
  broadcast: () => Promise<void>;
  now?: () => string;
};

export class ClockEventManager {
  private createClient: ClockClientFactory;
  private applyTick: (advancedBy: number) => Promise<void>;
  private broadcast: () => Promise<void>;
  private now: () => string;
  private readonly listeners = new Set<ClockEventListener>();
  private client: ClockClient | null = null;
  private tickQueue = Promise.resolve();

  constructor(options: ClockEventManagerOptions) {
    this.createClient = options.createClient ?? ((clientOptions) => new KeplerClockClient(clientOptions));
    this.applyTick = options.applyTick;
    this.broadcast = options.broadcast;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  start(): void {
    const state = loadClockState();
    if (!state.listening) return;

    if (!loadKeplerRegistration()) {
      updateClockState({
        mode: "kepler",
        connectionStatus: "error",
        latestError: "Cannot connect the Kepler clock because this habitat is not registered.",
      });
      return;
    }

    updateClockState({ mode: "kepler", connectionStatus: "connecting", latestError: null });
    this.connect();
  }

  async listenOn(): Promise<HabitatClockStatusJson> {
    if (!loadKeplerRegistration()) {
      throw new Error("Cannot enable the Kepler clock because this habitat is not registered.");
    }

    const state = loadClockState();
    if (state.listening && this.client) return toClockStatusJson(state);

    updateClockState({
      mode: "kepler",
      listening: true,
      connectionStatus: "connecting",
      latestError: null,
    });
    this.connect();
    return toClockStatusJson(loadClockState());
  }

  async listenOff(): Promise<HabitatClockStatusJson> {
    const client = this.client;
    this.client = null;
    client?.stop();

    await this.tickQueue;
    return toClockStatusJson(updateClockState({
      mode: "manual",
      listening: false,
      connectionStatus: "disconnected",
      latestError: null,
    }));
  }

  getStatus(): HabitatClockStatusJson {
    return toClockStatusJson(loadClockState());
  }

  subscribe(listener: ClockEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async resetForTests(): Promise<void> {
    await this.listenOff();
    this.listeners.clear();
    this.createClient = (clientOptions) => new KeplerClockClient(clientOptions);
    this.tickQueue = Promise.resolve();
  }

  configureForTests(options: ClockEventManagerOptions): void {
    this.createClient = options.createClient ?? ((clientOptions) => new KeplerClockClient(clientOptions));
    this.applyTick = options.applyTick;
    this.broadcast = options.broadcast;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async waitForIdleForTests(): Promise<void> {
    await this.tickQueue;
  }

  private connect(): void {
    if (this.client) return;
    const registration = loadKeplerRegistration();
    if (!registration) return;

    let client: ClockClient;
    try {
      client = this.createClient({
        registration,
        clockState: loadClockState(),
        onTick: (tick) => {
          if (this.client === client) this.enqueueTick(tick);
        },
        onStatusChange: (status) => {
          if (this.client !== client) return;
          const update = status === "connected"
            ? { connectionStatus: status, lastConnectionAt: this.now(), latestError: null }
            : { connectionStatus: status };
          updateClockState(update);
        },
        onError: (error) => {
          if (this.client !== client) return;
          updateClockState({ connectionStatus: "error", latestError: error.message });
        },
      });
    } catch (error) {
      updateClockState({ connectionStatus: "error", latestError: error instanceof Error ? error.message : String(error) });
      return;
    }

    this.client = client;
    try {
      client.start();
    } catch (error) {
      updateClockState({ connectionStatus: "error", latestError: error instanceof Error ? error.message : String(error) });
    }
  }

  private enqueueTick(tick: KeplerClockTick): void {
    const operation = this.tickQueue.then(() => this.applyAcceptedTick(tick));
    this.tickQueue = operation.catch(() => undefined);
    void operation.catch(() => undefined);
  }

  private async applyAcceptedTick(tick: KeplerClockTick): Promise<void> {
    const receivedAt = this.now();
    const issuedAt = tick.issuedAt ?? receivedAt;
    let applied = false;
    let error: string | null = null;

    try {
      await this.applyTick(tick.advancedBy);
      applied = true;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    updateClockState({
      latestAbsoluteTick: tick.absoluteTick,
      latestAdvancedBy: tick.advancedBy,
      lastMessageAt: receivedAt,
      latestError: error,
    });
    await this.broadcast();

    const event: HabitatClockEvent = {
      absoluteTick: tick.absoluteTick,
      advancedBy: tick.advancedBy,
      issuedAt,
      receivedAt,
      applied,
      error,
    };
    for (const listener of this.listeners) listener(event);
  }
}
