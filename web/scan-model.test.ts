import { describe, expect, test } from "bun:test";
import { buildScanPlot, getScanTiles, mergeScanResults } from "./scan-model";

describe("scan response model", () => {
  test("reads tiles from the nested Kepler scan response", () => {
    const tiles = getScanTiles({
      scan: {
        tiles: [{ x: 0, y: -1, topCandidate: { resourceType: "ice-regolith", probabilityPct: 63.83 } }],
      },
    });

    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.topCandidate?.resourceType).toBe("ice-regolith");
  });

  test("returns an empty list only when the API has no tiles", () => {
    expect(getScanTiles({ scan: { tiles: [] } })).toEqual([]);
  });

  test("plots each tile using its server-provided highest-probability resource", () => {
    const plot = buildScanPlot({
      scan: {
        origin: { x: 2, y: -3 },
        tiles: [{ x: 3, y: -3, topCandidate: { resourceType: "ferrite", probabilityPct: 71.2 } }],
      },
    });

    expect(plot.origin).toEqual({ x: 2, y: -3 });
    expect(plot.tiles[0]).toMatchObject({ resourceLabel: "ferrite", probabilityPct: 71.2 });
  });

  test("keeps previously scanned coordinates while updating rescanned tiles", () => {
    const merged = mergeScanResults(
      { scan: { origin: { x: 0, y: 0 }, tiles: [{ x: 0, y: 0, topCandidate: { resourceType: "ice-regolith", probabilityPct: 60 } }] } },
      { scan: { origin: { x: 1, y: 0 }, tiles: [{ x: 1, y: 0, topCandidate: { resourceType: "ferrite", probabilityPct: 70 } }, { x: 0, y: 0, topCandidate: { resourceType: "basalt-composite", probabilityPct: 80 } }] } },
    );

    expect(getScanTiles(merged)).toHaveLength(2);
    expect(getScanTiles(merged).find((tile) => tile.x === 0)?.topCandidate?.resourceType).toBe("basalt-composite");
    expect(merged.scan?.origin).toEqual({ x: 1, y: 0 });
  });
});
