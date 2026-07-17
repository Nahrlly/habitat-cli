# Task 2: Resource Mission Lifecycle Report

## Scope

Implemented the persistent resource-mission state contract without modifying mission control, REST routes, dashboard code, or existing Habitat data models. The committed scope is limited to the new mission contract, SQLite-backed state module, focused tests, additive SQLite tables, and this report.

## Lifecycle Contract

- Defined the requested mission statuses: `idle`, `running`, `stopping`, `completed`, and `failed`.
- Defined stop reasons for operator requests, capacity, low battery/oxygen, unsafe actions, dependency failures, timeout, and normal completion.
- Added stable mission and iteration IDs, ISO timestamps, current action, terminal error, stop reason, and final EVA snapshot fields.
- Added `loadActiveResourceMission`, `startResourceMission`, `updateResourceMission`, `appendResourceMissionIteration`, `finishResourceMission`, and `loadResourceMissionReport`.

## Persistence and Concurrency

- Added `resource_missions` and `resource_mission_iterations` using stable text primary keys, timestamps, a foreign key, and unique per-mission iteration sequences.
- Active missions receive the unique `active_key = 'active'`; terminal missions clear it. `startResourceMission` wraps the active check and insert in `BEGIN IMMEDIATE`, and the unique constraint remains a database-level backstop for concurrent callers.
- Iteration appends allocate the next sequence in an immediate transaction and refuse terminal missions, making finalized reports immutable.
- Reports aggregate persisted scan payloads, collected-resource quantities, iteration and terminal errors, stop reason, and final EVA state.

## TDD Evidence

- Initial focused run failed because `./resource-mission-state.js` did not exist, before implementation was added.
- Self-review added a terminal-state regression test. It failed because a completed mission accepted another iteration; the implementation was then changed to reject it.
- Focused lifecycle tests now cover no active mission, active mission loading, duplicate-start rejection, append ordering, operator stop, completion/report aggregation, failure/error persistence, and terminal append rejection.

## Verification

```text
~/.bun/bin/bun test src/resource-mission.test.ts  # 8 pass, 0 fail
~/.bun/bin/bunx --bun tsc --noEmit               # exit 0
~/.bun/bin/bun test                               # 124 pass, 0 fail
```

## Self-Review

- Confirmed mission starts and iteration appends use immediate transactions.
- Confirmed the unique active key prevents two active mission rows.
- Confirmed reports are reconstructed solely from persisted rows and iteration order is explicit.
- Confirmed existing `sqlite-state.ts` worktree changes at unrelated locations are left unstaged.
- Confirmed no existing Habitat table or data migration was rewritten or removed.
