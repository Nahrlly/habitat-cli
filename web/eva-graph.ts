import type { ResourceScan } from "./api";

export type Coordinate = { x: number; y: number };
export type EvaGraphPoint = Coordinate & { kind: "origin" | "path" | "explorer" | "resource"; label?: string; detail?: string };

export function buildEvaPath(current: Coordinate): Coordinate[] {
  return [{ x: 0, y: 0 }, { x: current.x, y: current.y }];
}

export function buildResourceMarkers(scan: ResourceScan): EvaGraphPoint[] {
  return (scan.tiles ?? []).map((tile) => {
    const candidate = tile.topCandidate?.resourceType ?? tile.quantityEstimate?.resourceType ?? "Unknown resource";
    const probability = tile.topCandidate?.probabilityPct;
    const estimate = tile.quantityEstimate?.estimatedKg;
    return { x: tile.x, y: tile.y, kind: "resource", label: candidate, detail: `${probability ?? 0}%${estimate === undefined ? "" : ` · ${estimate} kg`}` };
  });
}

export function formatEvaCoordinate(point: Coordinate): string { return `(${point.x}, ${point.y})`; }
