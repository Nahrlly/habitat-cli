import type { HabitatClockConnectionStatus, HabitatClockState, KeplerRegistration } from "./types.js";

export type KeplerClockSocket = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: (() => void) | null;
  send(message: string): void;
  close(code?: number, reason?: string): void;
};

export type KeplerClockTick = {
  type: "planet_tick";
  habitatId?: string;
  previousTick?: number;
  absoluteTick: number;
  advancedBy: number;
  issuedAt?: string;
};

export type KeplerClockClientOptions = {
  registration: Pick<KeplerRegistration, "habitatId" | "streamUrl" | "apiToken">;
  clockState?: Pick<HabitatClockState, "latestAbsoluteTick">;
  webSocketFactory?: (url: string) => KeplerClockSocket;
  reconnectDelaysMs?: readonly number[];
  onTick?: (tick: KeplerClockTick) => void;
  onStatusChange?: (status: HabitatClockConnectionStatus) => void;
  onError?: (error: Error) => void;
};

const defaultReconnectDelaysMs = [1_000, 2_000, 5_000, 10_000] as const;

export class KeplerClockClient {
  private readonly registration: KeplerClockClientOptions["registration"];
  private readonly webSocketFactory: (url: string) => KeplerClockSocket;
  private readonly reconnectDelaysMs: readonly number[];
  private readonly onTick?: (tick: KeplerClockTick) => void;
  private readonly onStatusChange?: (status: HabitatClockConnectionStatus) => void;
  private readonly onError?: (error: Error) => void;
  private socket: KeplerClockSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private lastAbsoluteTick: number | null;
  private running = false;
  private awaitingHelloAck = false;
  private status: HabitatClockConnectionStatus = "disconnected";

  constructor(options: KeplerClockClientOptions) {
    this.registration = options.registration;
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.reconnectDelaysMs = options.reconnectDelaysMs?.length ? options.reconnectDelaysMs : defaultReconnectDelaysMs;
    this.onTick = options.onTick;
    this.onStatusChange = options.onStatusChange;
    this.onError = options.onError;
    this.lastAbsoluteTick = options.clockState?.latestAbsoluteTick ?? null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    if (!this.running && !this.socket && !this.reconnectTimer) return;
    this.running = false;
    this.awaitingHelloAck = false;
    this.reconnectAttempt = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close(1000, "client stopped");
      } catch {
        // The socket is already closed; stopping remains complete.
      }
    }
    this.emitStatus("disconnected");
  }

  private connect(): void {
    if (!this.running) return;
    this.emitStatus("connecting");
    this.awaitingHelloAck = true;

    let socket: KeplerClockSocket;
    try {
      socket = this.webSocketFactory(this.registration.streamUrl);
    } catch (error) {
      this.awaitingHelloAck = false;
      this.reportError(error);
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket || !this.running) return;
      try {
        socket.send(JSON.stringify({
          type: "hello",
          apiToken: this.registration.apiToken,
          subscribe: ["ticks"],
        }));
      } catch (error) {
        this.reportError(error);
        this.closeSocket(socket);
      }
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || !this.running) return;
      this.handleMessage(socket, event.data);
    };
    socket.onerror = (event) => {
      if (this.socket !== socket || !this.running) return;
      this.reportError(event);
      this.closeSocket(socket);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.awaitingHelloAck = false;
      if (!this.running) return;
      this.emitStatus("disconnected");
      this.scheduleReconnect();
    };
  }

  private handleMessage(socket: KeplerClockSocket, data: unknown): void {
    const payload = parseJsonRecord(data);
    if (!payload) {
      this.reportError(new Error("Kepler clock message was not valid JSON."));
      return;
    }

    if (payload.type === "hello_ack") {
      this.handleHelloAck(socket, payload);
      return;
    }
    if (payload.type !== "planet_tick" || this.awaitingHelloAck) return;
    this.handlePlanetTick(payload);
  }

  private handleHelloAck(socket: KeplerClockSocket, payload: JsonRecord): void {
    if (payload.habitatId !== this.registration.habitatId) {
      this.failSocket(socket, "Invalid hello_ack habitat identity.");
      return;
    }

    const subscriptions = payload.subscriptions;
    if (!Array.isArray(subscriptions) || !subscriptions.every((value) => typeof value === "string") || !subscriptions.includes("ticks")) {
      this.failSocket(socket, "Invalid hello_ack subscriptions: ticks capability is required.");
      return;
    }

    this.awaitingHelloAck = false;
    this.reconnectAttempt = 0;
    this.emitStatus("connected");
  }

  private handlePlanetTick(payload: JsonRecord): void {
    if (payload.habitatId !== undefined && payload.habitatId !== this.registration.habitatId) {
      this.reportError(new Error("Invalid planet_tick habitat identity."));
      return;
    }

    const absoluteTick = payload.absoluteTick ?? payload.tick;
    const previousTick = payload.previousTick;
    const advancedBy = payload.advancedBy;
    if (!isNonNegativeInteger(absoluteTick) || !isPositiveInteger(advancedBy)) {
      this.reportError(new Error("Invalid planet_tick: absoluteTick must be a whole number and advancedBy must be positive."));
      return;
    }
    if (this.lastAbsoluteTick !== null && absoluteTick <= this.lastAbsoluteTick) return;

    const tick: KeplerClockTick = {
      type: "planet_tick",
      ...(typeof payload.habitatId === "string" ? { habitatId: payload.habitatId } : {}),
      ...(isNonNegativeInteger(previousTick) ? { previousTick } : {}),
      absoluteTick,
      advancedBy,
      ...(typeof payload.issuedAt === "string" ? { issuedAt: payload.issuedAt } : {}),
    };
    this.lastAbsoluteTick = absoluteTick;
    try {
      this.onTick?.(tick);
    } catch (error) {
      this.reportError(error);
    }
  }

  private failSocket(socket: KeplerClockSocket, message: string): void {
    this.reportError(new Error(message));
    this.closeSocket(socket);
  }

  private closeSocket(socket: KeplerClockSocket): void {
    try {
      socket.close(1008, "invalid Kepler clock message");
    } catch (error) {
      this.reportError(error);
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;
    const delay = this.reconnectDelaysMs[Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)] ?? 0;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private reportError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.emitStatus("error");
    this.onError?.(normalized);
  }

  private emitStatus(status: HabitatClockConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatusChange?.(status);
  }
}

type JsonRecord = Record<string, unknown>;

function parseJsonRecord(data: unknown): JsonRecord | null {
  let text: string;
  if (typeof data === "string") {
    text = data;
  } else if (data instanceof ArrayBuffer) {
    text = new TextDecoder().decode(data);
  } else {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function defaultWebSocketFactory(url: string): KeplerClockSocket {
  return new globalThis.WebSocket(url) as unknown as KeplerClockSocket;
}
