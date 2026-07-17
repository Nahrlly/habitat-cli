import { describe, expect, test } from "bun:test";
import { buildEvaPath, buildResourceMarkers, formatEvaCoordinate } from "./eva-graph";

describe("EVA graph data", () => {
  test("builds an origin-to-explorer path from server coordinates", () => {
    expect(buildEvaPath({ x: 3, y: -2 })).toEqual([{ x: 0, y: 0 }, { x: 3, y: -2 }]);
  });
  test("maps only server-provided scan markers", () => {
    expect(buildResourceMarkers({ tiles: [{ x: 3, y: -2, topCandidate: { resourceType: "iron", probabilityPct: 80 }, quantityEstimate: { estimatedKg: 120 } }] })).toEqual([{ x: 3, y: -2, kind: "resource", label: "iron", detail: "80% · 120 kg" }]);
  });
  test("maps nested Kepler tiles for the main EVA graph", () => {
    expect(buildResourceMarkers({ scan: { tiles: [{ x: 1, y: 2, topCandidate: { resourceType: "ferrite", probabilityPct: 72 } }] } })).toEqual([{ x: 1, y: 2, kind: "resource", label: "ferrite", detail: "72%" }]);
  });
  test("formats coordinates for the operator", () => { expect(formatEvaCoordinate({ x: 0, y: -4 })).toBe("(0, -4)"); });
});
