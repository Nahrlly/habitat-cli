import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ConsumedConstructionInput,
  ConstructionShortage,
  ConstructionValidationResult,
  HabitatInventoryItem,
  HabitatInventoryState,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDataDirectory = path.resolve(__dirname, "../data");
const inventoryStateFileName = "inventory.json";

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
  ensureInventoryStateFile();

  try {
    const raw = JSON.parse(readFileSync(getInventoryStateFilePath(), "utf8")) as { items?: unknown };

    if (Array.isArray(raw.items)) {
      return {
        items: raw.items.map(normalizeInventoryItem).sort(compareInventoryItems),
      };
    }
  } catch {
    // Ignore malformed state and recover to an empty inventory.
  }

  return { items: [] };
}

export function saveInventoryState(state: HabitatInventoryState): void {
  ensureInventoryStateFile();
  const filePath = getInventoryStateFilePath();
  const temporaryFilePath = `${filePath}.${process.pid}.tmp`;
  const normalizedState: HabitatInventoryState = {
    items: state.items.map(normalizeInventoryItem).sort(compareInventoryItems),
  };
  writeFileSync(temporaryFilePath, `${JSON.stringify(normalizedState, null, 2)}\n`, "utf8");
  renameSync(temporaryFilePath, filePath);
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

function getInventoryStateFilePath(): string {
  return path.join(getDataDirectory(), inventoryStateFileName);
}

function getDataDirectory(): string {
  return process.env.HABITAT_DATA_DIRECTORY
    ? path.resolve(process.env.HABITAT_DATA_DIRECTORY)
    : defaultDataDirectory;
}

function ensureInventoryStateFile(): void {
  mkdirSync(getDataDirectory(), { recursive: true });

  try {
    readFileSync(getInventoryStateFilePath(), "utf8");
  } catch {
    writeFileSync(getInventoryStateFilePath(), '{\n  "items": []\n}\n', "utf8");
  }
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
