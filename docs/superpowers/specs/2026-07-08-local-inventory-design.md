# Local Inventory Design

## Goal

Add a basic local inventory to the Habitat CLI that supports:

- `inventory list`
- `inventory set <resourceId> <quantity>`
- `inventory add <resourceId> <amount>`

The first version is habitat-level only. It must be shaped so later Kepler-facing work can reuse the data model without a breaking storage rewrite.

## Scope

In scope:

- local habitat-level inventory persistence
- inventory command parsing and validation
- human-readable listing output
- inventory metadata fields that can later align with Kepler resource catalog data

Out of scope:

- Kepler API calls or sync
- automatic bootstrap from the Kepler catalog
- module-scoped inventory ownership
- consumption or production during ticks

## Recommended Approach

Use a dedicated local state file at `data/inventory.json`.

This keeps local mutable inventory separate from:

- `data/kepler.json`, which is primarily remote registration and blueprint cache
- `data/habitat-modules.json`, which is module runtime state

That separation matches the repo's current direction and reduces the risk that later Kepler refresh logic overwrites purely local inventory data.

## Data Model

Store inventory as an object rather than a bare array so future metadata can be added without reshaping the file.

```json
{
  "items": [
    {
      "resourceId": "water",
      "displayName": "Water",
      "quantity": 120,
      "unit": "L",
      "category": "consumable",
      "source": "local",
      "updatedAt": "2026-07-08T16:00:00.000Z"
    }
  ]
}
```

Each item contains:

- `resourceId`: stable storage key, intended to match a future Kepler resource id when available
- `displayName`: human-readable label
- `quantity`: current amount on hand
- `unit`: optional unit label such as `kg`, `L`, or `units`
- `category`: optional category for future catalog alignment
- `source`: `"local"` or `"kepler-catalog"`
- `updatedAt`: ISO timestamp of the last successful local mutation

## Command Behavior

### `inventory list`

- Reads `data/inventory.json`
- Prints a short table with resource id, display name, quantity, unit, category, and source
- Prints `No inventory found.` when empty

### `inventory set <resourceId> <quantity>`

- Creates or replaces one inventory item at the exact quantity provided
- If the item does not already exist, it is created
- Supports optional metadata flags:
  - `--name <displayName>`
  - `--unit <unit>`
  - `--category <category>`
- Defaults new items to:
  - derived display name from `resourceId`
  - `source = "local"`
  - blank optional metadata
- Rewrites `updatedAt` on success

### `inventory add <resourceId> <amount>`

- Increments an existing item quantity by the provided amount
- Creates the item if it does not exist yet
- Supports the same optional metadata flags as `set`
- Rewrites `updatedAt` on success

## Validation Rules

- `resourceId` must be non-empty
- storage should normalize the key into a stable lowercase id
- `quantity` and `amount` must be finite numbers
- first version rejects negative values for `add`
- `set` may accept zero
- metadata flags are optional and should preserve existing metadata when omitted

## File And Module Boundaries

Keep `src/index.ts` unchanged as the thin entrypoint.

Recommended additions:

- `src/inventory-state.ts`
  - ensure inventory file exists
  - load inventory
  - save inventory
  - normalize stored items
  - upsert inventory records
- `src/types.ts`
  - add shared inventory types
- `src/formatters.ts`
  - add inventory table formatting helpers if needed
- `src/commands.ts`
  - add an `inventory` command group that delegates to focused inventory state helpers

This keeps the command layer coordinating behavior while the inventory storage logic lives in a dedicated module.

## Error Handling

- malformed or missing inventory file should recover to an empty inventory state
- invalid numeric input should produce Commander argument errors
- unknown resources are allowed because first version is local-first, not catalog-enforced

## Testing And Verification

Minimum verification after implementation:

1. Run the CLI help for the new command group.
2. Set an initial item.
3. Add to the same item.
4. List inventory and confirm the updated quantity and metadata.
5. Confirm the file persisted to `data/inventory.json`.

Expected examples:

```text
habitat inventory set water 100 --unit L --category consumable
habitat inventory add water 25
habitat inventory list
```

## Open Future Path

This design intentionally leaves room for a later command such as catalog bootstrap or sync without changing the persisted item shape. Future Kepler-aware work can populate `unit`, `category`, and `source = "kepler-catalog"` while continuing to use `resourceId` as the stable key.
