export type WorldScanRequest = {
  habitatId: string;
  x: number;
  y: number;
  sensorStrength: number;
  radiusTiles: number;
};

export type WorldCollectionRequest = {
  habitatId: string;
  x: number;
  y: number;
  quantityKg: number;
};

export type KeplerWorldClient = {
  scan: (request: WorldScanRequest) => Promise<Record<string, unknown>>;
  collect: (request: WorldCollectionRequest) => Promise<Record<string, unknown>>;
  getCurrentSector: (habitatId: string) => Promise<Record<string, unknown>>;
};

export type KeplerWorldFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createKeplerWorldClient(
  baseUrl: string,
  planetToken: string,
  fetchImpl: KeplerWorldFetch = fetch,
): KeplerWorldClient {
  return {
    async scan(request) {
      const url = new URL(`${baseUrl}/world/scan`);
      url.search = new URLSearchParams({
        habitatId: request.habitatId,
        x: String(request.x),
        y: String(request.y),
        sensorStrength: String(request.sensorStrength),
        radiusTiles: String(request.radiusTiles),
      }).toString();
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${planetToken}` },
      });

      if (!response.ok) {
        throw new Error(`Kepler world scan failed with ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as Record<string, unknown>;
    },
    async collect(request) {
      const response = await fetchImpl(`${baseUrl}/world/collect`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${planetToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`Kepler world collection failed with ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as Record<string, unknown>;
    },
    async getCurrentSector(habitatId: string) {
      const url = new URL(`${baseUrl}/world/sectors/current`);
      url.search = new URLSearchParams({ habitatId }).toString();
      const response = await fetchImpl(url);

      if (!response.ok) {
        throw new Error(`Kepler world sector request failed with ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as Record<string, unknown>;
    },
  };
}
