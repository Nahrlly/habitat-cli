import { createApiClient } from "./api-client.js";
import type { AutonomyAction } from "./autonomy-policy.js";

export type ActionResult = { ok: boolean; summary: string; response?: unknown };

export async function executeAutonomyAction(action: AutonomyAction, api = createApiClient()): Promise<ActionResult> {
  if (action.type === "noop") return { ok: true, summary: "No action selected." };
  if (action.type === "deploy") return { ok: true, summary: `Deployed ${action.humanId}.`, response: await api.postJson("/eva/deploy", { humanId: action.humanId }) };
  if (action.type === "move") return { ok: true, summary: `Moved EVA to (${action.x}, ${action.y}).`, response: await api.postJson("/eva/move", { x: action.x, y: action.y }) };
  return { ok: true, summary: `Collected ${action.quantityKg} kg.`, response: await api.postJson("/world/collect", { quantityKg: action.quantityKg }) };
}
