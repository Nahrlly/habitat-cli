import { describe, expect, test } from "bun:test";
import { getScanTiles } from "./scan-model";

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
});
