import { describe, expect, test } from "bun:test";
import { formatResourceScan } from "./formatters.js";
import { createKeplerWorldClient } from "./kepler-world.js";

describe("resource scan formatting", () => {
  test("prints the full probability table and quantity estimate for one tile", () => {
    const output = formatResourceScan({
      scan: { origin: { x: 3, y: -2 }, sensorStrength: 60, tiles: [{
        x: 3,
        y: -2,
        terrain: "flat",
        distanceTiles: 0,
        probabilities: [{ resourceType: "iron", probabilityPct: 80 }, { resourceType: null, probabilityPct: 20 }],
        topCandidate: { resourceType: "iron", probabilityPct: 80 },
        quantityEstimate: {
          resourceType: "iron",
          estimatedKg: 120,
          minimumKg: 400,
          maximumKg: 800,
          exact: false,
        },
      }] },
    });

    expect(output).toContain("iron");
    expect(output).toContain("80%");
    expect(output).toContain("120 kg");
    expect(output).toContain("400-800 kg");
  });

  test("prints one summary row per tile for a larger radius", () => {
    const output = formatResourceScan({
      scan: { origin: { x: 3, y: -2 }, sensorStrength: 60, tiles: [
        {
          x: 3, y: -2, terrain: "flat", distanceTiles: 0,
          probabilities: [{ resourceType: "iron", probabilityPct: 80 }, { resourceType: null, probabilityPct: 20 }],
          topCandidate: { resourceType: "iron", probabilityPct: 80 },
          quantityEstimate: { resourceType: "iron", estimatedKg: 120, minimumKg: 400, maximumKg: 800, exact: false },
        },
        {
          x: 4, y: -2, terrain: "flat", distanceTiles: 1,
          probabilities: [{ resourceType: null, probabilityPct: 100 }],
          topCandidate: { resourceType: null, probabilityPct: 100 },
          quantityEstimate: null,
        },
      ] },
    });

    expect(output).toContain("Coordinates");
    expect(output).toContain("3,-2");
    expect(output).toContain("4,-2");
    expect(output).toContain("Sensor strength: 60");
    expect(output).toContain("none");
  });

  test("passes the saved habitat id and scan parameters to Kepler", async () => {
    let requestUrl = "";
    const client = createKeplerWorldClient("https://kepler.test", "token", async (input) => {
      requestUrl = String(input);
      return new Response(JSON.stringify({ tiles: [] }), { status: 200 });
    });

    await client.scan({ habitatId: "hab-1", x: 3, y: -2, sensorStrength: 60, radiusTiles: 0 });

    expect(requestUrl).toBe("https://kepler.test/world/scan?habitatId=hab-1&x=3&y=-2&sensorStrength=60&radiusTiles=0");
  });
});
