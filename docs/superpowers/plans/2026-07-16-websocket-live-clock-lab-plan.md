# WebSocket Dashboard and Kepler Live Clock Plan

**Goal:** Finish the local dashboard WebSocket migration and extend the same persistent Hono backend with an authenticated Kepler live-clock listener, while keeping the CLI and dashboard as clients of the local Habitat API.

**Current foundation:** The repository already has a Bun/Hono server-side realtime registry, `/ws` endpoint, typed snapshots, mutation broadcasts, ordering protection, deployment smoke checks, and 53 passing tests. The remaining dashboard work must be merged with the other dashboard task before editing `web/*`.

## Phase 1: Protect and verify the starting point

1. Wait for the concurrent dashboard task to finish and review its changes before touching overlapping files.
2. Run `git status`, preserve the runtime database, and create the required checkpoint:

   ```bash
   git tag before-kepler-live-clock
   ```

3. Inspect the live Kepler docs and OpenAPI contract together with the current registration code in `src/server.ts`, `src/state.ts`, `src/sqlite-state.ts`, and `src/types.ts`. Confirm the exact registration response, WebSocket hello/ack, and `planet_tick` message fields before implementation.

## Phase 2: Complete the local dashboard WebSocket migration

1. Add the browser WebSocket client in `web/realtime.ts` with same-origin `ws://`/`wss://` URL construction, JSON validation, bounded exponential reconnect, cleanup, and connection states.
2. Update `web/api.ts` to consume the typed server snapshot and preserve REST command methods.
3. Update `web/main.tsx` to use the WebSocket snapshot as the live source, remove the main registration/module/power/solar/alert polling intervals, and retain REST bootstrap/fallback while disconnected.
4. Add connected/reconnecting/offline-fallback UI in `web/main.tsx` and `web/styles.css`. Keep dashboard and CLI connected only to the local Habitat API; neither may connect directly to Kepler.
5. Add browser/model tests for snapshot application, malformed frames, reconnect backoff, cleanup, and fallback behavior.
6. Build and verify:

   ```bash
   ~/.bun/bin/bunx tsc --noEmit
   ~/.bun/bin/bun test
   ~/.bun/bin/bun run web:build
   ```

## Phase 3: Persist Kepler stream credentials and clock state

1. Extend the existing registration state with `streamUrl`, the Habitat-specific `apiToken`, and returned `stream` metadata. Store exactly one authoritative copy of the token with registration; never log it or commit it.
2. Add an additive SQLite migration for clock state, preserving all existing habitat, module, human, inventory, construction, power, atmosphere, exploration, and alert tables. Persist at least:
   - `mode`: `manual` or `kepler`;
   - `listening`: boolean;
   - `connectionStatus`: `disconnected`, `connecting`, `connected`, or `error`;
   - latest absolute Kepler tick;
   - latest applied `advancedBy`;
   - last connection/message timestamps;
   - latest connection error.
3. Default registration to manual mode/listening off. Preserve clock mode across service restart.
4. Update `habitat status` and global `--json` output to reveal the saved stream URL, full stream API token, subscriptions, stream metadata, and registration-time clock information locally. Keep token exposure limited to explicit local operator output and never include it in logs or public artifacts.
5. Add tests for registration round-trip, migration preservation, default manual mode, restart persistence, and stable JSON field names.

## Phase 4: Add the backend-owned Kepler WebSocket client

1. Create a focused module such as `src/kepler-clock.ts`; keep connection logic out of the main Hono route wiring.
2. When listening is turned on, save Kepler mode before opening the connection. Connect to the saved `streamUrl` without putting the token in the URL or query string.
3. Send exactly the authenticated hello payload:

   ```json
   {"type":"hello","apiToken":"<saved token>","subscribe":["ticks"]}
   ```

4. Validate `hello_ack`, including the saved `habitatId` and advertised subscription capabilities, before accepting tick notices.
5. Parse JSON defensively. Accept only future `planet_tick` notices with a positive whole-number `advancedBy`; ignore duplicates or older absolute ticks.
6. Apply `advancedBy` exactly once through the existing shared simulation tick operation. Persist the received tick, applied amount, and simulation changes together.
7. Reconnect after unexpected disconnects with backoff, without replaying missed ticks. Stop cleanly when listening is disabled or the backend exits. Do not expose the token in journal output.
8. Add tests with a fake WebSocket server for hello authentication, ack validation, duplicate/old tick rejection, `advancedBy` values 1/10/100, reconnect without catch-up, clean shutdown, and connection-error persistence.

## Phase 5: Expose local clock API, CLI, and event watch

1. Add local API routes:
   - `GET /clock/status`
   - `POST /clock/listen/on`
   - `POST /clock/listen/off`
   - `GET /clock/events` as a local Server-Sent Events stream.
2. Broadcast each accepted Kepler tick through the existing local realtime/event infrastructure and the SSE stream. Events must include absolute tick, `advancedBy`, `issuedAt`, and whether local simulation applied it. Do not replay events on a new watch connection.
3. Add CLI commands:

   ```text
   habitat clock status
   habitat clock listen on
   habitat clock listen off
   habitat clock watch
   ```

4. Make `habitat clock watch` consume only local `/clock/events`; it must never open a Kepler connection, replay earlier events, print the API token, or stop the backend on Ctrl+C. If JSONL is supported, define one stable object per event.
5. Gate manual `habitat tick <count>` on persisted listening state: allow it in manual mode, reject it clearly while Kepler listening is on, and restore it immediately after listening is turned off and any active tick finishes.
6. Add CLI/API tests for manual mode, listen transitions, rejected manual ticks, SSE future-only behavior, JSON output, and restart persistence.

## Phase 6: Integrate dashboard clock state

1. Extend the local realtime dashboard snapshot with clock status and latest applied Kepler tick.
2. Add a dashboard clock indicator and latest-tick display using the local Habitat WebSocket snapshot; do not add a browser-to-Kepler connection.
3. Ensure dashboard actions continue using local REST commands and receive their resulting state through the local WebSocket.
4. Test that manual ticks, dashboard ticks, and Kepler ticks converge on the same server snapshot and power history.

## Phase 7: Verification and submission

1. Run the complete local checks:

   ```bash
   ~/.bun/bin/bunx tsc --noEmit
   ~/.bun/bin/bun test
   ~/.bun/bin/bun run web:build
   bash deploy/smoke-test.sh http://127.0.0.1:8787
   ```

2. On the persistent server, pull/build/restart the user service and verify both dashboard and clock state survive restart.
3. Verify manually:
   - registration saves and locally reveals stream credentials;
   - manual ticks work with listening off;
   - listening on persists before connection and blocks manual ticks;
   - `clock watch` reports only future ticks and full `advancedBy` values;
   - duplicate, old, missed, and disconnected ticks are not replayed;
   - listening off closes the connection and restores manual ticks;
   - restart reconnects when saved mode is Kepler.
4. Capture journal evidence without exposing the token, and record the reason missed ticks are intentionally not replayed.
5. Commit all lab changes with the exact message:

   ```text
   Connect Habitat to the Kepler live clock
   ```

6. Push to the existing public repository and submit its public GitHub URL.

## Main risks to control

- Do not edit `web/*` until the concurrent dashboard task is merged or otherwise reconciled.
- Do not create a second token store or put the token in URLs/logs.
- Do not let the CLI or browser connect directly to Kepler.
- Do not implement a second simulation tick path; manual and Kepler ticks must share one operation.
- Do not replay missed ticks after reconnect or after listening is enabled.
- Keep REST endpoints working for compatibility and use the local server as the only dashboard/CLI state source.
