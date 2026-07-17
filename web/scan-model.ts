import type { ResourceScan } from "./api";
export { mergeScanResults } from "./scan-history";

export type ScanTile = NonNullable<ResourceScan["tiles"]>[number];
export type ScanPlotTile = ScanTile & { resourceLabel: string; probabilityPct: number };
export type ScanPlot = { origin: { x: number; y: number }; tiles: ScanPlotTile[] };

export function getScanTiles(result: ResourceScan): ScanTile[] {
  return result.scan?.tiles ?? result.tiles ?? [];
}

export function getScanOrigin(result: ResourceScan): { x: number; y: number } {
  return result.scan?.origin ?? result.origin ?? { x: 0, y: 0 };
}

export function buildScanPlot(result: ResourceScan): ScanPlot {
  return {
    origin: getScanOrigin(result),
    tiles: getScanTiles(result).map((tile) => ({
      ...tile,
      resourceLabel: tile.topCandidate?.resourceType ?? "No identified resource",
      probabilityPct: tile.topCandidate?.probabilityPct ?? 0,
    })),
  };
}
