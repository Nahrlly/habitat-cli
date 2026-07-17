import { runAutonomyCycle } from "./autonomy-controller.js";
import { loadAutonomyConfig, listAutonomyAudits, saveAutonomyConfig } from "./autonomy-state.js";

export function parseInterval(value: string): number {
  const match = /^(\d+)(m|h|d)$/.exec(value.trim());
  if (!match) throw new Error("Interval must look like 5m, 1h, or 1d.");
  const amount = Number(match[1]);
  const multiplier = match[2] === "m" ? 60_000 : match[2] === "h" ? 3_600_000 : 86_400_000;
  if (amount < 1) throw new Error("Interval must be at least 1 unit.");
  return amount * multiplier;
}

export async function runAutonomyCommand(action: "start" | "stop" | "status" | "run-now", options: { every?: string; name?: string }): Promise<void> {
  const current = loadAutonomyConfig();
  if (action === "start") {
    const config = { ...current, scheduleName: options.name?.trim() || current.scheduleName, intervalMs: options.every ? parseInterval(options.every) : current.intervalMs, enabled: true };
    saveAutonomyConfig(config);
    console.log(`Autonomy started: ${config.scheduleName} every ${formatInterval(config.intervalMs)}.`);
    return;
  }
  if (action === "stop") { saveAutonomyConfig({ ...current, enabled: false }); console.log("Autonomy stopped."); return; }
  if (action === "status") { console.log(`Autonomy: ${current.enabled ? "running" : "stopped"} (${current.scheduleName}, every ${formatInterval(current.intervalMs)}).`); console.log(`Audits: ${listAutonomyAudits(1).length ? "available" : "none"}.`); return; }
  const result = await runAutonomyCycle({ scheduleName: current.scheduleName });
  console.log(`Autonomy run: ${result.summary}`);
}

function formatInterval(milliseconds: number): string { if (milliseconds % 86_400_000 === 0) return `${milliseconds / 86_400_000}d`; if (milliseconds % 3_600_000 === 0) return `${milliseconds / 3_600_000}h`; return `${milliseconds / 60_000}m`; }
