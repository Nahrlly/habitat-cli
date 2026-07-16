import type { ResourceScan } from "./api";

function getTiles(result: ResourceScan) {
  return result.scan?.tiles ?? result.tiles ?? [];
}

function getOrigin(result: ResourceScan) {
  return result.scan?.origin ?? result.origin ?? { x: 0, y: 0 };
}

export function mergeScanResults(previous: ResourceScan | null, next: ResourceScan): ResourceScan {
  if (!previous) return next;
  const tiles = new Map(getTiles(previous).map((tile) => [`${tile.x},${tile.y}`, tile] as const));
  for (const tile of getTiles(next)) tiles.set(`${tile.x},${tile.y}`, tile);
  return {
    ...previous,
    ...next,
    scan: {
      ...previous.scan,
      ...next.scan,
      origin: getOrigin(next),
      tiles: [...tiles.values()],
    },
  };
}
