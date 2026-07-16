# WebSocket Dashboard Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard’s repeated live-state polling with a reconnecting WebSocket stream so CLI and dashboard mutations appear on every connected dashboard without waiting for the next polling interval.

**Architecture:** Keep REST as the initial snapshot and command transport, but add a Bun native WebSocket endpoint at `/ws`. A focused server event bus broadcasts a normalized habitat snapshot after every successful state mutation, including registration, module status, inventory, construction, ticks, human movement, and alerts. The React dashboard applies snapshots from the socket, reconnects with backoff, and falls back to REST polling only while the socket is unavailable.

**Tech Stack:** Bun `Bun.serve({ websocket })`, Hono route handling, React hooks, TypeScript, Bun tests, Vite production build.

## Global Constraints

- The persistent server SQLite database remains the single source of Habitat state.
- Browser requests remain same-origin; do not add CORS or a second public API origin.
- Do not expose secrets, SQLite files, source files, or the Vite development server.
- Preserve REST endpoints for CLI compatibility and initial page loading.
- Preserve mobile behavior: reconnect after Wi-Fi/cellular changes and show connection state.
- Use Bun for runtime, build, TypeScript, and tests; use WSL for Bun commands.
- Do not modify `data/habitat.sqlite` as part of implementation or commits.

## File Map

- Create `src/realtime.ts`: WebSocket client registry, snapshot type, safe broadcast, and connection lifecycle helpers.
- Modify `src/server.ts`: create the canonical dashboard snapshot, broadcast after successful mutations, and integrate Bun WebSocket upgrade handling with Hono.
- Modify `web/api.ts`: define the wire snapshot/event types and retain REST snapshot/command methods.
- Create `web/realtime.ts`: browser WebSocket URL construction, reconnect/backoff state machine, and message validation.
- Modify `web/main.tsx`: replace live-state intervals with the WebSocket hook, retain REST bootstrap and degraded-mode fallback, and expose connection status.
- Modify `web/styles.css`: styles for connected, reconnecting, and offline indicators.
- Modify `web/dashboard-model.ts` and/or create `web/realtime.test.ts`: pure snapshot merge and malformed-message behavior tests.
- Modify `src/server-static.test.ts` or create `src/realtime.test.ts`: server upgrade, broadcast, and mutation-event tests.
- Modify `DEPLOYMENT.md` and `docs/dashboard-persistent-server-plan.md`: document the WebSocket path, proxy upgrade requirement, fallback behavior, and smoke checks.
- Modify `deploy/smoke-test.sh`: verify the WebSocket endpoint can complete a local handshake when the deployment supports it.

### Task 1: Define the realtime contract

**Files:**
- Create: `src/realtime.ts`
- Modify: `web/api.ts`
- Test: `web/realtime.test.ts`

**Interfaces:**
- Server produces `HabitatRealtimeSnapshot` containing `registration`, `modules`, `humans`, `solar`, `power`, `powerHistory`, and `alerts` fields, with nullable registration when unregistered.
- Server sends `{ type: "snapshot", snapshot: HabitatRealtimeSnapshot, emittedAt: string }`.
- Server may send `{ type: "error", message: string }`; clients must ignore unknown event types.
- `src/realtime.ts` exports `addRealtimeClient`, `removeRealtimeClient`, and `broadcastRealtimeSnapshot`.

- [ ] Write tests for snapshot merge, unknown event types, malformed JSON, and a missing registration.
- [ ] Run `~/.bun/bin/bun test web/realtime.test.ts`; confirm the new tests fail because the contract/helper does not exist.
- [ ] Implement the shared types and a registry using `Set<ServerWebSocket<unknown>>`; catch per-client send failures and remove closed clients.
- [ ] Run the focused test again and confirm it passes.
- [ ] Commit: `Define dashboard realtime contract`.

### Task 2: Add the Bun WebSocket endpoint

**Files:**
- Modify: `src/server.ts`
- Test: `src/realtime.test.ts`

**Interfaces:**
- `GET /ws` upgrades only when `server.upgrade(request, { data: ... })` succeeds.
- A newly connected client receives one current snapshot immediately.
- The endpoint does not mutate state and does not require registration; an unregistered snapshot is valid.

- [ ] Add a failing server test that connects through `app.fetch`/the Bun server adapter and expects an initial `snapshot` frame.
- [ ] Run the focused test and confirm it fails before the upgrade handler exists.
- [ ] Change the server startup to keep the Hono `fetch` handler and add Bun `websocket: { open, message, close }` callbacks.
- [ ] Add `/ws` handling before the SPA catch-all; use the canonical snapshot builder for the initial frame.
- [ ] Reject non-upgrade `/ws` requests with a clear `426 Upgrade Required` response.
- [ ] Run the focused realtime/server tests and confirm they pass.
- [ ] Commit: `Add dashboard WebSocket endpoint`.

### Task 3: Broadcast state changes from the API

**Files:**
- Modify: `src/server.ts`
- Modify: `src/realtime.ts`
- Test: `src/realtime.test.ts`

**Interfaces:**
- Every successful state-changing route calls `broadcastCurrentSnapshot()` after persistence completes.
- The broadcast occurs after the SQLite write, so clients never receive a state that was not persisted.
- Failed commands do not broadcast.

- [ ] Add a failing test for `PATCH /modules/:selector/status` that observes a snapshot containing the updated status.
- [ ] Add equivalent mutation coverage for `/commands/tick`, `/commands/register`, `/commands/unregister`, inventory changes, construction start/cancel/completion, human movement, and alert creation.
- [ ] Run the focused tests and confirm they fail before broadcast calls are added.
- [ ] Implement one canonical snapshot builder that reads the same state used by REST endpoints; avoid duplicating business rules in the broadcaster.
- [ ] Add broadcasts after successful persistence for each mutation route, including construction completion during ticks.
- [ ] Run `~/.bun/bin/bun test src/realtime.test.ts src/human.test.ts src/inventory.test.ts`; confirm all pass.
- [ ] Commit: `Broadcast persisted habitat mutations`.

### Task 4: Replace dashboard polling with a reconnecting client

**Files:**
- Create: `web/realtime.ts`
- Modify: `web/main.tsx`
- Modify: `web/api.ts`
- Test: `web/realtime.test.ts`

**Interfaces:**
- `useHabitatRealtime(onSnapshot, onConnectionChange)` opens `ws://` or `wss://` using `window.location`, not a hard-coded host.
- Reconnect delays are bounded exponential backoff: 500 ms, 1 s, 2 s, 4 s, 8 s, then 15 s maximum.
- On `open`, the hook requests/accepts the initial snapshot and sets status to `connected`.
- On close/error, status becomes `reconnecting`; REST bootstrap/fallback remains available.

- [ ] Add tests for URL selection, reconnect delay progression, cleanup, and ignoring malformed frames.
- [ ] Run the focused tests and confirm they fail before the client hook exists.
- [ ] Implement the WebSocket hook and use the existing REST `refresh()` once on mount and whenever the socket is unavailable.
- [ ] Remove the main 2-second `setInterval` for registration/modules/solar/power/history/alerts.
- [ ] Remove the separate human polling interval; update humans from snapshots when available and fetch on view entry as fallback.
- [ ] Keep the 30-second history refresh only as a degraded fallback, then stop it while connected.
- [ ] Update mutation handlers to optimistically refresh from the socket, with a REST refresh only if no socket snapshot arrives promptly.
- [ ] Run the focused browser tests and confirm they pass.
- [ ] Commit: `Stream dashboard state over WebSocket`.

### Task 5: Add connection UX and deployment support

**Files:**
- Modify: `web/main.tsx`
- Modify: `web/styles.css`
- Modify: `DEPLOYMENT.md`
- Modify: `deploy/smoke-test.sh`
- Test: `src/server-static.test.ts`

- [ ] Add a visible status indicator with `Connected`, `Reconnecting`, and `Offline fallback` states; do not claim “Live” while polling fallback is active.
- [ ] Add a browser test or pure rendering/model test covering the status labels and unregistered snapshot behavior.
- [ ] Document that a reverse proxy must forward `Upgrade` and `Connection` headers for `/ws`.
- [ ] Add a smoke check that sends a WebSocket handshake to `ws://127.0.0.1:8787/ws` and verifies the first frame is a `snapshot`; keep REST health checks too.
- [ ] Run `~/.bun/bin/bun run web:build`, `~/.bun/bin/bunx tsc --noEmit`, and `~/.bun/bin/bun test`.
- [ ] Commit: `Document and verify dashboard realtime deployment`.

### Task 6: End-to-end verification and rollout

**Files:**
- Modify: `docs/dashboard-persistent-server-plan.md`

- [ ] Build and deploy the dashboard only after tests pass:

```bash
~/.bun/bin/bunx tsc --noEmit
~/.bun/bin/bun test
~/.bun/bin/bun run web:build
```

- [ ] On the server, pull the branch, build, and restart the user service:

```bash
cd ~/habitat-cli
git pull --ff-only
~/.bun/bin/bun install --frozen-lockfile
~/.bun/bin/bun run web:build
systemctl --user restart habitat-api-user
systemctl --user is-active habitat-api-user
```

- [ ] Verify from the laptop that `habitat module set-status suitport offline` changes the dashboard within one second, then restore it to `online`.
- [ ] Verify dashboard tick changes are reflected by `habitat power overview` against the same server URL.
- [ ] Disable Wi-Fi briefly or close/reopen the mobile browser and confirm the dashboard reconnects without manual refresh.
- [ ] Verify a service restart sends a fresh snapshot and the dashboard does not display stale local state.
- [ ] Record the measured reconnect behavior and deployment commands in `docs/dashboard-persistent-server-plan.md`.
- [ ] Commit: `Verify persistent dashboard realtime rollout`.

## Final Verification

Run from the repository root:

```bash
~/.bun/bin/bunx tsc --noEmit
~/.bun/bin/bun test
~/.bun/bin/bun run web:build
bash deploy/smoke-test.sh http://127.0.0.1:8787
```

Expected results:

- TypeScript exits with code 0.
- All unit and integration tests pass.
- Vite produces `dist/index.html` and assets.
- REST smoke checks pass and the WebSocket handshake receives a `snapshot` frame.
- Dashboard mutations and CLI mutations converge on the same persisted server snapshot.
