# EVA suit resources

The CLI automatically starts the local API when `HABITAT_API_BASE_URL` points to localhost. You can now run commands directly; use `bun run server` only when you want to watch server logs. Set `HABITAT_AUTO_START_LOCAL_API=0` to disable this behavior. Remote API URLs are never auto-started.

The simulation treats each tile as 100 metres and each completed tick as one second.

- Suit battery: 100 units maximum; consumes 1 unit per deployed-human tick.
- Suit oxygen: 100 units maximum; consumes 1 unit per deployed-human tick.
- Low-resource threshold: 25% of either maximum (25 units).
- Estimated endurance: 100 ticks from a fresh deployment. The shorter remaining resource wins.

Deployment resets both resources to full. Ticks do not drain them while everyone is inside. Resource values, exhaustion, and alerts are stored in SQLite. The tick handler writes the registration, tick results, EVA resources, and resource alerts in one SQLite transaction. Values clamp at zero.

An EVA must reserve enough time to return: movement is one cardinal tile at a time and docking is only allowed at (0, 0). Spending the final available ticks travelling away leaves no time to get home; reaching zero exhausts the EVA and permanently rejects further movement, scanning, and collection until the state is inspected and the habitat is reset/re-registered.

## CLI verification plan

1. `habitat eva deploy <human-id>` then `habitat eva status`; verify 100/100 battery and oxygen.
2. Run `habitat tick --ticks 5`; verify both are 95/100.
3. Move to `(1,0)`, then `(2,0)`, return one tile at a time, and dock. Verify resources did not drain during movement and docking clears active EVA.
4. Run ticks while docked; verify resources remain full/empty-state values and no EVA drain occurs.
5. Deploy again, run 75 ticks, verify low alerts; run 25 more, verify the exhausted alert and both values at zero. Verify move, scan, and collection are rejected and status remains exhausted.
6. Try an invalid multi-tile move or invalid tick count and verify the persisted status is unchanged.
