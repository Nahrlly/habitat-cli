import { createBackendApp } from "./backend-app.js";

declare const Bun: {
  serve: (options: { port: number; fetch: typeof globalThis.fetch }) => unknown;
};

const port = parsePort(process.env.PORT ?? "8787");

try {
  const app = createBackendApp();

  console.log(`Habitat backend listening on http://localhost:${port}`);

  Bun.serve({
    port,
    fetch: app.fetch as unknown as typeof globalThis.fetch,
  });
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}

function parsePort(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 8787;
  }

  return parsed;
}
