# OpenClaw Resource Mission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard-controlled, persistent OpenClaw resource mission that deploys one EVA human, scans and collects resources until capacity or the 25% oxygen/power threshold, then safely returns and docks.

**Architecture:** Extend the existing autonomy controller through focused mission, resource-cost, and persistence modules. Habitat owns the mission state and validates every action; OpenClaw supplies one decision per iteration from a typed legal-action set. Add a focused dashboard mission panel that calls mission REST endpoints and polls status without restructuring the existing EVA graph, scan map, or other dashboard views.

**Tech Stack:** TypeScript, Bun, Hono, existing SQLite state, React, existing REST/WebSocket dashboard, OpenClaw Gateway decision bridge, Bun tests.

## Global Constraints

- Preserve unrelated worktree changes, including `data/habitat.sqlite`, `src/sqlite-state.ts`, `src/types.ts`, generated dependency artifacts, and existing dashboard asset work.
- Keep `src/commands.ts` and `web/main.tsx` as thin coordinators; put mission behavior in focused modules.
- Habitat remains authoritative for deployment, movement, scanning, collection, battery, oxygen, capacity, return, and docking.
- OpenClaw may choose only from Habitat-provided legal actions and may never mutate SQLite or execute arbitrary shell commands.
- Only one active resource mission may exist at a time.
- Each mission iteration executes at most one mutating Habitat action.
- Use `0.25` oxygen and `0.25` power per EVA tick.
- A strength-100 scan consumes 1% of maximum EVA battery; scan cost scales linearly with strength.
- Stop collection at 25% battery, 25% oxygen, full carrying capacity, operator stop, no safe action, repeated dependency failure, or timeout.
- A capacity or low-resource stop must attempt a safe return to `(0, 0)` and dock before completion.
- Use WSL with `~/.bun/bin/bun` for Bun verification.

## File Map

- Create `src/resource-mission.ts` for mission lifecycle, loop ownership, stop reasons, and status/report types.
- Create `src/resource-mission-state.ts` for SQLite-backed active mission, iteration, action, scan, collection, and final-report persistence.
- Create `src/eva-resource-cost.ts` for tick consumption, proportional scan cost, low-resource thresholds, and return-reserve calculations.
- Modify `src/autonomy-policy.ts` and `src/autonomy-controller.ts` to expose mission-specific legal actions and resource-aware safety checks without removing the existing one-cycle CLI behavior.
- Modify `src/server.ts` to expose mission start/status/stop/report endpoints and to apply the new EVA tick and scan costs at the authoritative boundary.
- Modify `src/types.ts` only for shared mission and resource-cost contracts if existing types cannot be reused.
- Create `src/resource-mission.test.ts`, `src/eva-resource-cost.test.ts`, and focused server/API tests.
- Modify `web/api.ts` with typed mission wrappers.
- Create `web/resource-mission-panel.tsx` and `web/resource-mission-panel.test.tsx` if the repository's test setup supports component tests; otherwise test pure view models and API request shapes.
- Modify `web/main.tsx` only to mount the focused panel in the existing EVA/Humans area.
- Modify `web/styles.css` or the existing dashboard override file with scoped mission-panel styles only.
- Modify `README.md` and `ORDERS.md` with the button workflow, stop conditions, OpenClaw requirements, and verification commands.

### Task 1: Define EVA Resource Economics

**Files:** Create `src/eva-resource-cost.ts`; create `src/eva-resource-cost.test.ts`; modify the authoritative EVA tick/scan call sites in `src/server.ts` or `src/eva-domain.ts`.

**Interfaces:** Export `EVA_LOW_RESOURCE_RATIO = 0.25`, `EVA_TICK_OXYGEN_COST = 0.25`, `EVA_TICK_POWER_COST = 0.25`, `scanBatteryCost(maxBattery: number, strength: number): number`, `isLowEVAResource(current: number, maximum: number): boolean`, and `estimateReturnReserve(eva, distance): { oxygen: number; power: number }`.

- [ ] Write failing tests for 0, 50, and 100 scan strength; expected costs are 0%, 0.5%, and 1% of maximum battery.
- [ ] Write failing tests proving a 100-unit EVA has a 25-unit low-resource threshold and a one-tick move costs `0.25` oxygen and `0.25` power.
- [ ] Write failing tests for return reserve at Manhattan distances 0, 1, and 4.
- [ ] Run `wsl bash -lc "cd /mnt/c/Users/xxome/Downloads/labs/habitat-cli && ~/.bun/bin/bun test src/eva-resource-cost.test.ts"`; verify the new tests fail before implementation.
- [ ] Implement pure calculations with bounded inputs and no network or persistence access.
- [ ] Update the real EVA tick path to use the constants and update the scan route to deduct the calculated battery cost atomically with the scan.
- [ ] Run the focused tests and existing EVA tests; verify scan cost cannot make battery negative.
- [ ] Commit only the resource-economics files and authoritative call-site changes with `feat: calibrate EVA resource consumption`.

### Task 2: Add Mission State and Lifecycle Contracts

**Files:** Create `src/resource-mission-state.ts`; create `src/resource-mission.ts`; create `src/resource-mission.test.ts`; modify `src/sqlite-state.ts` only for additive tables/migrations.

**Interfaces:** Define `ResourceMissionStatus = "idle" | "running" | "stopping" | "completed" | "failed"`; `ResourceMissionStopReason`; `ResourceMission`; `ResourceMissionIteration`; `ResourceMissionReport`; and state functions `loadActiveResourceMission()`, `startResourceMission()`, `updateResourceMission()`, `appendResourceMissionIteration()`, `finishResourceMission()`, and `loadResourceMissionReport()`.

- [ ] Write failing state tests for no active mission, one active mission, duplicate start rejection, append-only iteration order, operator stop request, completion, and failure report persistence.
- [ ] Run the focused tests and confirm failure before implementation.
- [ ] Add SQLite tables with stable primary keys and timestamps; do not rewrite or delete existing Habitat tables/data.
- [ ] Implement transaction-safe start so concurrent starts cannot create two active missions.
- [ ] Implement report aggregation from persisted iterations, including scans, collected resources, stop reason, errors, and final EVA snapshot.
- [ ] Run `~/.bun/bin/bun test src/resource-mission.test.ts` in WSL and confirm pass.
- [ ] Commit with `feat: persist resource mission lifecycle`.

### Task 3: Extend the Autonomy Controller for Resource Missions

**Files:** Modify `src/autonomy-policy.ts`; modify `src/autonomy-controller.ts`; create `src/resource-mission-controller.ts`; create `src/resource-mission-controller.test.ts`.

**Interfaces:** Export `runResourceMission(input): Promise<ResourceMissionReport>`, `stopResourceMission(missionId): Promise<void>`, and typed `ResourceMissionAction` variants for `deploy`, `scan`, `move`, `collect`, `dock`, and `finish`. The controller receives an injected OpenClaw decision function and Habitat action executor in tests.

- [ ] Write failing tests for deploy-then-scan-then-collect sequencing, one action per iteration, full-capacity stop, 25% battery stop, 25% oxygen stop, safe return/docking, and no eligible human.
- [ ] Write failing tests proving scan and movement are rejected when return reserve would be violated.
- [ ] Write failing tests for invalid OpenClaw actions, repeated dependency failures, operator stop, and mission timeout.
- [ ] Run the focused controller tests and verify they fail before implementation.
- [ ] Generate each legal action from a fresh Habitat snapshot; include current EVA state, latest scan, inventory, bounds, resource reserves, and prior iterations in the OpenClaw decision input.
- [ ] Validate the selected action through Habitat policy before execution; fail closed on missing or malformed decisions.
- [ ] Use the existing `runAutonomyCycle` behavior unchanged for `autonomy run-now`; share policy and action adapters without changing its one-cycle contract.
- [ ] Implement return planning as bounded cardinal moves followed by `dock`, recording each step and stopping if the safety reserve is no longer sufficient.
- [ ] Run focused and full autonomy tests; commit with `feat: add persistent resource mission controller`.

### Task 4: Expose Mission REST Endpoints

**Files:** Modify `src/server.ts`; create/extend server route tests; modify `src/realtime.ts` only if mission status belongs in the existing snapshot.

**Interfaces:** Add `POST /autonomy/mission/start`, `GET /autonomy/mission/status`, `POST /autonomy/mission/stop`, and `GET /autonomy/mission/report`. Return typed JSON with mission ID, status, current action, EVA snapshot, progress, stop reason, and report. Return `409` for duplicate starts and `404` when no report exists.

- [ ] Add failing route tests for start, status, stop, report, duplicate start, and missing report.
- [ ] Implement routes as thin adapters over the mission controller/state modules; never put OpenClaw prompt construction or policy logic in Hono callbacks.
- [ ] Ensure the start endpoint launches the persistent loop without blocking the HTTP response and records startup/failure state if the loop cannot initialize.
- [ ] Ensure stop is idempotent and status remains observable while the human returns and docks.
- [ ] Add a server test that verifies scan battery and EVA tick resource changes are visible through `/eva/status`.
- [ ] Run the route tests and full suite; commit with `feat: expose resource mission API`.

### Task 5: Add Focused Dashboard Mission Controls

**Files:** Modify `web/api.ts`; create `web/resource-mission-panel.tsx`; create pure panel model tests; modify `web/main.tsx` only at the existing EVA/Humans mount point; modify the scoped dashboard stylesheet.

**Interfaces:** Add `habitatApi.startResourceMission()`, `habitatApi.resourceMissionStatus()`, `habitatApi.stopResourceMission()`, and `habitatApi.resourceMissionReport()`. The panel accepts typed status data and callbacks, and owns only mission display/polling state.

- [ ] Add request-shape tests for all four API wrappers before implementation.
- [ ] Add view-model tests for idle, running, stopping, completed, failed, full-capacity, and low-resource display states.
- [ ] Implement Start and Stop buttons with pending/disabled states; prevent duplicate starts in the browser while retaining server-side `409` protection.
- [ ] Poll mission status while active and refresh EVA/scan/resource views after each status update without replacing existing EVA graph or scan-popup state.
- [ ] Display current action, selected human, position, battery, oxygen, carry load, scan strength, collected resources, stop reason, and final report.
- [ ] Add scoped CSS only; do not rewrite shared dashboard layout or existing scan/EVA styles.
- [ ] Run focused web tests, `~/.bun/bin/bunx --bun tsc --noEmit`, and `~/.bun/bin/bun run web:build` through WSL.
- [ ] Commit with `feat: add dashboard resource mission controls`.

### Task 6: Integrate OpenClaw and Document Operations

**Files:** Modify `README.md`; modify `ORDERS.md`; add an OpenClaw decision adapter module only if the current controller has no reusable bridge.

**Interfaces:** The OpenClaw bridge receives structured mission state and legal actions and returns exactly one typed action. The documented dashboard flow starts the persistent mission; the existing CLI remains available for one-cycle testing.

- [ ] Define the OpenClaw prompt contract with mission ID, current snapshot, legal actions, stop thresholds, scan-cost rule, and explicit prohibition on arbitrary commands or direct state mutation.
- [ ] Configure the bridge to use the existing Gateway approval/tool model and return readable unavailable/timeout errors to the mission report.
- [ ] Document the dashboard button, Stop button, 25% thresholds, `0.25` tick costs, 1% strength-100 scan cost, and one-cycle CLI smoke command.
- [ ] Document exact quick checks: start mission, poll status, stop mission, inspect report, and verify `/eva/status`.
- [ ] Run `rg -n "token|device code|credential|private IP|DISCORD" README.md ORDERS.md`; ensure no secrets or private identifiers are added.
- [ ] Commit with `docs: document OpenClaw resource missions`.

### Task 7: Verify Without Disturbing Concurrent Dashboard Work

**Files:** No new production files; modify only files required by failing checks.

- [ ] Run `git status --short` before verification and record unrelated modifications; do not stage them.
- [ ] Run `wsl bash -lc "cd /mnt/c/Users/xxome/Downloads/labs/habitat-cli && ~/.bun/bin/bun test"`.
- [ ] Run `wsl bash -lc "cd /mnt/c/Users/xxome/Downloads/labs/habitat-cli && ~/.bun/bin/bunx --bun tsc --noEmit"`.
- [ ] Run `wsl bash -lc "cd /mnt/c/Users/xxome/Downloads/labs/habitat-cli && ~/.bun/bin/bun run web:build"`.
- [ ] Run the existing `test.sh` through WSL and verify the persistent service health endpoint if deployment is requested.
- [ ] Perform a disposable-state smoke test: start mission, observe at least one scan and collection iteration, confirm battery/oxygen changes, stop at capacity or threshold, confirm docking and report.
- [ ] Review `git diff --stat`, `git diff --check`, and staged paths; confirm concurrent dashboard files remain untouched unless explicitly included above.
- [ ] Commit verification changes only if they are required and independently meaningful.

## Final Verification Checklist

- [ ] One dashboard click starts one persistent mission.
- [ ] Only one active mission can exist.
- [ ] OpenClaw chooses only from typed legal actions.
- [ ] Habitat validates every action and fails closed.
- [ ] Scans use the existing Habitat scan contract and consume proportional battery.
- [ ] EVA movement/actions consume `0.25` oxygen and `0.25` power per tick.
- [ ] Mission stops at capacity or 25% battery/oxygen and safely docks.
- [ ] Stop, failure, and timeout paths produce reports.
- [ ] Existing EVA graph, scan map, resource art, and unrelated dashboard work remain functional.
- [ ] Full tests, TypeScript validation, and dashboard build pass.
