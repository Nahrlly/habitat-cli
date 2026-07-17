# OpenClaw Habitat Autonomy Design

**Goal:** Let OpenClaw run on a user-chosen schedule, inspect live Habitat state, decide when to deploy humans or collect resources, and execute those actions through the existing Habitat CLI and local API without violating hard safety limits.

**Architecture:** Keep Habitat CLI as the actuation layer and put decision-making in a small autonomous controller. Each scheduled run loads a fresh Habitat snapshot, evaluates deterministic safety gates first, then lets OpenClaw choose from the allowed actions. The controller records every decision and result so schedule behavior stays auditable.

**Tech Stack:** TypeScript, Bun, Commander, Hono, SQLite-backed Habitat state, OpenClaw cron scheduling, existing Kepler and local Habitat API clients.

## Global Constraints

- Use the existing `habitat-cli` repository structure and keep `src/index.ts` thin.
- Prefer focused modules over one large orchestration file.
- Use the live Habitat state and local API as the source of truth.
- Keep schedule timing configurable by the user.
- OpenClaw may decide actions, but hard safety rules must always win.
- Do not require manual editing of generated state files during normal operation.
- Preserve human-readable CLI output for operators.

---

### Task 1: Map the autonomy boundary

**Files:**
- Create: `docs/superpowers/specs/2026-07-16-openclaw-habitat-autonomy-design.md`
- Review: `AGENTS.md`
- Review: `src/commands.ts`
- Review: `src/server.ts`
- Review: `src/local-api.ts`
- Review: `src/human-domain.ts`
- Review: `src/eva-domain.ts`
- Review: `src/world/collect` and related Habitat world client code

**Interfaces:**
- Consumes: current CLI commands, current local API routes, current state persistence model
- Produces: a bounded automation surface that decides and acts through existing Habitat commands

- [ ] **Step 1: Write the scope note**

Describe the problem in one paragraph:

```md
OpenClaw should wake up on a user-defined schedule, read the current Habitat state, choose an allowed action, and execute it through the existing Habitat CLI or local API. The system must not bypass the current state model, and it must treat deployment, movement, and collection as explicit actuation steps rather than hidden background behavior.
```

- [ ] **Step 2: Confirm the hard boundaries**

Write the constraint list exactly as the implementation team must honor:

```md
- Schedule comes from user input, not a hard-coded interval.
- OpenClaw decides among allowed actions, but deterministic safety gates run first.
- Habitat state, humans, inventory, EVA state, and alerts come from the current Habitat API and SQLite-backed state.
- Actions must be replayable and logged with timestamps.
- If the local Habitat API is unavailable, the run must fail closed and take no action.
```

- [ ] **Step 3: Freeze the file boundaries**

List the minimum file split the implementation should use:

```md
- `src/autonomy-controller.ts` owns the decision loop.
- `src/autonomy-policy.ts` owns action eligibility and safety gates.
- `src/autonomy-actions.ts` owns the actual Habitat CLI/API calls.
- `src/autonomy-state.ts` owns persisted schedule metadata and audit history.
- `src/commands.ts` only wires CLI entrypoints and keeps orchestration thin.
```

### Task 2: Define the scheduled decision loop

**Files:**
- Review: `src/commands.ts`
- Review: `src/server.ts`
- Review: `src/state.ts`
- Review: `src/sqlite-state.ts`

**Interfaces:**
- Consumes: Habitat registration, humans, inventory, EVA status, power and resource state, schedule metadata
- Produces: one autonomous run result containing the chosen action, the reason, and the post-action state summary

- [ ] **Step 1: Write the failing behavior spec**

Document the exact loop in plain language:

```md
1. Load the latest Habitat snapshot.
2. Evaluate safety gates.
3. Build the set of legal actions.
4. Ask OpenClaw to choose one action from that set.
5. Execute the action through the Habitat CLI or local API.
6. Record the decision, the result, and the timestamp.
7. Return a concise operator summary.
```

- [ ] **Step 2: Specify the allowed action set**

Write the first-pass action menu:

```md
- Deploy an idle human if a deployment slot is open and the chosen human is eligible.
- Move a deployed human if the move keeps them within bounds and the destination is valid.
- Collect resources if the deployed human is in a valid location and carrying capacity allows it.
- Do nothing if no action passes the safety gates.
```

- [ ] **Step 3: Specify the decision inputs**

Define the inputs the controller must provide to OpenClaw:

```md
- Current Habitat snapshot.
- Recent autonomy history.
- User-configured schedule.
- Current resource levels.
- Current human deployment state.
- Any active alerts or blockers.
```

### Task 3: Encode safety gates and action guards

**Files:**
- Create: `src/autonomy-policy.ts`
- Review: `src/eva-domain.ts`
- Review: `src/human-domain.ts`
- Review: `src/inventory-state.ts`
- Review: `src/kepler-world.ts`

**Interfaces:**
- Consumes: current state snapshot, candidate action, policy thresholds
- Produces: `allowed | blocked` plus a short reason that can be shown to the operator

- [ ] **Step 1: Define the safety rules**

Write the hard-stop policy:

```md
- Never deploy more than one human into the same autonomous cycle.
- Never collect if carrying capacity would be exceeded.
- Never move outside the world bounds returned by Habitat.
- Never act when the local API or required state is unavailable.
- Never repeat an action that was already performed in the current cycle.
```

- [ ] **Step 2: Define the human-eligibility rules**

Spell out which humans can be considered:

```md
- Only humans present in Habitat state may be deployed.
- A human already deployed for EVA is not eligible for another deployment.
- A human assigned to a blocked or missing module is not eligible.
```

- [ ] **Step 3: Define resource-collection rules**

Write the collection guardrails:

```md
- Only collect after a valid deployment exists.
- Only collect when the current location is valid and known.
- Never collect more than the EVA can carry.
```

### Task 4: Wire the operator controls and schedule configuration

**Files:**
- Modify: `src/commands.ts`
- Modify: `README.md`
- Modify: `ORDERS.md`
- Create: `src/autonomy-cli.ts`

**Interfaces:**
- Consumes: user-provided schedule interval, autonomy mode, action thresholds, and stop conditions
- Produces: CLI commands for starting, pausing, inspecting, and stopping autonomy

- [ ] **Step 1: Define the CLI surface**

Specify the commands the user can run:

```md
- `habitat autonomy start`
- `habitat autonomy stop`
- `habitat autonomy status`
- `habitat autonomy run-now`
```

- [ ] **Step 2: Define the schedule input**

Write the accepted schedule formats:

```md
- Human-friendly intervals such as `5m`, `15m`, and `1h`.
- Optional quiet hours or pause windows.
- Optional resource thresholds that suppress action when below a limit.
```

- [ ] **Step 3: Define the operator output**

Describe what each run prints:

```md
- Current schedule state.
- Selected action or explicit no-op.
- Safety-gate reason if blocked.
- The resulting Habitat summary.
```

### Task 5: Add audit history and verification coverage

**Files:**
- Create: `src/autonomy-state.ts`
- Create: `src/autonomy-controller.test.ts`
- Create: `src/autonomy-policy.test.ts`
- Modify: `src/state.test.ts`
- Modify: `src/server-static.test.ts` or the closest existing integration suite

**Interfaces:**
- Consumes: decision records and Habitat snapshots
- Produces: persisted autonomy history plus test coverage for the schedule loop and guardrails

- [ ] **Step 1: Define the audit record shape**

Write the stored record fields:

```md
- timestamp
- schedule name
- snapshot summary
- chosen action
- policy result
- action result
- operator note
```

- [ ] **Step 2: Define the decision tests**

List the cases the implementation must prove:

```md
- A valid deployment is chosen when no human is deployed and a slot is open.
- A collection action is chosen only when carrying capacity allows it.
- A move is blocked when it leaves world bounds.
- A no-op is returned when no safe action exists.
- A failed local API call leaves no partial action behind.
```

- [ ] **Step 3: Define the smoke checks**

Describe the minimum end-to-end check:

```md
- Start the local API.
- Seed a registration snapshot.
- Run one autonomy cycle.
- Confirm the audit record was written.
- Confirm the chosen action matched the policy result.
```

## Spec Coverage

- User-chosen schedule: covered by Task 4.
- OpenClaw decides actions: covered by Tasks 2 and 4.
- Habitat CLI as actuation layer: covered by Tasks 1 and 2.
- Safety-first autonomy: covered by Task 3.
- Persistent audit trail: covered by Task 5.
- Human deployment and resource collection: covered by Tasks 2 and 3.

## Open Questions

- Which schedule syntax should be accepted first: simple intervals only, or interval plus quiet hours?
- Should autonomy be paused automatically when the local API is offline, or should it keep retrying until the next schedule tick?
- Should the controller choose from a fixed action list only, or may it also choose a "prepare" action that rebalances state before deployment?

