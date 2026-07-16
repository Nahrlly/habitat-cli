import { describe, expect, test } from "bun:test";
import { getResourceAsset, RESOURCE_ASSETS } from "./resource-assets";

describe("Kepler resource assets", () => {
  test("resolves every included resource to artwork and icon paths", () => {
    expect(Object.keys(RESOURCE_ASSETS)).toHaveLength(11);
    for (const asset of Object.values(RESOURCE_ASSETS)) {
      expect(asset.artwork).toMatch(/^\/resources\/.+\.png$/);
      expect(asset.icon).toMatch(/^\/resources\/.+-icon\.png$/);
    }
  });

  test("does not include deferred resources", () => {
    expect(getResourceAsset("food")).toBeNull();
    expect(getResourceAsset("oxygen")).toBeNull();
    expect(getResourceAsset("water")).toBeNull();
    expect(getResourceAsset("future-resource")).toBeNull();
  });
});
