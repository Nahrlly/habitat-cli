import type { Blueprint, ResourceMissionPriority } from "./api";

export const PINNED_BLUEPRINTS_KEY = "habitat-pinned-blueprints";

export function loadPinnedBlueprintIds(storage: Pick<Storage, "getItem">): string[] {
  try {
    const value = JSON.parse(storage.getItem(PINNED_BLUEPRINTS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function buildPinnedResourcePriorities(blueprints: Blueprint[], pinnedIds: string[], inventory: Array<{ resourceId: string; quantity: number }> = []): ResourceMissionPriority[] {
  const pinned = new Set(pinnedIds);
  const required = new Map<string, number>();
  for (const blueprint of blueprints) {
    if (!pinned.has(blueprint.blueprintId)) continue;
    for (const [resourceId, amount] of Object.entries(blueprint.inputs ?? {})) {
      if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) required.set(resourceId, (required.get(resourceId) ?? 0) + amount);
    }
  }
  const available = new Map(inventory.map((item) => [item.resourceId, item.quantity]));
  return [...required.entries()]
    .map(([resourceId, quantityKg]) => ({ resourceId, quantityKg: Math.max(0, quantityKg - (available.get(resourceId) ?? 0)) }))
    .filter((resource) => resource.quantityKg > 0);
}
