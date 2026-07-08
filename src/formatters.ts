import type { KeplerCatalogBlueprint, KeplerCatalogResource } from "./kepler-catalog.js";
import type { KeplerRegistration, HabitatModule } from "./types.js";

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
    getModuleStatus(module),
    `${formatPowerDraw(getModulePowerDraw(module))} kW`,
  ]);
}

export function getModuleStatus(module: HabitatModule): string {
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

export function getModulePowerDraw(module: HabitatModule): number {
  const powerDrawKw = module.runtimeAttributes.powerDrawKw;
  const status = getModuleStatus(module);

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

  lines.push(`Requirements: ${formatObjectEntries(inputs)}`);
  lines.push(`Output: ${formatObjectEntries(output)}`);
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

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(formatValue).join(", ");
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
