import type { ClockStatus, HabitatRealtimeSnapshot } from "./api";

export type RealtimeConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export type RealtimeSocket = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  close: () => void;
};

export type RealtimeClientOptions = {
  createSocket?: (url: string) => RealtimeSocket;
  onSnapshot: (snapshot: HabitatRealtimeSnapshot) => void;
  onStateChange: (state: RealtimeConnectionState) => void;
  initialReconnectMs?: number;
  maxReconnectMs?: number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
};

type LocationLike = { protocol: string; host: string };
type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export function buildRealtimeUrl(location: LocationLike = globalThis.location): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isModule(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.selector === "string"
    && typeof value.blueprintId === "string"
    && typeof value.displayName === "string"
    && Array.isArray(value.connectedTo)
    && value.connectedTo.every((entry) => typeof entry === "string")
    && Array.isArray(value.capabilities)
    && value.capabilities.every((entry) => typeof entry === "string")
    && isRecord(value.runtimeAttributes)
    && (value.statusOptions === undefined || (Array.isArray(value.statusOptions) && value.statusOptions.every((entry) => typeof entry === "string")));
}

function isHuman(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.displayName === "string"
    && typeof value.locationModuleId === "string"
    && typeof value.status === "string";
}

function isSolar(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.solarIrradiance)) return false;
  return typeof value.solarIrradiance.wPerM2 === "number"
    && (value.solarIrradiance.condition === undefined || typeof value.solarIrradiance.condition === "string");
}

function isPower(value: unknown): boolean {
  return isSolar(value)
    && isRecord(value)
    && typeof value.generationKw === "number"
    && typeof value.consumptionKw === "number"
    && typeof value.netKw === "number";
}

function isPowerHistoryPoint(value: unknown): boolean {
  if (!isRecord(value) || typeof value.recordedAt !== "string") return false;
  if (typeof value.generationKw !== "number" || typeof value.consumptionKw !== "number" || typeof value.netKw !== "number") return false;
  return Array.isArray(value.modules) && value.modules.every((module) => {
    if (!isRecord(module)) return false;
    return typeof module.selector === "string" && typeof module.displayName === "string" && typeof module.powerKw === "number";
  });
}

function isRegistration(value: unknown): boolean {
  return isRecord(value)
    && typeof value.displayName === "string"
    && Array.isArray(value.modules)
    && value.modules.every(isModule);
}

function isClockStatus(value: unknown): value is ClockStatus {
  if (!isRecord(value)) return false;
  return (value.mode === "manual" || value.mode === "kepler")
    && typeof value.listening === "boolean"
    && typeof value.manualTicksAllowed === "boolean"
    && (value.connectionStatus === "disconnected" || value.connectionStatus === "connecting" || value.connectionStatus === "connected" || value.connectionStatus === "error")
    && (value.latestAbsoluteTick === null || typeof value.latestAbsoluteTick === "number")
    && (value.latestAdvancedBy === null || typeof value.latestAdvancedBy === "number")
    && (value.lastConnectionAt === null || typeof value.lastConnectionAt === "string")
    && (value.lastMessageAt === null || typeof value.lastMessageAt === "string")
    && (value.latestError === null || typeof value.latestError === "string");
}

export function isHabitatRealtimeSnapshot(value: unknown): value is HabitatRealtimeSnapshot {
  if (!isRecord(value)) return false;
  return (value.registration === null || isRegistration(value.registration))
    && Array.isArray(value.modules)
    && value.modules.every(isModule)
    && Array.isArray(value.humans)
    && value.humans.every(isHuman)
    && (value.solar === null || isSolar(value.solar))
    && (value.power === null || isPower(value.power))
    && Array.isArray(value.powerHistory)
    && value.powerHistory.every(isPowerHistoryPoint)
    && Array.isArray(value.alerts)
    && value.alerts.every(isRecord)
    && (value.clock === undefined || value.clock === null || isClockStatus(value.clock));
}

export type HabitatRealtimeEvent = {
  type: "snapshot";
  snapshot: HabitatRealtimeSnapshot;
  emittedAt: string;
};

export function parseRealtimeEvent(value: unknown): HabitatRealtimeEvent | null {
  if (typeof value !== "string") return null;
  try {
    const event: unknown = JSON.parse(value);
    if (!isRecord(event) || event.type !== "snapshot" || typeof event.emittedAt !== "string" || !isHabitatRealtimeSnapshot(event.snapshot)) return null;
    return event as HabitatRealtimeEvent;
  } catch {
    return null;
  }
}

function defaultSocketFactory(url: string): RealtimeSocket {
  return new globalThis.WebSocket(url) as unknown as RealtimeSocket;
}

export class HabitatRealtimeClient {
  private socket: RealtimeSocket | null = null;
  private retryTimer: TimerHandle | null = null;
  private retryAttempt = 0;
  private started = false;
  private readonly createSocket: (url: string) => RealtimeSocket;
  private readonly setTimer: typeof globalThis.setTimeout;
  private readonly clearTimer: typeof globalThis.clearTimeout;
  private readonly initialReconnectMs: number;
  private readonly maxReconnectMs: number;

  constructor(private readonly url: string, private readonly options: RealtimeClientOptions) {
    this.createSocket = options.createSocket ?? defaultSocketFactory;
    this.setTimer = options.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimer = options.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
    this.initialReconnectMs = Math.max(1, options.initialReconnectMs ?? 250);
    this.maxReconnectMs = Math.max(this.initialReconnectMs, options.maxReconnectMs ?? 10_000);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.options.onStateChange("connecting");
    this.openSocket();
  }

  stop(): void {
    this.started = false;
    if (this.retryTimer !== null) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }
    this.options.onStateChange("offline");
  }

  private openSocket(): void {
    if (!this.started) return;
    let socket: RealtimeSocket;
    try {
      socket = this.createSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket || !this.started) return;
      this.retryAttempt = 0;
      this.options.onStateChange("connected");
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || !this.started) return;
      const parsed = parseRealtimeEvent(event.data);
      if (parsed) this.options.onSnapshot(parsed.snapshot);
    };
    socket.onerror = () => {
      if (this.socket === socket && this.started) this.options.onStateChange("reconnecting");
    };
    socket.onclose = () => {
      if (this.socket !== socket || !this.started) return;
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.started || this.retryTimer !== null) return;
    const delay = Math.min(this.maxReconnectMs, this.initialReconnectMs * (2 ** this.retryAttempt));
    this.retryAttempt += 1;
    this.options.onStateChange("reconnecting");
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      if (!this.started) return;
      this.options.onStateChange("connecting");
      this.openSocket();
    }, delay);
  }
}
