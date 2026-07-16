import { randomUUID } from "node:crypto";
import { loadKeplerRegistration, loadHabitatAlerts, saveHabitatAlerts } from "./state.js";
import type { HabitatAlert } from "./types.js";

export type AlertSubject = { type: "human" | "module"; id: string };

export function createOperationalAlert(input: {
  type: string;
  message: string;
  severity?: string;
  status?: string;
  source?: string;
  subject?: AlertSubject;
  details?: Record<string, unknown>;
}): HabitatAlert {
  const registration = loadKeplerRegistration();
  if (!registration) throw new Error("Habitat is not registered.");
  const contract = registration.contracts.alerts;
  const schema = contract.schema as Record<string, unknown>;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const severity = input.severity ?? readDefault(properties.severity) ?? "warning";
  const status = input.status ?? readDefault(properties.status) ?? "open";
  const alerts = loadHabitatAlerts();
  const existing = alerts.find((candidate) => candidate.type === input.type && candidate.status !== "resolved" && sameSubject(candidate.subject, input.subject));
  if (existing) {
    const updated = { ...existing, updatedAt: new Date().toISOString(), occurrenceCount: (existing.occurrenceCount ?? 1) + 1, message: input.message, details: input.details ?? existing.details };
    saveHabitatAlerts(alerts.map((candidate) => candidate.id === existing.id ? updated : candidate));
    return updated;
  }
  const alert: HabitatAlert = {
    id: randomUUID(), schemaVersion: contract.schemaVersion, type: input.type,
    severity, status, source: input.source ?? "habitat-local", message: input.message,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), occurrenceCount: 1,
    ...(input.subject ? { subject: input.subject } : {}), details: input.details ?? {},
  };
  validateEnum(properties.severity, alert.severity, "severity");
  validateEnum(properties.status, alert.status, "status");
  saveHabitatAlerts([...alerts, alert]);
  return alert;
}

function sameSubject(left: AlertSubject | undefined, right: AlertSubject | undefined): boolean {
  return left?.type === right?.type && left?.id === right?.id;
}

function readDefault(properties: unknown): string | undefined {
  return isRecord(properties) && typeof properties.default === "string" ? properties.default : undefined;
}

function validateEnum(property: unknown, value: string, name: string): void {
  if (!isRecord(property) || !Array.isArray(property.enum) || property.enum.length === 0) return;
  if (!property.enum.includes(value)) throw new Error(`Alert contract rejects ${name}: ${value}.`);
}

function isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null; }
