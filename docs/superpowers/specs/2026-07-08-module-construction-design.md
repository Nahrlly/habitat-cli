# Module Construction Design

## Goal

Add a local module construction workflow to the Habitat CLI that:

- starts from a Kepler blueprint
- requires the needed inventory before construction can begin
- subtracts required resources immediately when construction starts
- delays module completion until the required ticks have elapsed
- supports `--dry-run` to validate requirements without changing state

The first version supports exactly one active construction job at a time.

## Scope

In scope:

- `module construct <blueprintId>`
- inventory requirement validation against blueprint inputs
- one active local construction job
- tick-driven construction progress and completion
- `--dry-run` validation without mutation

Out of scope:

- multiple parallel construction jobs
- remote Kepler construction APIs
- module construction cancellation or refund rules
- attachment point enforcement beyond existing local module wiring

## Recommended Approach

Use a dedicated local state file at `data/construction.json`.

This keeps construction progress separate from:

- `data/kepler.json`, which holds registration and blueprint cache
- `data/habitat-modules.json`, which should stay the source of truth for completed modules
- `data/inventory.json`, which should stay the source of truth for resources on hand

That separation preserves clear ownership and avoids mixing remote cache, completed modules, inventory, and in-progress build state in one file.

## Construction State Model

Store construction state as an object with either one active job or `null`.

```json
{
  "activeJob": {
    "blueprintId": "command-module",
    "displayName": "Command Module",
    "pendingModuleName": "Command Module",
    "ticksRequired": 8,
    "ticksRemaining": 8,
    "startedAt": "2026-07-08T20:00:00.000Z",
    "consumedInputs": [
      {
        "resourceId": "steel",
        "amount": 10
      }
    ],
    "connectedTo": []
  }
}
```

Each active job contains:

- `blueprintId`: stable blueprint identifier
- `displayName`: blueprint display name for user-facing status
- `pendingModuleName`: final display name to assign when the module completes
- `ticksRequired`: original build duration from the blueprint
- `ticksRemaining`: remaining ticks before completion
- `startedAt`: ISO timestamp for local tracking
- `consumedInputs`: exact resources subtracted when the job started
- `connectedTo`: optional resolved module ids to apply when the module is created

## Command Behavior

### `module construct <blueprintId>`

- resolves the blueprint from local registered blueprint cache
- validates:
  - habitat is registered
  - blueprint exists
  - no active construction job exists
  - all required inventory inputs exist with sufficient quantity
- if validation fails:
  - construction does not start
  - inventory is not changed
  - no construction job is written
  - no module is created
- if validation passes:
  - subtract required inventory immediately
  - create the active construction job in `data/construction.json`
  - do not create the module yet
  - print the blueprint name, consumed inputs, and required ticks

### `module construct <blueprintId> --dry-run`

- performs the same validation checks
- reports whether construction could start
- reports required inputs and tick cost
- never subtracts inventory
- never writes a construction job
- never creates a module

### `tick`

- keeps existing power behavior
- also advances the active construction job if present
- decrements `ticksRemaining` by the same tick count being applied
- if ticks remain after advancement:
  - persists the updated job
  - prints remaining construction time
- if the job reaches zero:
  - creates the finished module in local module state
  - clears the active job from `data/construction.json`
  - prints a completion message naming the new module

## Validation Rules

- construction must not start if requirements are not met
- missing or insufficient inventory means no mutation of any kind
- only one active construction job may exist at a time
- blueprints with empty or missing inputs may still construct if they exist
- `buildTicks` drives completion timing
- `--dry-run` must exercise the same validation path without mutating state

## File And Module Boundaries

Keep `src/index.ts` unchanged as the thin entrypoint.

Recommended additions and changes:

- `src/construction-state.ts`
  - ensure construction file exists
  - load and save active construction job
  - validate blueprint requirements
  - start construction
  - advance and complete construction during ticks
- `src/inventory-state.ts`
  - add helpers to check required inputs
  - add helpers to subtract required inputs atomically
- `src/types.ts`
  - add construction job and validation result types
- `src/formatters.ts`
  - add concise formatters for missing resources and construction status
- `src/commands.ts`
  - add `module construct`
  - call construction advancement from `tick`

This keeps orchestration in the command layer while inventory and construction state rules stay in focused modules.

## Data Flow

1. `module construct <blueprintId>`
   - load registration and blueprint
   - load inventory
   - validate requirements
   - if valid, subtract inventory and write the active job
2. `tick`
   - apply current power behavior
   - load the active construction job
   - decrement remaining ticks
   - on completion, create the final module and clear the job
3. completed modules remain stored only in `data/habitat-modules.json`

## Error Handling

- malformed or missing construction state should recover to no active job
- failed validation should explain which resources are missing or short
- starting a second job while one is active should fail clearly
- construction completion should not duplicate a module if a job is already cleared

## Testing And Verification

Minimum verification after implementation:

1. Dry-run a construct command with sufficient inventory and confirm no mutation.
2. Attempt construct with missing inventory and confirm no job starts.
3. Start construction with sufficient inventory and confirm resources are subtracted.
4. Tick fewer than required ticks and confirm no module exists yet.
5. Tick through completion and confirm the module appears only after enough ticks.

Expected examples:

```text
habitat module construct command-module --dry-run
habitat module construct command-module
habitat tick --ticks 3
habitat tick --ticks 5
```

## Open Future Path

This design leaves room for later extensions such as multiple queued jobs, cancellation rules, attachment enforcement, or richer build status commands without changing the basic separation of inventory, construction progress, and completed modules.
