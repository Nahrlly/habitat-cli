import { describe, expect, test } from "bun:test";
import { formatResourceScan } from "./formatters.js";
import { createKeplerWorldClient } from "./kepler-world.js";

describe("resource scan formatting", () => {
  test("prints the full probability table and quantity estimate for one tile", () => {
    const output = formatResourceScan({
      tiles: [{
        x: 3,
        y: -2,
        terrain: "rocky",
        distance: 0,
        resourceProbabilities: { iron: 0.8, water: 0.2 },
        topCandidate: { resource: "iron", probability: 0.8 },
        quantityEstimate: {
          candidateResource: "iron",
          kilograms: 120,
          estimatedValue: 600,
          minimumValue: 400,
          maximumValue: 800,
          exact: false,
        },
      }],
    });

    expect(output).toContain("iron");
    expect(output).toContain("80%");
    expect(output).toContain("120 kg");
    expect(output).toContain("400 - 800");
  });

  test("prints one summary row per tile for a larger radius", () => {
    const output = formatResourceScan({
      tiles: [
        {
          x: 3, y: -2, terrain: "rocky", distance: 0,
          resourceProbabilities: { iron: 0.8 },
          topCandidate: { resource: "iron", probability: 0.8 },
          quantityEstimate: { candidateResource: "iron", kilograms: 120, estimatedValue: 600, minimumValue: 400, maximumValue: 800, exact: false },
        },
        {
          x: 4, y: -2, terrain: "dust", distance: 1,
          resourceProbabilities: { water: 0.6 },
          topCandidate: { resource: "water", probability: 0.6 },
          quantityEstimate: null,
        },
      ],
    });

    expect(output).toContain("Coordinates");
    expect(output).toContain("3,-2");
    expect(output).toContain("4,-2");
    expect(output).not.toContain("resourceProbabilities");
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
