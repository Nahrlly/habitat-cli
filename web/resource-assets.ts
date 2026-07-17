export type ResourceAsset = { artwork: string; icon: string };

const RESOURCE_ASSET_VERSION = "2026-07-dark";

const includedResourceTypes = [
  "basalt-composite",
  "build-capacity",
  "conductive-ore",
  "ferrite",
  "ice-regolith",
  "power-capacity",
  "power-storage",
  "rare-catalyst",
  "sealed-space",
  "silicate-glass",
  "volatile-compounds",
] as const;

export const RESOURCE_ASSETS: Record<string, ResourceAsset> = Object.fromEntries(
  includedResourceTypes.map((resourceType) => [resourceType, {
    artwork: `/resources/${resourceType}.png?v=${RESOURCE_ASSET_VERSION}`,
    icon: `/resources/${resourceType}-icon.png?v=${RESOURCE_ASSET_VERSION}`,
  }]),
);

export function getResourceAsset(resourceType: string): ResourceAsset | null {
  return RESOURCE_ASSETS[resourceType] ?? null;
}
