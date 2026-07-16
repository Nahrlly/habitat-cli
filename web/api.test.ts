import { describe, expect, test } from "bun:test";
import { loadDashboardSnapshot } from "./api";

describe("dashboard REST bootstrap", () => {
  test("combines the existing REST resources into a realtime snapshot shape", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input), "http://localhost:8787").pathname;
      const body: Record<string, unknown> = {
        "/registration": { displayName: "Test Habitat", modules: [] },
        "/modules": { modules: [] },
        "/humans": { humans: [] },
        "/solar/status": { solarIrradiance: { wPerM2: 240, condition: "clear" } },
        "/power/overview": { generationKw: 12, consumptionKw: 4, netKw: 8, solarIrradiance: { wPerM2: 240, condition: "clear" } },
        "/power/history": { history: [] },
        "/alerts": { alerts: [] },
      };
      return new Response(JSON.stringify(body[pathname] ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    try {
      await expect(loadDashboardSnapshot()).resolves.toMatchObject({
        registration: { displayName: "Test Habitat" },
        modules: [],
        humans: [],
        solar: { solarIrradiance: { wPerM2: 240 } },
        power: { netKw: 8 },
        powerHistory: [],
        alerts: [],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("retains available bootstrap state when one REST resource is unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input), "http://localhost:8787").pathname;
      if (pathname === "/power/overview") throw new Error("Power service unavailable");
      const body: Record<string, unknown> = {
        "/registration": { displayName: "Fallback Habitat", modules: [] },
        "/modules": { modules: [] },
        "/humans": { humans: [] },
        "/solar/status": { solarIrradiance: { wPerM2: 180, condition: "cloudy" } },
        "/power/history": { history: [] },
        "/alerts": { alerts: [] },
      };
      return new Response(JSON.stringify(body[pathname] ?? {}), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    try {
      await expect(loadDashboardSnapshot()).resolves.toMatchObject({
        registration: { displayName: "Fallback Habitat" },
        solar: { solarIrradiance: { wPerM2: 180 } },
        power: null,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
