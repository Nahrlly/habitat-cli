import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { getApiBaseUrl } from "./api-client.js";

export async function ensureLocalApi(): Promise<void> {
  const baseUrl = getApiBaseUrl();
  let url: URL;
  try { url = new URL(baseUrl); } catch { return; }
  if (!(["localhost", "127.0.0.1"].includes(url.hostname)) || process.env.HABITAT_AUTO_START_LOCAL_API === "0") return;

  if (await responds(`${baseUrl}/eva/status`)) return;
  const serverPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "server.ts");
  if (!existsSync(serverPath)) throw new Error(`Local Habitat API entrypoint not found: ${serverPath}`);
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, HABITAT_API_HOST: "127.0.0.1", HABITAT_API_PORT: url.port || "8787" },
  });
  child.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await responds(`${baseUrl}/eva/status`)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Could not start the local Habitat API at ${baseUrl}.`);
}

async function responds(url: string): Promise<boolean> {
  try { return (await fetch(url)).ok; } catch { return false; }
}
