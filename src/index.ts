#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

type KeplerHabitat = {
  id: string;
  habitatSlug: string;
  displayName: string;
  catalogVersion: string;
  status: string;
  lastSeenAt: string | null;
};

type KeplerRegistration = {
  habitatId: string;
  habitatUuid: string;
  displayName: string;
  habitat: KeplerHabitat;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDirectory = path.resolve(__dirname, "../data");
const keplerStateFilePath = path.join(dataDirectory, "kepler.json");
const keplerBaseUrl = process.env.KEPLER_BASE_URL ?? "";
const keplerPlanetToken = process.env.KEPLER_PLANET_TOKEN ?? "";

function ensureKeplerEnv(): void {
  if (!keplerBaseUrl || !keplerPlanetToken) {
    throw new Error("Missing KEPLER_BASE_URL or KEPLER_PLANET_TOKEN in .env.");
  }
}

function ensureKeplerStateFile(): void {
  mkdirSync(dataDirectory, { recursive: true });

  try {
    readFileSync(keplerStateFilePath, "utf8");
  } catch {
    writeFileSync(keplerStateFilePath, "{}\n", "utf8");
  }
}

function loadKeplerRegistration(): KeplerRegistration | null {
  ensureKeplerStateFile();

  try {
    const raw = JSON.parse(readFileSync(keplerStateFilePath, "utf8")) as Partial<KeplerRegistration>;

    if (
      typeof raw.habitatId === "string" &&
      typeof raw.habitatUuid === "string" &&
      typeof raw.displayName === "string" &&
      raw.habitat !== undefined &&
      raw.habitat !== null
    ) {
      return {
        habitatId: raw.habitatId,
        habitatUuid: raw.habitatUuid,
        displayName: raw.displayName,
        habitat: raw.habitat as KeplerHabitat,
      };
    }
  } catch {
    // Ignore malformed cache and treat as unregistered.
  }

  return null;
}

function saveKeplerRegistration(registration: KeplerRegistration): void {
  ensureKeplerStateFile();
  const temporaryFilePath = `${keplerStateFilePath}.${process.pid}.tmp`;
  writeFileSync(temporaryFilePath, `${JSON.stringify(registration, null, 2)}\n`, "utf8");
  renameSync(temporaryFilePath, keplerStateFilePath);
}

function clearKeplerRegistration(): void {
  ensureKeplerStateFile();
  writeFileSync(keplerStateFilePath, "{}\n", "utf8");
}

async function registerWithKepler(displayName: string): Promise<void> {
  ensureKeplerEnv();

  const habitatUuid = randomUUID();
  const response = await fetch(`${keplerBaseUrl}/habitats/register`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${keplerPlanetToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      habitatUuid,
      displayName,
    }),
  });

  if (!response.ok) {
    throw new Error(`Kepler registration failed with ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { habitatId: string };
  const habitat = await fetchKeplerHabitatStatus(payload.habitatId);

  saveKeplerRegistration({
    habitatId: payload.habitatId,
    habitatUuid,
    displayName,
    habitat,
  });
}

async function fetchKeplerHabitatStatus(habitatId: string): Promise<KeplerHabitat> {
  ensureKeplerEnv();

  const response = await fetch(`${keplerBaseUrl}/habitats/${habitatId}`, {
    headers: {
      Authorization: `Bearer ${keplerPlanetToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Kepler habitat status failed with ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { habitat: KeplerHabitat };
  return payload.habitat;
}

async function unregisterFromKepler(habitatId: string): Promise<void> {
  ensureKeplerEnv();

  const response = await fetch(`${keplerBaseUrl}/habitats/${habitatId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${keplerPlanetToken}`,
    },
  });

  if (!response.ok && response.status !== 204) {
    throw new Error(`Kepler unregister failed with ${response.status} ${response.statusText}`);
  }

  clearKeplerRegistration();
}

const program = new Command();

program
  .name("habitat")
  .description("Register this Habitat CLI with Kepler and inspect its status.")
  .version("0.1.0");

program
  .command("register")
  .description("Register this Habitat CLI with Kepler.")
  .requiredOption("--name <name>", "habitat name")
  .action(async (options: { name: string }) => {
    try {
      if (loadKeplerRegistration()) {
        console.error("Habitat is already registered. Run `habitat unregister` first.");
        process.exitCode = 1;
        return;
      }

      await registerWithKepler(options.name);
      console.log(`Registered habitat ${options.name}.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("status")
  .description("Show the current Kepler registration status.")
  .action(async () => {
    try {
      const registration = loadKeplerRegistration();

      if (!registration) {
        console.log("Habitat is not registered with Kepler.");
        return;
      }

      const habitat = await fetchKeplerHabitatStatus(registration.habitatId);
      saveKeplerRegistration({
        ...registration,
        habitat,
      });

      console.log(JSON.stringify({ registration, habitat }, null, 2));
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("unregister")
  .description("Unregister this Habitat CLI from Kepler.")
  .action(async () => {
    try {
      const registration = loadKeplerRegistration();

      if (!registration) {
        console.log("Habitat is not registered with Kepler.");
        return;
      }

      await unregisterFromKepler(registration.habitatId);
      console.log(`Unregistered habitat ${registration.displayName}.`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  });

program.on("command:*", ([commandName]) => {
  console.error(`Unknown command: ${commandName}`);
  console.error("Try `habitat --help` to see the available commands.");
  process.exitCode = 1;
});

await program.parseAsync(process.argv);
