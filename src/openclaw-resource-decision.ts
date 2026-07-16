import type { ResourceMissionAction } from "./autonomy-policy.js";
import type { ResourceMissionDecisionContext, ResourceMissionPlanContext } from "./resource-mission-controller.js";

type OpenClawRunResult = { status: string; result?: { finalAssistantVisibleText?: string; payloads?: Array<{ text?: string }> } };

export type OpenClawResourceDecisionOptions = {
  runAgent?: (args: { sessionId: string; message: string; timeoutSeconds: number }) => Promise<string>;
  binary?: string;
  timeoutSeconds?: number;
  maxPlanSteps?: number;
};

export function createOpenClawResourceDecision(options: OpenClawResourceDecisionOptions = {}) {
  const binary = options.binary ?? process.env.OPENCLAW_BIN ?? "openclaw";
  const timeoutSeconds = options.timeoutSeconds ?? Number(process.env.OPENCLAW_MISSION_TIMEOUT_SECONDS ?? 60);
  const runAgent = options.runAgent ?? ((args) => runOpenClawAgent(binary, args));

  return async function decide(context: ResourceMissionDecisionContext): Promise<ResourceMissionAction> {
    const message = [
      "You are the decision layer for one bounded Habitat resource-mission step.",
      "Return exactly one JSON object matching one item in legalActions. Do not use tools, execute commands, or invent actions.",
      "Prefer scanning before collecting, move to a scanned adjacent resource tile, and preserve Habitat's safety reserves.",
      JSON.stringify({
        mission: { id: context.mission.id, status: context.mission.status, humanId: context.mission.humanId },
        snapshot: context.snapshot,
        legalActions: context.legalActions,
      }),
    ].join("\n");
    const raw = await runAgent({ sessionId: `habitat-resource-mission-${context.mission.id}`, message, timeoutSeconds });
    const action = parseOpenClawAction(raw);
    const legal = context.legalActions.find((candidate) => JSON.stringify(candidate) === JSON.stringify(action));
    if (!legal) throw new Error("OpenClaw selected an action outside Habitat's legal action set.");
    return legal;
  };

}

export function createOpenClawResourcePlanner(options: OpenClawResourceDecisionOptions = {}) {
  const binary = options.binary ?? process.env.OPENCLAW_BIN ?? "openclaw";
  const timeoutSeconds = options.timeoutSeconds ?? Number(process.env.OPENCLAW_MISSION_TIMEOUT_SECONDS ?? 60);
  const runAgent = options.runAgent ?? ((args) => runOpenClawAgent(binary, args));
  const maxPlanSteps = options.maxPlanSteps ?? Number(process.env.OPENCLAW_MISSION_MAX_PLAN_STEPS ?? 12);

  return async function plan(context: ResourceMissionPlanContext): Promise<ResourceMissionAction[]> {
    const message = [
      "You are the decision layer for one whole bounded Habitat resource-mission trip segment.",
      "Return exactly one JSON array of primitive actions, in execution order, with no markdown.",
      `Plan up to ${maxPlanSteps} actions. The first action must be one of legalActions; later actions will be revalidated by Habitat after each step.`,
      "Plan multiple useful actions rather than stopping after one collection. Use scan results in recentIterations to choose adjacent resource tiles and collect larger batches when safe.",
      "Do not return or dock. Habitat will autonomously return and dock when carrying capacity is full, oxygen or power reaches its safety threshold, or the operator stops the mission.",
      "Do not use tools, execute commands, or invent action types.",
      JSON.stringify({
        mission: { id: context.mission.id, status: context.mission.status, humanId: context.mission.humanId },
        snapshot: context.snapshot,
        legalActions: context.legalActions,
        maxPlanSteps,
        recentIterations: context.recentIterations,
      }),
    ].join("\n");
    const raw = await runAgent({ sessionId: `habitat-resource-mission-${context.mission.id}`, message, timeoutSeconds });
    return parseOpenClawPlan(raw, maxPlanSteps);
  };

}

async function runOpenClawAgent(binary: string, args: { sessionId: string; message: string; timeoutSeconds: number }): Promise<string> {
  const process = Bun.spawn([binary, "agent", "--json", "--session-id", args.sessionId, "--message", args.message, "--timeout", String(args.timeoutSeconds)], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text()]);
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(stderr.trim() || `OpenClaw exited with status ${exitCode}.`);
  return stdout;
}

function parseOpenClawAction(raw: string): ResourceMissionAction {
  let envelope: OpenClawRunResult;
  try {
    envelope = JSON.parse(raw) as OpenClawRunResult;
  } catch {
    throw new Error("OpenClaw returned invalid JSON.");
  }
  if (envelope.status !== "ok") throw new Error("OpenClaw did not complete the decision request.");
  const text = envelope.result?.finalAssistantVisibleText ?? envelope.result?.payloads?.find((payload) => payload.text)?.text;
  if (!text) throw new Error("OpenClaw returned no decision text.");
  try {
    return parseActionValue(JSON.parse(text));
  } catch {
    throw new Error("OpenClaw returned a decision that was not a resource mission action.");
  }
}

function parseOpenClawPlan(raw: string, maxPlanSteps: number): ResourceMissionAction[] {
  const text = extractAssistantText(raw);
  try {
    const plan = JSON.parse(text);
    if (!Array.isArray(plan) || plan.length === 0 || plan.length > maxPlanSteps || plan.some((action) => action && typeof action === "object" && action.type === "dock")) throw new Error();
    return plan.map(parseActionValue);
  } catch {
    throw new Error("OpenClaw returned an invalid bounded trip plan.");
  }
}

function extractAssistantText(raw: string): string {
  let envelope: OpenClawRunResult;
  try {
    envelope = JSON.parse(raw) as OpenClawRunResult;
  } catch {
    throw new Error("OpenClaw returned invalid JSON.");
  }
  if (envelope.status !== "ok") throw new Error("OpenClaw did not complete the decision request.");
  const text = envelope.result?.finalAssistantVisibleText ?? envelope.result?.payloads?.find((payload) => payload.text)?.text;
  if (!text) throw new Error("OpenClaw returned no decision text.");
  return text;
}

function parseActionValue(value: unknown): ResourceMissionAction {
  if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") throw new Error();
  const action = value as Record<string, unknown>;
  if (action.type === "deploy" && typeof action.humanId === "string") return { type: "deploy", humanId: action.humanId };
  if (action.type === "move" && Number.isSafeInteger(action.x) && Number.isSafeInteger(action.y)) return { type: "move", x: action.x as number, y: action.y as number };
  if (action.type === "scan" && Number.isSafeInteger(action.strength) && Number.isSafeInteger(action.radius)) return { type: "scan", strength: action.strength as number, radius: action.radius as number };
  if (action.type === "collect" && Number.isSafeInteger(action.quantityKg) && (action.quantityKg as number) > 0) return { type: "collect", quantityKg: action.quantityKg as number };
  throw new Error();
}
