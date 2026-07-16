export type KeplerHabitat = {
  id: string;
  habitatSlug: string;
  displayName: string;
  catalogVersion: string;
  status: string;
  lastSeenAt: string | null;
};

export type KeplerStarterModule = {
  id: string;
  blueprintId: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

export type KeplerStarterHuman = {
  id: string;
  displayName: string;
  locationModuleId: string;
};

export type KeplerBlueprint = {
  id: string;
  blueprintId: string;
  displayName: string;
  description?: string;
  status?: string;
  output: Record<string, unknown>;
  inputs: Record<string, unknown>;
  productionCost?: Record<string, unknown>;
  requiredFacility?: Record<string, unknown>;
  buildTicks: number;
  prerequisites?: string[];
  unlocks?: string[];
  repeatable?: boolean;
  level?: number | null;
  target?: Record<string, unknown>;
  facilityLevel?: Record<string, unknown>;
  attachmentPoints?: Record<string, unknown>;
  attachmentRequirements?: Array<Record<string, unknown>>;
  runtimeAttributes?: Record<string, unknown>;
  capabilities?: string[];
};

export type HabitatModule = {
  id: string;
  selector: string;
  blueprintId: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

export type HabitatBlueprint = {
  blueprintId: string;
  displayName: string;
  description: string;
  output: Record<string, unknown>;
  inputs: Record<string, unknown>;
  productionCost: Record<string, unknown>;
  requiredFacility: Record<string, unknown>;
  buildTicks: number;
  prerequisites: string[];
  unlocks: string[];
  repeatable: boolean;
  level: number | null;
  target: Record<string, unknown>;
  facilityLevel: Record<string, unknown>;
  attachmentPoints: Record<string, unknown>;
  attachmentRequirements: Array<Record<string, unknown>>;
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

export type InventorySource = "local" | "kepler-catalog";

export type HabitatInventoryItem = {
  resourceId: string;
  displayName: string;
  quantity: number;
  unit: string;
  category: string;
  source: InventorySource;
  updatedAt: string;
};

export type HabitatInventoryState = {
  items: HabitatInventoryItem[];
};

export type ConsumedConstructionInput = {
  resourceId: string;
  amount: number;
};

export type ConstructionShortage = {
  resourceId: string;
  required: number;
  available: number;
};

export type ConstructionValidationResult = {
  ok: boolean;
  shortages: ConstructionShortage[];
  consumedInputs: ConsumedConstructionInput[];
};

export type ConstructionCheckResult = {
  label: string;
  ok: boolean;
  details: string;
};

export type ConstructionReadinessReport = {
  blueprintId: string;
  displayName: string;
  canStart: boolean;
  checks: ConstructionCheckResult[];
  inventory: ConstructionValidationResult;
};

export type HabitatConstructionJob = {
  blueprintId: string;
  displayName: string;
  pendingModuleName: string;
  selector: string;
  fabricatorId: string;
  fabricatorSelector: string;
  moduleType: string;
  ticksRequired: number;
  ticksRemaining: number;
  startedAt: string;
  consumedInputs: ConsumedConstructionInput[];
  connectedTo: string[];
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

export type HabitatConstructionState = {
  activeJob: HabitatConstructionJob | null;
};

export type HabitatHuman = {
  id: string;
  displayName: string;
  locationModuleId: string;
  status: string;
};

export type HabitatCarriedResource = { resourceId: string; quantityKg: number };
export type HabitatEvaState = {
  deployedHumanId: string | null;
  x: number;
  y: number;
  carriedResources: HabitatCarriedResource[];
  maxCarryingCapacityKg: number;
};

export type HabitatAlert = {
  id: string;
  schemaVersion: string;
  type: string;
  severity: string;
  status: string;
  source: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  occurrenceCount?: number;
  subject?: { type: "human" | "module"; id: string };
  details: Record<string, unknown>;
};

export type HabitatStream = {
  protocolVersion: string;
  subscriptions: string[];
  currentTick: number;
  tickIntervalMs: number;
  ticksPerPulse: number;
  status: "paused" | "running";
};

export type HabitatRegistrationContracts = {
  alerts: {
    schemaVersion: string;
    schema: Record<string, unknown>;
  };
};

export type KeplerRegistrationResponse = {
  habitatId: string;
  streamUrl: string;
  apiToken: string;
  stream: HabitatStream;
  contracts: HabitatRegistrationContracts;
  starterModules: KeplerStarterModule[];
  starterHumans: KeplerStarterHuman[];
  blueprints: KeplerBlueprint[];
};

export type KeplerRegistration = {
  habitatId: string;
  habitatUuid: string;
  displayName: string;
  streamUrl: string;
  apiToken: string;
  stream: HabitatStream;
  contracts: HabitatRegistrationContracts;
  habitat: KeplerHabitat;
  modules: HabitatModule[];
  humans: HabitatHuman[];
  alerts: HabitatAlert[];
  blueprints: HabitatBlueprint[];
};

export type LoadableKeplerState = Partial<KeplerRegistration>;
