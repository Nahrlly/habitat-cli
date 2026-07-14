export type WorldScanRequest = {
  habitatId: string;
  x: number;
  y: number;
  sensorStrength: number;
  radiusTiles: number;
};

export type KeplerWorldClient = {
  scan: (request: WorldScanRequest) => Promise<Record<string, unknown>>;
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
  };
}
