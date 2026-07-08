# Construction Readiness Dry-Run Design

## Goal

Expand construction readiness checks so that `construct <blueprintId> --dry-run` reports a full local readiness checklist without mutating files, and real `construct <blueprintId>` uses the exact same checklist before deciding whether construction may start.

The dry run must report both things that are available and things that are missing or blocked.

## Scope

In scope:

- richer `construct --dry-run` readiness reporting
- full local checklist validation before any construction starts
- facility existence and status checks
- supply-cache gating for inventory access
- prerequisite checks
- inventory sufficiency checks
- reuse of the same report for real `construct`

Out of scope:

- changing tick-driven completion behavior
- changing inventory persistence format
- remote Kepler readiness checks
- multi-job construction

## Recommended Approach

Replace the current inventory-only construction validation with a structured readiness report.

This keeps construction rules in one place and avoids spreading command gating across:

- `src/commands.ts`
- inventory helpers
- module status lookups
- ad-hoc facility checks

One readiness report should be the source of truth for both:

- `construct <blueprintId> --dry-run`
- `construct <blueprintId>`

## Readiness Report Model

Represent readiness as a checklist of explicit checks plus an overall decision.

Each check should contain:

- `label`: short name for the requirement
- `ok`: pass/fail
- `details`: human-readable explanation

The full report should contain:

- `blueprintId`
- `displayName`
- `canStart`
- `checks`
- inventory detail rows for required resources

The report must always evaluate all local checks, even if earlier checks fail.

## Required Checks

The readiness report should evaluate all of the following:

- active construction slot available
- supply cache exists
- supply cache is online
- required facility exists
- required facility meets minimum level when the blueprint declares one
- required facility is online or active enough to use
- workshop fabricator exists if it is the required facility
- workshop fabricator is online or active if it is the required facility
- blueprint prerequisites are satisfied
- required inventory resources are sufficient

For this first version, “online or active enough to use” means:

- module status is `online` or `active`

Statuses like `offline`, `idle`, or `damaged` should block construction readiness unless you later define a different rule explicitly.

## Command Behavior

### `construct <blueprintId> --dry-run`

- loads registration, modules, inventory, and construction state
- builds the full readiness report
- prints the full checklist report every time
- prints inventory sufficiency details every time the blueprint declares required inputs
- prints a final summary line:
  - `Construction can start.`
  - or `Construction cannot start.`
- never subtracts inventory
- never writes `construction.json`
- never creates a module

### `construct <blueprintId>`

- builds the exact same readiness report first
- if any required check fails:
  - prints the same readable report
  - does not subtract inventory
  - does not write `construction.json`
  - does not create a module
- if all required checks pass:
  - starts construction using the existing local workflow
  - subtracts inventory
  - writes the active construction job

## Output Shape

Recommended output sections:

1. heading naming the blueprint
2. compact checklist table with:
   - `Check`
   - `Status`
   - `Details`
3. compact inventory table when the blueprint has inputs:
   - `Resource`
   - `Required`
   - `Available`
   - `Missing`
4. final summary line

This keeps the report readable while still showing all local blockers in one place.

## Gating Rules

Construction must not start unless all required checks pass.

Important explicit rules:

- if the supply cache is missing, inventory access is blocked
- if the supply cache exists but is not online or active, inventory access is blocked
- if the required facility is missing, construction is blocked
- if the required facility exists but is not online or active, construction is blocked
- if prerequisites are missing, construction is blocked
- if inventory is short, construction is blocked
- dry-run must still show all checks, not just the first blocker

## File And Module Boundaries

Keep `src/index.ts` unchanged as the thin entrypoint.

Recommended additions and changes:

- `src/construction-state.ts`
  - build the full readiness report
  - own the overall `canStart` decision
  - keep actual job-start logic separate from report construction
- `src/inventory-state.ts`
  - continue owning inventory-specific requirement checks
  - return inventory detail rows that can be included in the readiness report
- `src/types.ts`
  - add `ConstructionCheckResult`
  - add `ConstructionReadinessReport`
- `src/formatters.ts`
  - add a checklist report formatter
  - keep the inventory shortage table compact and reusable
- `src/commands.ts`
  - print the readiness report for dry-run
  - print the same report when real construct is blocked
  - only start construction when the report allows it

## Data Flow

1. `construct <blueprintId> --dry-run`
   - resolve blueprint
   - evaluate full readiness report
   - print report
   - return without mutation
2. `construct <blueprintId>`
   - resolve blueprint
   - evaluate same readiness report
   - if blocked, print report and return without mutation
   - if allowed, proceed with existing start flow
3. `tick`
   - unchanged in purpose
   - only advances jobs that already started

## Error Handling

- malformed local state should recover into clear failed checks rather than crashing when possible
- missing supply cache should appear as a checklist failure, not only as a generic inventory failure
- missing prerequisites should list which blueprint/module requirements are not satisfied
- blocked real construct should still present the full report before returning

## Testing And Verification

Minimum verification after implementation:

1. Dry-run a blueprint where all checks pass and confirm the report says construction can start.
2. Dry-run a blueprint where several checks fail at once and confirm all failures are shown together.
3. Run real construct with failing checks and confirm the same report prints with no file mutation.
4. Run real construct with passing checks and confirm construction still starts normally.

Expected examples:

```text
habitat construct small-solar-array --dry-run
habitat construct workshop-fabricator --dry-run
habitat construct command-module
```

## Open Future Path

This readiness-report model leaves room for later additions such as attachment checks, power-cost gating, crew gating, or richer facility-level validation without changing the core command surface.
