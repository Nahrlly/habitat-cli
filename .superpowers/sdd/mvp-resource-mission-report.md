# MVP Resource Mission Report

## Scope Delivered

- Added a server-owned, single active resource mission loop backed by the existing SQLite mission lifecycle tables.
- Added `POST /autonomy/mission/start`, `GET /autonomy/mission/status`, `POST /autonomy/mission/stop`, and `GET /autonomy/mission/report`.
- Start returns `202` immediately. The controller runs asynchronously through the existing local EVA, scan, collect, move, and dock REST routes.
- The deterministic chooser alternates the existing scan contract (`strength=50`, `radius=1`) and a one-kilogram collection action. Its typed decision boundary can be replaced by an OpenClaw Gateway bridge later.
- The controller permits only Habitat-validated actions, stops work at full capacity or battery/oxygen at or below 25%, returns with one-tile cardinal moves to `(0,0)`, and docks.
- Stop marks the persisted mission as stopping; the running loop returns and docks rather than beginning another resource action.
- Added typed dashboard API wrappers and a focused panel in the existing Humans/EVA view. Existing EVA graph, scan map, and resource-art components were not rewritten.

## Deliberately Deferred

- OpenClaw Gateway transport, credentials, prompt construction, and rich mission analytics.
- Exploration movement away from the origin. The MVP uses safe scan and collection work at the deployed position, while retaining cardinal return logic for any non-origin EVA state.
- Automatic restart of a persisted in-flight loop after a backend process restart.

## Verification

- Focused: `~/.bun/bin/bun test src/resource-mission-controller.test.ts src/resource-mission-routes.test.ts web/api.test.ts` (`8 pass`).
- TypeScript: `~/.bun/bin/bunx --bun tsc --noEmit` (passed).
- Full suite: `~/.bun/bin/bun test` (`129 pass`, `0 fail`).
- Dashboard build: `~/.bun/bin/bun run web:build` (passed).
