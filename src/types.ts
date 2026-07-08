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

export type KeplerRegistration = {
  habitatId: string;
  habitatUuid: string;
  displayName: string;
  habitat: KeplerHabitat;
  modules: HabitatModule[];
  blueprints: HabitatBlueprint[];
};

export type LoadableKeplerState = Partial<KeplerRegistration>;
