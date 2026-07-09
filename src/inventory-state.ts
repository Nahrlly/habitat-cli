import { withDatabase } from "./sqlite-state.js";
import type {
  ConsumedConstructionInput,
  ConstructionShortage,
  ConstructionValidationResult,
  HabitatInventoryItem,
  HabitatInventoryState,
} from "./types.js";

type InventoryMutationInput = {
  resourceId: string;
  quantity: number;
  displayName?: string;
  unit?: string;
  category?: string;
};

type AddInventoryInput = {
  resourceId: string;
  amount: number;
  displayName?: string;
  unit?: string;
  category?: string;
};

export function loadInventoryState(): HabitatInventoryState {
  const items = withDatabase((db) => {
    const rows = db
      .query(
        `SELECT resource_id AS resourceId, display_name AS displayName, quantity, unit, category, source, updated_at AS updatedAt
         FROM inventory_items
         ORDER BY resource_id`,
      )
      .all() as Array<{
      resourceId: string;
      displayName: string;
      quantity: number;
      unit: string;
      category: string;
      source: string;
      updatedAt: string;
    }>;

    return rows.map((row) => normalizeInventoryItem(row)).sort(compareInventoryItems);
  });

  if (items.length > 0) {
    return { items };
  }

  return { items: [] };
}

export function saveInventoryState(state: HabitatInventoryState): void {
  const normalizedState: HabitatInventoryState = {
    items: state.items.map(normalizeInventoryItem).sort(compareInventoryItems),
  };

  withDatabase((db) => {
    db.transaction(() => {
      db.run("DELETE FROM inventory_items;");
      const insert = db.query(
        `INSERT INTO inventory_items (resource_id, display_name, quantity, unit, category, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of normalizedState.items) {
        insert.run(item.resourceId, item.displayName, item.quantity, item.unit, item.category, item.source, item.updatedAt);
      }
    })();
  });
}

export function setInventoryQuantity(input: InventoryMutationInput): HabitatInventoryItem {
  const state = loadInventoryState();
  const nextItem = buildInventoryItem(state.items, input);
  saveInventoryState({
    items: upsertInventoryItem(state.items, nextItem),
  });
  return nextItem;
}

export function addInventoryQuantity(input: AddInventoryInput): HabitatInventoryItem {
  const state = loadInventoryState();
  const resourceId = normalizeResourceId(input.resourceId);
  const existingItem = state.items.find((item) => item.resourceId === resourceId);
  const nextItem = buildInventoryItem(state.items, {
    resourceId,
    quantity: (existingItem?.quantity ?? 0) + input.amount,
    displayName: input.displayName,
    unit: input.unit,
    category: input.category,
  });
  saveInventoryState({
    items: upsertInventoryItem(state.items, nextItem),
  });
  return nextItem;
}

export function validateInventoryRequirements(inputs: Record<string, unknown>): ConstructionValidationResult {
  const state = loadInventoryState();
  const requirements = normalizeInventoryRequirements(inputs);
  const shortages: ConstructionShortage[] = [];

  for (const requirement of requirements) {
    const available = state.items.find((item) => item.resourceId === requirement.resourceId)?.quantity ?? 0;

    if (available < requirement.amount) {
      shortages.push({
        resourceId: requirement.resourceId,
        required: requirement.amount,
        available,
      });
    }
  }

  return {
    ok: shortages.length === 0,
    shortages,
    consumedInputs: requirements,
  };
}

export function subtractInventoryInputs(inputs: Record<string, unknown>): HabitatInventoryItem[] {
  const validation = validateInventoryRequirements(inputs);

  if (!validation.ok) {
    throw new Error("Inventory requirements are not met.");
  }

  const state = loadInventoryState();
  const nextItems = state.items.map((item) => {
    const requirement = validation.consumedInputs.find((candidate) => candidate.resourceId === item.resourceId);

    if (!requirement) {
      return item;
    }

    return {
      ...item,
      quantity: item.quantity - requirement.amount,
      updatedAt: new Date().toISOString(),
    };
  });

  saveInventoryState({
    items: nextItems,
  });

  return nextItems;
}

function buildInventoryItem(existingItems: HabitatInventoryItem[], input: InventoryMutationInput): HabitatInventoryItem {
  const resourceId = normalizeResourceId(input.resourceId);
  const existingItem = existingItems.find((item) => item.resourceId === resourceId);

  return {
    resourceId,
    displayName:
      input.displayName?.trim() || existingItem?.displayName || deriveDisplayName(resourceId),
    quantity: input.quantity,
    unit: input.unit?.trim() ?? existingItem?.unit ?? "",
    category: input.category?.trim() ?? existingItem?.category ?? "",
    source: existingItem?.source ?? "local",
    updatedAt: new Date().toISOString(),
  };
}

function upsertInventoryItem(items: HabitatInventoryItem[], nextItem: HabitatInventoryItem): HabitatInventoryItem[] {
  const remainingItems = items.filter((item) => item.resourceId !== nextItem.resourceId);
  return [...remainingItems, nextItem].sort(compareInventoryItems);
}

function normalizeInventoryItem(rawItem: unknown): HabitatInventoryItem {
  const input = isRecord(rawItem) ? rawItem : {};
  const resourceId = normalizeResourceId(
    typeof input.resourceId === "string" ? input.resourceId : typeof input.displayName === "string" ? input.displayName : "",
  );

  return {
    resourceId,
    displayName:
      typeof input.displayName === "string" && input.displayName.trim()
        ? input.displayName.trim()
        : deriveDisplayName(resourceId),
    quantity: typeof input.quantity === "number" && Number.isFinite(input.quantity) ? input.quantity : 0,
    unit: typeof input.unit === "string" ? input.unit.trim() : "",
    category: typeof input.category === "string" ? input.category.trim() : "",
    source: input.source === "kepler-catalog" ? "kepler-catalog" : "local",
    updatedAt:
      typeof input.updatedAt === "string" && input.updatedAt.trim()
        ? input.updatedAt
        : new Date(0).toISOString(),
  };
}

function normalizeResourceId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "resource";
}

function deriveDisplayName(resourceId: string): string {
  return resourceId
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function compareInventoryItems(left: HabitatInventoryItem, right: HabitatInventoryItem): number {
  return left.resourceId.localeCompare(right.resourceId);
}

function normalizeInventoryRequirements(inputs: Record<string, unknown>): ConsumedConstructionInput[] {
  return Object.entries(inputs).flatMap(([resourceId, value]) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return [];
    }

    return [
      {
        resourceId: normalizeResourceId(resourceId),
        amount: value,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
