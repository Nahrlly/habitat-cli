import { createBackendApp } from "./backend-app.js";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let activeKeplerFetch: FetchLike;

export function setKeplerFetch(fetch: FetchLike): void {
  activeKeplerFetch = fetch;
}

export function installBackendFetch(keplerFetch: FetchLike): () => void {
  activeKeplerFetch = keplerFetch;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.startsWith("http://localhost:8787")) {
      return app.fetch(new Request(url, init));
    }

    return activeKeplerFetch(input, init);
  }) as typeof fetch;

  const app = createBackendApp();

  return () => {
    globalThis.fetch = originalFetch;
  };
}
