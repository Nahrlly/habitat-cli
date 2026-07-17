type MissionPlanIteration = {
  id: string;
  action: string;
  actionInput: Record<string, unknown>;
  error?: string | null;
};

type MissionResource = {
  resourceId: string;
  displayName?: string;
  quantityKg: number;
};

export function formatOpenClawMissionNotice(iteration: MissionPlanIteration): string | null {
  if (iteration.action !== "plan" || iteration.actionInput.source !== "openclaw") return null;
  if (iteration.error) return `OpenClaw returned an error: ${iteration.error}`;

  const actions = Array.isArray(iteration.actionInput.actions) ? iteration.actionInput.actions : responseActions(iteration.actionInput.responseText);
  const summary = actions.filter(isRecord).map(formatAction).filter(Boolean).join(" -> ");
  if (summary) return `OpenClaw returned: ${summary}`;

  const responseText = typeof iteration.actionInput.responseText === "string" ? iteration.actionInput.responseText.trim() : "";
  return responseText ? `OpenClaw returned: ${responseText}` : "OpenClaw returned an empty plan.";
}

export function formatResourceMissionReturnNotice(report: { status: string; collectedResources: MissionResource[] }): string | null {
  if (report.status !== "completed" || !report.collectedResources.length) return null;
  const resources = report.collectedResources
    .filter((resource) => resource.quantityKg > 0)
    .map((resource) => `${resource.quantityKg} kg ${resource.displayName ?? resource.resourceId}`)
    .join(", ");
  return resources ? `OpenClaw returned with: ${resources}` : null;
}

function formatAction(action: Record<string, unknown>): string {
  if (action.type === "deploy") return `deploy ${String(action.humanId ?? "human")}`;
  if (action.type === "scan") return `scan strength ${String(action.strength ?? "?")} radius ${String(action.radius ?? "?")}`;
  if (action.type === "move") return `move to (${String(action.x ?? "?")},${String(action.y ?? "?")})`;
  if (action.type === "collect") return `collect ${String(action.quantityKg ?? "?")} kg`;
  return String(action.type ?? "action");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function responseActions(value: unknown): unknown[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.plan) ? parsed.plan : [];
  } catch {
    return [];
  }
}
