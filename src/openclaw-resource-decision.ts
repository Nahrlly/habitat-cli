import type { ResourceMissionAction } from "./autonomy-policy.js";
import type { ResourceMissionDecisionContext } from "./resource-mission-controller.js";

type OpenClawRunResult = { status: string; result?: { finalAssistantVisibleText?: string; payloads?: Array<{ text?: string }> } };

export type OpenClawResourceDecisionOptions = {
  runAgent?: (args: { sessionId: string; message: string; timeoutSeconds: number }) => Promise<string>;
  binary?: string;
  timeoutSeconds?: number;
};

export function createOpenClawResourceDecision(options: OpenClawResourceDecisionOptions = {}) {
  const runAgent = options.runAgent ?? runOpenClawAgent;
  const binary = options.binary ?? process.env.OPENCLAW_BIN ?? "openclaw";
  const timeoutSeconds = options.timeoutSeconds ?? Number(process.env.OPENCLAW_MISSION_TIMEOUT_SECONDS ?? 60);

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

  async function runOpenClawAgent(args: { sessionId: string; message: string; timeoutSeconds: number }): Promise<string> {
    const process = Bun.spawn([binary, "agent", "--json", "--session-id", args.sessionId, "--message", args.message, "--timeout", String(args.timeoutSeconds)], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text()]);
    const exitCode = await process.exited;
    if (exitCode !== 0) throw new Error(stderr.trim() || `OpenClaw exited with status ${exitCode}.`);
    return stdout;
  }
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
    const action = JSON.parse(text) as ResourceMissionAction;
    if (!action || typeof action !== "object" || typeof action.type !== "string") throw new Error();
    return action;
  } catch {
    throw new Error("OpenClaw returned a decision that was not a resource mission action.");
  }
}

