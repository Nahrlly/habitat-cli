import type { ResourceScan } from "./api";

export type ScanTile = NonNullable<ResourceScan["tiles"]>[number];

export function getScanTiles(result: ResourceScan): ScanTile[] {
  return result.scan?.tiles ?? result.tiles ?? [];
}
