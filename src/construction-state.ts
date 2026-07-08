import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { subtractInventoryInputs, validateInventoryRequirements } from "./inventory-state.js";
import type {
  ConstructionCheckResult,
  ConstructionReadinessReport,
  HabitatBlueprint,
  HabitatConstructionJob,
  HabitatConstructionState,
  HabitatModule,
  ConstructionValidationResult,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDataDirectory = path.resolve(__dirname, "../data");
const constructionStateFileName = "construction.json";

type StartConstructionInput = {
  blueprint: HabitatBlueprint;
  modules: HabitatModule[];
  pendingModuleName?: string;
  connectedTo?: string[];
  dryRun?: boolean;
};

type AdvanceConstructionResult = {
  activeJob: HabitatConstructionJob | null;
  completedJob: HabitatConstructionJob | null;
};

type CancelConstructionResult = {
  canceledJob: HabitatConstructionJob | null;
};

export function loadConstructionState(): HabitatConstructionState {
  ensureConstructionStateFile();

  try {
    const raw = JSON.parse(readFileSync(getConstructionStateFilePath(), "utf8")) as { activeJob?: unknown };

    return {
      activeJob: normalizeConstructionJob(raw.activeJob),
    };
  } catch {
    return { activeJob: null };
  }
}

export function saveConstructionState(state: HabitatConstructionState): void {
  ensureConstructionStateFile();
  const filePath = getConstructionStateFilePath();
  const temporaryFilePath = `${filePath}.${process.pid}.tmp`;
  const normalizedState: HabitatConstructionState = {
    activeJob: normalizeConstructionJob(state.activeJob),
  };
  writeFileSync(temporaryFilePath, `${JSON.stringify(normalizedState, null, 2)}\n`, "utf8");
  renameSync(temporaryFilePath, filePath);
}

export function buildConstructionReadinessReport(input: {
  blueprint: HabitatBlueprint;
  modules: HabitatModule[];
}): ConstructionReadinessReport {
  const activeJob = loadConstructionState().activeJob;
  const modules = input.modules;
  const inventory = validateInventoryRequirements(input.blueprint.inputs);
  const checks: ConstructionCheckResult[] = [];
  const supplyCache = findModuleByBlueprintId(modules, "supply-cache");
  const requiredFacilityType = getRequiredFacilityType(input.blueprint);
  const requiredFacility = requiredFacilityType ? findModuleByBlueprintId(modules, requiredFacilityType) : null;
  const prerequisites = input.blueprint.prerequisites ?? [];
  const missingPrerequisites = prerequisites.filter(
    (prerequisite) => !modules.some((module) => module.blueprintId === prerequisite),
  );

  checks.push({
    label: "Active construction slot available",
    ok: activeJob === null,
    details: activeJob ? `Blocked by ${activeJob.displayName}.` : "No active construction job.",
  });
  checks.push({
    label: "Supply cache exists",
    ok: supplyCache !== null,
    details: supplyCache ? `Found ${supplyCache.displayName}.` : "No supply cache module found.",
  });
  checks.push({
    label: "Supply cache is online",
    ok: isUsableModuleStatus(supplyCache),
    details: supplyCache ? `Status is ${getModuleStatusLabel(supplyCache)}.` : "Supply cache is missing.",
  });
  checks.push({
    label: "Required facility exists",
    ok: requiredFacilityType ? requiredFacility !== null : true,
    details: requiredFacilityType
      ? requiredFacility
        ? `Found ${requiredFacility.displayName}.`
        : `Missing required facility ${requiredFacilityType}.`
      : "Blueprint does not require a facility.",
  });
  checks.push({
    label: "Required facility meets minimum level",
    ok: doesFacilityMeetMinimumLevel(requiredFacility, input.blueprint),
    details: describeMinimumLevel(requiredFacilityType, requiredFacility, input.blueprint),
  });
  checks.push({
    label: "Required facility is online or active",
    ok: requiredFacilityType ? isUsableModuleStatus(requiredFacility) : true,
    details: requiredFacility
      ? `Status is ${getModuleStatusLabel(requiredFacility)}.`
      : requiredFacilityType
        ? `Required facility ${requiredFacilityType} is missing.`
        : "Blueprint does not require a facility.",
  });
  checks.push({
    label: "Workshop fabricator exists",
    ok: requiredFacilityType === "workshop-fabricator" ? requiredFacility !== null : true,
    details:
      requiredFacilityType === "workshop-fabricator"
        ? requiredFacility
          ? `Found ${requiredFacility.displayName}.`
          : "Workshop fabricator is missing."
        : "Workshop fabricator is not required for this blueprint.",
  });
  checks.push({
    label: "Workshop fabricator is online or active",
    ok: requiredFacilityType === "workshop-fabricator" ? isUsableModuleStatus(requiredFacility) : true,
    details:
      requiredFacilityType === "workshop-fabricator"
        ? requiredFacility
          ? `Status is ${getModuleStatusLabel(requiredFacility)}.`
          : "Workshop fabricator is missing."
        : "Workshop fabricator is not required for this blueprint.",
  });
  checks.push({
    label: "Prerequisites are satisfied",
    ok: missingPrerequisites.length === 0,
    details:
      missingPrerequisites.length === 0
        ? prerequisites.length === 0
          ? "Blueprint has no prerequisites."
          : `All prerequisites are present: ${prerequisites.join(", ")}.`
        : `Missing prerequisites: ${missingPrerequisites.join(", ")}.`,
  });
  checks.push({
    label: "Inventory resources are sufficient",
    ok: inventory.ok,
    details:
      inventory.consumedInputs.length === 0
        ? "Blueprint requires no inventory resources."
        : inventory.ok
          ? "All required inventory resources are available."
          : `Missing or short resources: ${inventory.shortages.map((shortage) => shortage.resourceId).join(", ")}.`,
  });

  return {
    blueprintId: input.blueprint.blueprintId,
    displayName: stripBlueprintSuffix(input.blueprint.displayName),
    canStart: checks.every((check) => check.ok),
    checks,
    inventory,
  };
}

export function startConstruction(input: StartConstructionInput): {
  report: ConstructionReadinessReport;
  startedJob: HabitatConstructionJob | null;
} {
  const report = buildConstructionReadinessReport({
    blueprint: input.blueprint,
    modules: input.modules,
  });

  if (!report.canStart || input.dryRun) {
    return {
      report,
      startedJob: null,
    };
  }

  subtractInventoryInputs(input.blueprint.inputs);
  const selector = createConstructionSelector(input.blueprint, input.modules);
  const fabricator = resolveFabricator(input.blueprint, input.modules);
  const startedJob = createConstructionJob(
    input.blueprint,
    selector,
    fabricator.id,
    fabricator.selector,
    input.pendingModuleName,
    input.connectedTo ?? [],
    report.inventory,
  );
  saveConstructionState({
    activeJob: startedJob,
  });

  return {
    report,
    startedJob,
  };
}

export function advanceConstruction(ticks: number): AdvanceConstructionResult {
  const state = loadConstructionState();

  if (!state.activeJob) {
    return {
      activeJob: null,
      completedJob: null,
    };
  }

  const nextTicksRemaining = Math.max(0, state.activeJob.ticksRemaining - ticks);

  if (nextTicksRemaining > 0) {
    const activeJob: HabitatConstructionJob = {
      ...state.activeJob,
      ticksRemaining: nextTicksRemaining,
    };
    saveConstructionState({ activeJob });
    return {
      activeJob,
      completedJob: null,
    };
  }

  saveConstructionState({ activeJob: null });
  return {
    activeJob: null,
    completedJob: state.activeJob,
  };
}

export function cancelConstruction(selector: string): CancelConstructionResult {
  const state = loadConstructionState();

  if (
    !state.activeJob ||
    (state.activeJob.fabricatorId !== selector &&
      state.activeJob.fabricatorSelector !== selector &&
      state.activeJob.selector !== selector)
  ) {
    return {
      canceledJob: null,
    };
  }

  saveConstructionState({ activeJob: null });
  return {
    canceledJob: state.activeJob,
  };
}

function createConstructionJob(
  blueprint: HabitatBlueprint,
  selector: string,
  fabricatorId: string,
  fabricatorSelector: string,
  pendingModuleName: string | undefined,
  connectedTo: string[],
  validation: ConstructionValidationResult,
): HabitatConstructionJob {
  const moduleType =
    typeof blueprint.output.moduleType === "string" && blueprint.output.moduleType.trim()
      ? blueprint.output.moduleType
      : blueprint.blueprintId;

  return {
    blueprintId: blueprint.blueprintId,
    displayName: blueprint.displayName,
    pendingModuleName: pendingModuleName?.trim() || stripBlueprintSuffix(blueprint.displayName),
    selector,
    fabricatorId,
    fabricatorSelector,
    moduleType,
    ticksRequired: blueprint.buildTicks,
    ticksRemaining: blueprint.buildTicks,
    startedAt: new Date().toISOString(),
    consumedInputs: validation.consumedInputs,
    connectedTo,
    runtimeAttributes: blueprint.runtimeAttributes,
    capabilities: blueprint.capabilities,
  };
}

function normalizeConstructionJob(rawJob: unknown): HabitatConstructionJob | null {
  if (!rawJob || typeof rawJob !== "object") {
    return null;
  }

  const input = rawJob as Record<string, unknown>;

  if (typeof input.blueprintId !== "string" || typeof input.displayName !== "string") {
    return null;
  }

  return {
    blueprintId: input.blueprintId,
    displayName: input.displayName,
    pendingModuleName:
      typeof input.pendingModuleName === "string" && input.pendingModuleName.trim()
        ? input.pendingModuleName
        : stripBlueprintSuffix(input.displayName),
    selector: typeof input.selector === "string" && input.selector.trim() ? input.selector : createConstructionSelectorFromBlueprintId(input.blueprintId),
    fabricatorId: typeof input.fabricatorId === "string" && input.fabricatorId.trim() ? input.fabricatorId : "",
    fabricatorSelector:
      typeof input.fabricatorSelector === "string" && input.fabricatorSelector.trim() ? input.fabricatorSelector : "",
    moduleType: typeof input.moduleType === "string" && input.moduleType.trim() ? input.moduleType : input.blueprintId,
    ticksRequired: typeof input.ticksRequired === "number" && Number.isFinite(input.ticksRequired) ? input.ticksRequired : 0,
    ticksRemaining:
      typeof input.ticksRemaining === "number" && Number.isFinite(input.ticksRemaining) ? input.ticksRemaining : 0,
    startedAt: typeof input.startedAt === "string" ? input.startedAt : new Date(0).toISOString(),
    consumedInputs: Array.isArray(input.consumedInputs)
      ? input.consumedInputs.flatMap((item) => {
          if (!item || typeof item !== "object") {
            return [];
          }

          const record = item as Record<string, unknown>;
          if (typeof record.resourceId !== "string" || typeof record.amount !== "number") {
            return [];
          }

          return [{ resourceId: record.resourceId, amount: record.amount }];
        })
      : [],
    connectedTo: Array.isArray(input.connectedTo) ? input.connectedTo.filter((value): value is string => typeof value === "string") : [],
    runtimeAttributes: isRecord(input.runtimeAttributes) ? input.runtimeAttributes : {},
    capabilities: Array.isArray(input.capabilities) ? input.capabilities.filter((value): value is string => typeof value === "string") : [],
  };
}

function ensureConstructionStateFile(): void {
  mkdirSync(getDataDirectory(), { recursive: true });

  try {
    readFileSync(getConstructionStateFilePath(), "utf8");
  } catch {
    writeFileSync(getConstructionStateFilePath(), '{\n  "activeJob": null\n}\n', "utf8");
  }
}

function getDataDirectory(): string {
  return process.env.HABITAT_DATA_DIRECTORY
    ? path.resolve(process.env.HABITAT_DATA_DIRECTORY)
    : defaultDataDirectory;
}

function getConstructionStateFilePath(): string {
  return path.join(getDataDirectory(), constructionStateFileName);
}

function stripBlueprintSuffix(displayName: string): string {
  return displayName.replace(/\s+Blueprint$/, "").trim() || displayName;
}

function createConstructionSelector(blueprint: HabitatBlueprint, modules: HabitatModule[]): string {
  const existingModuleCount = modules.filter((module) => module.blueprintId === blueprint.blueprintId).length;
  const nextNumber = existingModuleCount + 1;
  const moduleType =
    typeof blueprint.output.moduleType === "string" && blueprint.output.moduleType.trim()
      ? blueprint.output.moduleType
      : blueprint.blueprintId;
  const baseSelector = deriveSelector(moduleType);
  return `${baseSelector}-${nextNumber}`;
}

function resolveFabricator(blueprint: HabitatBlueprint, modules: HabitatModule[]): { id: string; selector: string } {
  const requiredFacilityType = getRequiredFacilityType(blueprint);
  if (requiredFacilityType) {
    const fabricator = findModuleByBlueprintId(modules, requiredFacilityType);
    return {
      id: fabricator?.selector ?? fabricator?.id ?? "",
      selector: fabricator?.selector ?? "",
    };
  }

  const fabricator = findModuleByBlueprintId(modules, "workshop-fabricator");
  return {
    id: fabricator?.selector ?? fabricator?.id ?? "",
    selector: fabricator?.selector ?? "",
  };
}

function createConstructionSelectorFromBlueprintId(blueprintId: string): string {
  return `${deriveSelector(blueprintId)}-1`;
}

function deriveSelector(identifier: string): string {
  const normalized = identifier
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized || "module";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function findModuleByBlueprintId(modules: HabitatModule[], blueprintId: string): HabitatModule | null {
  return modules.find((module) => module.blueprintId === blueprintId) ?? null;
}

function getRequiredFacilityType(blueprint: HabitatBlueprint): string | null {
  const moduleType = blueprint.requiredFacility.moduleType;
  return typeof moduleType === "string" && moduleType.trim() ? moduleType : null;
}

function getRequiredFacilityMinimumLevel(blueprint: HabitatBlueprint): number {
  const minimumLevel = blueprint.requiredFacility.minimumLevel;
  return typeof minimumLevel === "number" && Number.isFinite(minimumLevel) ? minimumLevel : 0;
}

function getModuleLevel(module: HabitatModule | null): number {
  const level = module?.runtimeAttributes.level;
  return typeof level === "number" && Number.isFinite(level) ? level : 1;
}

function doesFacilityMeetMinimumLevel(module: HabitatModule | null, blueprint: HabitatBlueprint): boolean {
  const facilityType = getRequiredFacilityType(blueprint);
  if (!facilityType) {
    return true;
  }

  if (!module) {
    return false;
  }

  return getModuleLevel(module) >= getRequiredFacilityMinimumLevel(blueprint);
}

function describeMinimumLevel(
  facilityType: string | null,
  module: HabitatModule | null,
  blueprint: HabitatBlueprint,
): string {
  if (!facilityType) {
    return "Blueprint does not require a facility level.";
  }

  if (!module) {
    return `Required facility ${facilityType} is missing.`;
  }

  const minimumLevel = getRequiredFacilityMinimumLevel(blueprint);
  return `Needs level ${minimumLevel}, found level ${getModuleLevel(module)}.`;
}

function getModuleStatusLabel(module: HabitatModule | null): string {
  const status = module?.runtimeAttributes.status;
  return typeof status === "string" ? status : "unknown";
}

function isUsableModuleStatus(module: HabitatModule | null): boolean {
  const status = module?.runtimeAttributes.status;
  return status === "online" || status === "active";
}
