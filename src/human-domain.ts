import { randomUUID } from "node:crypto";
import { loadKeplerRegistration, saveState } from "./state.js";
import type { HabitatHuman, KeplerRegistration } from "./types.js";

export function listHumans(): HabitatHuman[] {
  return requireRegistration().humans;
}

export function createHuman(displayName: string, locationModuleId: string): HabitatHuman {
  const registration = requireRegistration();
  const human: HabitatHuman = { id: randomUUID(), displayName: displayName.trim(), locationModuleId: locationModuleId.trim(), status: "present" };
  saveState({ ...registration, humans: [...registration.humans, human] });
  return human;
}

export function updateHuman(id: string, changes: Partial<Pick<HabitatHuman, "displayName" | "locationModuleId" | "status">>): HabitatHuman {
  const registration = requireRegistration();
  const current = registration.humans.find((human) => human.id === id);
  if (!current) throw new Error(`Human not found: ${id}.`);
  const human = {
    ...current,
    displayName: changes.displayName?.trim() || current.displayName,
    locationModuleId: changes.locationModuleId?.trim() || current.locationModuleId,
    status: changes.status?.trim() || current.status,
  };
  saveState({ ...registration, humans: registration.humans.map((entry) => (entry.id === id ? human : entry)) });
  return human;
}

export function deleteHuman(id: string): void {
  const registration = requireRegistration();
  const humans = registration.humans.filter((human) => human.id !== id);
  if (humans.length === registration.humans.length) throw new Error(`Human not found: ${id}.`);
  saveState({ ...registration, humans });
}

export function moveHuman(id: string, destinationModuleId: string): HabitatHuman {
  const registration = requireRegistration();
  const human = registration.humans.find((entry) => entry.id === id);
  if (!human) throw new Error(`Human not found: ${id}.`);

  const destination = registration.modules.find(
    (module) => module.id === destinationModuleId || module.selector === destinationModuleId,
  );
  if (!destination) throw new Error(`Destination module not found: ${destinationModuleId}.`);
  if (human.locationModuleId === destinationModuleId) return human;

  const capacity = destination.runtimeAttributes.crewCapacity;
  const occupantCount = registration.humans.filter((entry) => entry.locationModuleId === destinationModuleId).length;
  if (typeof capacity !== "number" || !Number.isFinite(capacity) || occupantCount >= capacity) {
    throw new Error("Destination module has no open crew capacity.");
  }

  const movedHuman = { ...human, locationModuleId: destination.id };
  saveState({ ...registration, humans: registration.humans.map((entry) => (entry.id === id ? movedHuman : entry)) });
  return movedHuman;
}

export function assertModuleCanBeDeleted(moduleId: string): void {
  const registration = requireRegistration();
  if (registration.humans.some((human) => human.locationModuleId === moduleId)) {
    throw new Error("Module cannot be deleted while a human is occupying it.");
  }
}

function requireRegistration(): KeplerRegistration {
  const registration = loadKeplerRegistration();
  if (!registration) throw new Error("Habitat is not registered.");
  return registration;
}
