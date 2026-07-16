# OpenClaw Habitat Autonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-scheduled OpenClaw autonomy loop that inspects live Habitat state, chooses a bounded deployment or collection action, executes it through the existing local API, and records every result.

**Architecture:** Keep `src/commands.ts` as a thin Commander adapter. Add policy, action execution, controller orchestration, and persisted audit/schedule state as separate modules. The controller obtains a fresh snapshot from the local API, rejects unsafe candidates deterministically, asks OpenClaw to select only from the legal action list, executes at most one action per cycle, and writes an audit record.

**Tech Stack:** TypeScript, Bun, Commander, Hono, existing `api-client.ts`, existing SQLite-backed state, OpenClaw cron.

## Global Constraints

- Use the existing `habitat-cli` repository structure and keep `src/index.ts` thin.
- Prefer focused modules over one large orchestration file.
- Use the live Habitat state and local API as the source of truth.
- Keep schedule timing configurable by the user.
- OpenClaw may decide actions, but hard safety rules must always win.
- Do not require manual editing of generated state files during normal operation.
- Preserve human-readable CLI output for operators.
- Fail closed when the local API or required Habitat state is unavailable.
- Execute no more than one mutating autonomous action per cycle.

---

## File Map

- Create `src/autonomy-policy.ts` for typed action candidates, eligibility checks, bounds/capacity guards, and policy reasons.
- Create `src/autonomy-actions.ts` for calls to `/eva/deploy`, `/eva/move`, and `/world/collect` through the existing API client.
- Create `src/autonomy-state.ts` for schedule configuration, running state, and append-only audit records using the existing persistence conventions.
- Create `src/autonomy-controller.ts` for snapshot, policy, OpenClaw decision, single-action execution, and audit orchestration.
- Create `src/autonomy-cli.ts` for command option parsing and human-readable summaries.
- Modify `src/commands.ts` only to register `habitat autonomy start|stop|status|run-now`.
- Modify `README.md` and `ORDERS.md` with setup, schedule, safety, and OpenClaw invocation instructions.
- Create `src/autonomy-policy.test.ts` and `src/autonomy-controller.test.ts`; extend the nearest state/integration tests only where shared persistence or API wiring requires it.

## Task 1: Establish Typed Policy Contracts

**Files:** Create `src/autonomy-policy.ts`; create `src/autonomy-policy.test.ts`.

**Interfaces:** Define `AutonomyAction`, `AutonomySnapshot`, `PolicyDecision`, and `evaluateAction(snapshot, action, cycleId): PolicyDecision`. Reuse the existing `HabitatHuman`, `HabitatEvaState`, registration/module, and inventory types instead of inventing parallel state shapes.

- [ ] Write failing tests for: one idle human deploy allowed; deployed human cannot redeploy; collection over capacity blocked; move outside server-reported bounds blocked; repeated cycle action blocked; missing registration/API snapshot blocked.
- [ ] Run `bun test src/autonomy-policy.test.ts` and confirm the new tests fail for missing exports.
- [ ] Implement the smallest pure policy functions. Every blocked decision must include a stable code and short operator-facing reason; no function may perform I/O.
- [ ] Run `bun test src/autonomy-policy.test.ts` and confirm all policy cases pass.
- [ ] Commit with `feat: add autonomy safety policy`.

## Task 2: Add Action Adapters and Audit Persistence

**Files:** Create `src/autonomy-actions.ts`; create `src/autonomy-state.ts`; create `src/autonomy-state.test.ts`.

**Interfaces:** `executeAutonomyAction(action): Promise<ActionResult>` calls existing local API routes. `loadAutonomyConfig()`, `saveAutonomyConfig(config)`, `appendAutonomyAudit(record)`, and `listAutonomyAudits(limit)` own persistence. Audit records contain `timestamp`, `scheduleName`, `snapshotSummary`, `chosenAction`, `policyResult`, `actionResult`, and `operatorNote`.

- [ ] Write failing adapter tests with a mocked API client for deploy, move, collect, and unknown-action rejection.
- [ ] Write failing state tests for default stopped configuration, save/load round trip, append-only audit order, and bounded audit listing.
- [ ] Run the focused tests and verify they fail before implementation.
- [ ] Implement adapters using the existing `api-client.ts` and route payloads: `/eva/deploy` with `humanId`, `/eva/move` with numeric `x` and `y`, and `/world/collect` with `quantityKg`.
- [ ] Implement persistence using the repository's existing SQLite/state helpers and preserve unrelated existing state files and migrations.
- [ ] Run `bun test src/autonomy-actions.test.ts src/autonomy-state.test.ts` and confirm pass.
- [ ] Commit with `feat: add autonomy actions and audit state`.

## Task 3: Implement the Controller Decision Loop

**Files:** Create `src/autonomy-controller.ts`; create `src/autonomy-controller.test.ts`.

**Interfaces:** `runAutonomyCycle(input): Promise<AutonomyRunResult>` performs one cycle. The input includes `scheduleName`, `cycleId`, a snapshot loader, an OpenClaw decision function, and an action executor so tests can inject deterministic dependencies.

- [ ] Write failing tests for the exact sequence: load fresh snapshot, evaluate candidates, pass only legal actions to the decision function, execute one action, append audit; also test no-op when no legal action exists and fail-closed behavior when snapshot loading or execution fails.
- [ ] Run `bun test src/autonomy-controller.test.ts` and confirm failure.
- [ ] Implement candidate generation for deploy, move, collect, and no-op from the current snapshot. Run policy checks before calling OpenClaw. Reject a decision not present in the legal action set and never fall back to a second mutating action.
- [ ] Format the OpenClaw decision prompt as structured JSON input containing the snapshot summary, recent audit history, schedule, blockers, and legal actions; require a single action identifier or `noop`.
- [ ] Append an audit record for blocked, no-op, successful, and failed cycles, including the reason and post-action summary when available.
- [ ] Run the focused controller tests and confirm pass.
- [ ] Commit with `feat: add autonomous habitat controller`.

## Task 4: Wire CLI Controls and Operator Configuration

**Files:** Create `src/autonomy-cli.ts`; modify `src/commands.ts`; modify `README.md`; modify `ORDERS.md`.

**Interfaces:** Register `autonomy start`, `autonomy stop`, `autonomy status`, and `autonomy run-now`. Accept intervals matching `^(\\d+)(m|h|d)$`, plus optional `--name`, `--quiet-hours`, and `--min-resource-kg` values. `run-now` must execute exactly one cycle and print schedule, action/no-op, policy reason, and Habitat summary.

- [ ] Add CLI tests or command-level assertions for interval parsing, invalid interval rejection, start/stop/status output, and `run-now` delegation.
- [ ] Implement `autonomy-cli.ts` as an adapter over state and controller functions; keep API calls and policy logic out of Commander callbacks.
- [ ] Add OpenClaw cron instructions using a variable-driven channel target and a message that tells the isolated agent to work in the Habitat workspace, read `ORDERS.md`, and invoke the one-cycle command with its available execution tool.
- [ ] Document safety gates, pause/quiet-hour semantics, audit location, and exact quick test commands in `README.md` and `ORDERS.md`.
- [ ] Run `bun test` and `bun run start -- autonomy --help`; verify all four subcommands are listed and invalid schedules fail with readable text.
- [ ] Commit with `feat: expose scheduled autonomy controls`.

## Task 5: Verify Local API Integration and End-to-End Behavior

**Files:** Modify `src/server-static.test.ts` or the closest existing integration suite; modify `src/state.test.ts` only if shared persistence integration needs coverage; create/update a smoke test script only if the existing test harness has no suitable entrypoint.

**Interfaces:** Exercise the real local API boundary while mocking only the external OpenClaw decision and Kepler network where necessary.

- [ ] Add an integration test that starts the local API, seeds a registered Habitat and eligible human, runs one cycle, and verifies the action endpoint result and persisted audit.
- [ ] Add tests proving collection capacity and EVA deployment errors are surfaced without writing a false success audit.
- [ ] Run the repository's standard checks: `bun test`, `bun run build` if available through `package.json`, and the existing `test.sh` through WSL with `~/.bun/bin/bun` when native PATH is insufficient.
- [ ] Run a manual smoke sequence against a disposable local state: `habitat autonomy start --every 5m`, `habitat autonomy status`, `habitat autonomy run-now`, inspect the audit output, then `habitat autonomy stop`.
- [ ] Review `git diff` and `git status --short`; stage only autonomy files and leave the pre-existing modified SQLite/types/node_modules files untouched.
- [ ] Commit with `test: verify habitat autonomy loop`.

## Task 6: Configure OpenClaw Scheduling and Handoff

**Files:** Modify `README.md` and `ORDERS.md` only if final command wording changes after verification.

- [ ] Configure the user-selected OpenClaw cron interval outside the application, using the documented `habitat autonomy run-now` command as the single-cycle entrypoint.
- [ ] Confirm the Gateway has the required approved scopes and that the isolated session exposes command execution; if it does not, use an OpenClaw command job or fix pairing/approval before enabling the schedule.
- [ ] Run one cron job manually and verify the Habitat audit record changes, then verify the next scheduled run produces no duplicate action in the same cycle.
- [ ] Record the deployed commit hash and final verification commands in the handoff; do not include credentials, device codes, private IPs, or channel IDs.

## Final Verification Checklist

- [ ] `bun test` passes.
- [ ] CLI help exposes all autonomy commands.
- [ ] Invalid intervals are rejected.
- [ ] No action occurs without a fresh valid Habitat snapshot.
- [ ] At most one mutating action occurs per cycle.
- [ ] Deploy, move, and collection policy gates are enforced before OpenClaw selection.
- [ ] Every cycle creates an audit record.
- [ ] OpenClaw cron invokes one cycle on the user-selected schedule.
- [ ] Existing unrelated worktree modifications remain unstaged.
