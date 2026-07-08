import type { KeplerCatalogBlueprint, KeplerCatalogResource } from "./kepler-catalog.js";
import type {
  ConstructionReadinessReport,
  ConstructionShortage,
  HabitatConstructionJob,
  HabitatInventoryState,
  KeplerRegistration,
  HabitatModule,
} from "./types.js";

export function formatPowerDraw(powerDraw: number): string {
  return Number.isInteger(powerDraw) ? `${powerDraw}` : powerDraw.toFixed(1).replace(/\.0$/, "");
}

export function formatEnergyCost(energyCost: number): string {
  if (energyCost === 0) {
    return "0";
  }

  if (energyCost < 0.01) {
    return energyCost.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }

  return energyCost.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function renderTextTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const formatRow = (row: string[]): string =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join(" | ");
  const separator = widths.map((width) => "-".repeat(width)).join("-|-");

  return [formatRow(headers), separator, ...rows.map(formatRow)].join("\n");
}

export function buildModuleStatusRows(registration: KeplerRegistration): string[][] {
  return registration.modules.map((module) => [
    module.selector,
    getDeclaredModuleStatus(module),
    getEffectiveModuleStatus(module),
    `${formatPowerDraw(getModulePowerDraw(module))} kW`,
  ]);
}

export function getModuleStatus(module: HabitatModule): string {
  return getEffectiveModuleStatus(module);
}

export function getDeclaredModuleStatus(module: HabitatModule): string {
  const status = module.runtimeAttributes.status;

  if (
    status === "online" ||
    status === "offline" ||
    status === "idle" ||
    status === "active" ||
    status === "damaged"
  ) {
    return status;
  }

  return "online";
}

export function getEffectiveModuleStatus(module: HabitatModule): string {
  if (isModuleBusy(module)) {
    return "active";
  }

  return getDeclaredModuleStatus(module);
}

export function getModulePowerDraw(module: HabitatModule): number {
  const powerDrawKw = module.runtimeAttributes.powerDrawKw;
  const status = getEffectiveModuleStatus(module);

  if (typeof powerDrawKw === "number") {
    return powerDrawKw;
  }

  if (isRecord(powerDrawKw)) {
    const draw = powerDrawKw[status];

    if (typeof draw === "number") {
      return draw;
    }
  }

  return 0;
}

export function getBatteryCharge(module: HabitatModule): number {
  const currentEnergyKwh = module.runtimeAttributes.currentEnergyKwh;

  return typeof currentEnergyKwh === "number" ? currentEnergyKwh : 0;
}

export function getTotalBatteryCharge(registration: KeplerRegistration): number {
  return getBatteryModules(registration).reduce((total, module) => total + getBatteryCharge(module), 0);
}

export function sumModulePowerDraw(registration: KeplerRegistration): number {
  return registration.modules.reduce((total, module) => total + getModulePowerDraw(module), 0);
}

export function powerDrawToEnergyCost(powerDrawKw: number, ticks: number): number {
  return (powerDrawKw * ticks) / 3600;
}

export function applyTick(registration: KeplerRegistration, ticks: number): {
  registration: KeplerRegistration;
  totalPowerDraw: number;
  batteryBefore: number;
  batteryAfter: number;
} {
  const totalPowerDraw = powerDrawToEnergyCost(sumModulePowerDraw(registration), ticks);
  const batteryBefore = getTotalBatteryCharge(registration);
  const batteryAfter = Math.max(0, batteryBefore - totalPowerDraw);
  const batteryDrain = batteryBefore - batteryAfter;
  const batteryModules = getBatteryModules(registration);
  const updatedBatteryModules: HabitatModule[] = [];
  let remainingDrain = batteryDrain;

  for (const module of batteryModules) {
    const currentCharge = getBatteryCharge(module);
    const nextCharge = Math.max(0, currentCharge - remainingDrain);
    remainingDrain -= currentCharge - nextCharge;
    updatedBatteryModules.push(setBatteryCharge(module, nextCharge));
  }

  return {
    registration: {
      ...registration,
      modules: registration.modules.map((module) => {
        const updatedBatteryModule = updatedBatteryModules.find((candidate) => candidate.id === module.id);

        return updatedBatteryModule ?? module;
      }),
    },
    totalPowerDraw,
    batteryBefore,
    batteryAfter,
  };
}

export function formatBlueprintSummary(blueprint: KeplerCatalogBlueprint): string {
  const prerequisites = blueprint.prerequisites ?? [];
  const unlocks = blueprint.unlocks ?? [];
  const capabilities = blueprint.capabilities ?? [];
  const inputs = blueprint.inputs ?? {};
  const output = blueprint.output ?? {};
  const productionCost = blueprint.productionCost ?? {};
  const requiredFacility = blueprint.requiredFacility ?? {};
  const lines: string[] = [];
  lines.push(`${blueprint.displayName} (${blueprint.blueprintId})`);

  if (blueprint.description) {
    lines.push("");
    lines.push(blueprint.description);
  }

  lines.push("");
  lines.push(`Build ticks: ${blueprint.buildTicks}`);
  lines.push(`Repeatable: ${blueprint.repeatable ? "yes" : "no"}`);

  if (blueprint.level !== null && blueprint.level !== undefined) {
    lines.push(`Level: ${blueprint.level}`);
  }

  if (Object.keys(requiredFacility).length > 0) {
    lines.push(`Required facility: ${JSON.stringify(requiredFacility)}`);
  }

  lines.push("");
  lines.push("Required resources:");
  lines.push(formatKeyValueTable(["Resource", "Amount"], inputs));
  lines.push("");
  lines.push("Output:");
  lines.push(formatKeyValueTable(["Field", "Value"], output));
  lines.push(`Production cost: ${formatObjectEntries(productionCost)}`);

  if (prerequisites.length > 0) {
    lines.push(`Prerequisites: ${prerequisites.join(", ")}`);
  }

  if (unlocks.length > 0) {
    lines.push(`Unlocks: ${unlocks.join(", ")}`);
  }

  if (capabilities.length > 0) {
    lines.push(`Capabilities: ${capabilities.join(", ")}`);
  }

  return lines.join("\n");
}

export function formatBlueprintList(blueprints: KeplerCatalogBlueprint[]): string {
  if (blueprints.length === 0) {
    return "No blueprints found.";
  }

  const rows = blueprints.map((blueprint) => [
    blueprint.blueprintId,
    blueprint.displayName,
    `${blueprint.buildTicks}`,
    blueprint.repeatable ? "repeatable" : "one-time",
  ]);

  return renderTextTable(["Blueprint", "Name", "Build Ticks", "Mode"], rows);
}

export function formatResourceList(resources: KeplerCatalogResource[]): string {
  if (resources.length === 0) {
    return "No resources found.";
  }

  const rows = resources.map((resource) => [
    resource.displayName,
    resource.category ?? "",
    resource.unitLabel ?? resource.unit ?? "",
  ]);

  return renderTextTable(["Name", "Category", "Unit"], rows);
}

export function formatInventoryList(state: HabitatInventoryState): string {
  if (state.items.length === 0) {
    return "No inventory found.";
  }

  return renderTextTable(
    ["Resource", "Name", "Quantity", "Unit", "Category", "Source"],
    state.items.map((item) => [
      item.resourceId,
      item.displayName,
      `${item.quantity}`,
      item.unit,
      item.category,
      item.source,
    ]),
  );
}

export function formatConstructionShortages(shortages: ConstructionShortage[]): string {
  if (shortages.length === 0) {
    return "All required resources are available.";
  }

  const rows = shortages.map((shortage) => [
    shortage.resourceId,
    `${shortage.required}`,
    `${shortage.available}`,
    `${shortage.required - shortage.available}`,
  ]);

  return ["Missing resources:", renderTextTable(["Resource", "Required", "Available", "Missing"], rows)].join("\n");
}

export function formatConstructionReadinessReport(report: ConstructionReadinessReport): string {
  const checklistRows = report.checks.map((check) => [check.label, check.ok ? "PASS" : "FAIL", check.details]);
  const sections = [
    `Construction readiness for ${report.displayName}`,
    renderTextTable(["Check", "Status", "Details"], checklistRows),
  ];

  if (report.inventory.consumedInputs.length > 0) {
    sections.push(
      renderTextTable(
        ["Resource", "Required", "Available", "Missing"],
        report.inventory.consumedInputs.map((input) => {
          const shortage = report.inventory.shortages.find((candidate) => candidate.resourceId === input.resourceId);
          const available = shortage ? shortage.available : input.amount;
          return [input.resourceId, `${input.amount}`, `${available}`, `${Math.max(0, input.amount - available)}`];
        }),
      ),
    );
  }

  sections.push(report.canStart ? "Construction can start." : "Construction cannot start.");
  return sections.join("\n\n");
}

export function formatConstructionProgress(job: HabitatConstructionJob): string {
  return `Construction: ${job.pendingModuleName} ${job.ticksRemaining}/${job.ticksRequired} ticks remaining.`;
}

export function formatConstructionStatus(job: HabitatConstructionJob | null): string {
  if (!job) {
    return "Construction: idle.";
  }

  const percentComplete = Math.floor(((job.ticksRequired - job.ticksRemaining) / job.ticksRequired) * 100);
  return `Construction: ${job.pendingModuleName} ${job.ticksRemaining}/${job.ticksRequired} ticks remaining (${percentComplete}%).`;
}

export function formatModuleDetails(module: HabitatModule, activeConstructionJob: HabitatConstructionJob | null = null): string {
  const declaredStatus = getDeclaredModuleStatus(module);
  const effectiveStatus = getEffectiveModuleStatus(module);
  const activity = describeModuleActivity(module, activeConstructionJob);
  const rows: string[][] = [
    ["Name", module.displayName],
    ["Selector", module.selector],
    ["Blueprint", module.blueprintId],
    ["Declared state", declaredStatus],
    ["Effective state", effectiveStatus],
    ["Power draw", `${formatPowerDraw(getModulePowerDraw(module))} kW`],
  ];

  if (activity) {
    rows.push(["Activity", activity]);
  }

  if (module.connectedTo.length > 0) {
    rows.push(["Connected to", module.connectedTo.join(", ")]);
  }

  if (module.capabilities.length > 0) {
    rows.push(["Capabilities", module.capabilities.join(", ")]);
  }

  rows.push(...formatRuntimeAttributeRows(module.runtimeAttributes));

  return renderTextTable(["Field", "Value"], rows);
}

export function formatModuleSummary(registration: KeplerRegistration): string {
  return registration.modules.length === 0
    ? "No modules created yet."
    : `${registration.modules.length} module(s): ${registration.modules
        .map((module) => `${module.selector} (${module.displayName})`)
        .join(", ")}`;
}

function getBatteryModules(registration: KeplerRegistration): HabitatModule[] {
  return registration.modules.filter(isBatteryModule);
}

function isBatteryModule(module: HabitatModule): boolean {
  return module.capabilities.includes("power-storage");
}

function setBatteryCharge(module: HabitatModule, currentEnergyKwh: number): HabitatModule {
  return {
    ...module,
    runtimeAttributes: {
      ...module.runtimeAttributes,
      currentEnergyKwh,
    },
  };
}

function formatObjectEntries(value: Record<string, unknown>): string {
  const entries = Object.entries(value);

  if (entries.length === 0) {
    return "none";
  }

  return entries.map(([key, entryValue]) => `${key}: ${formatValue(entryValue)}`).join(", ");
}

function formatKeyValueTable(headers: [string, string], value: Record<string, unknown>): string {
  const rows = Object.entries(value).map(([key, entryValue]) => [key, formatValue(entryValue)]);

  if (rows.length === 0) {
    return "none";
  }

  return renderTextTable(headers, rows);
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(formatValue).join(", ")}]`;
  }

  if (value && typeof value === "object") {
    return `{ ${Object.entries(value)
      .map(([key, entryValue]) => `${key}: ${formatValue(entryValue)}`)
      .join(", ")} }`;
  }

  return String(value);
}

function formatRuntimeAttributeRows(attributes: Record<string, unknown>): string[][] {
  return Object.entries(attributes).flatMap(([key, value]) => {
    if (key === "status" || key === "powerDrawKw") {
      return [];
    }

    if (key === "inProcessStorageM3" && typeof value === "number") {
      return [[`In-process storage`, `${value} m3`]];
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      return [[key, `{ ${Object.entries(value)
        .map(([nestedKey, nestedValue]) => `${nestedKey}: ${formatValue(nestedValue)}`)
        .join(", ")} }`]];
    }

    return [[formatDisplayKey(key), formatValue(value)]];
  });
}

function describeModuleActivity(module: HabitatModule, activeConstructionJob: HabitatConstructionJob | null): string | null {
  if (
    activeConstructionJob &&
    (activeConstructionJob.fabricatorId === module.id || activeConstructionJob.fabricatorSelector === module.selector)
  ) {
    return `construction in progress: ${activeConstructionJob.pendingModuleName} (${activeConstructionJob.ticksRemaining}/${activeConstructionJob.ticksRequired} ticks remaining)`;
  }

  const attributes = module.runtimeAttributes;

  if (typeof attributes.inProcessStorageM3 === "number" && attributes.inProcessStorageM3 > 0) {
    return `fabrication in progress`;
  }

  if (typeof attributes.currentTask === "string" && attributes.currentTask.trim()) {
    return attributes.currentTask.trim();
  }

  if (getEffectiveModuleStatus(module) === "active") {
    return "busy";
  }

  return null;
}

function formatDisplayKey(key: string): string {
  if (key === "inProcessStorageM3") {
    return "In-process storage";
  }

  if (key === "physicalVolumeM3") {
    return "Physical volume";
  }

  if (key === "rawMaterialBufferKg") {
    return "Raw material buffer";
  }

  if (key === "crewCapacity") {
    return "Crew capacity";
  }

  if (key === "health") {
    return "Health";
  }

  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (value) => value.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isModuleBusy(module: HabitatModule): boolean {
  return typeof module.runtimeAttributes.inProcessStorageM3 === "number" && module.runtimeAttributes.inProcessStorageM3 > 0;
}
