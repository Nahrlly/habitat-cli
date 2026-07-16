export type ResourceAsset = { artwork: string; icon: string };

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
    artwork: `/resources/${resourceType}.png`,
    icon: `/resources/${resourceType}-icon.png`,
  }]),
);

export function getResourceAsset(resourceType: string): ResourceAsset | null {
  return RESOURCE_ASSETS[resourceType] ?? null;
}
