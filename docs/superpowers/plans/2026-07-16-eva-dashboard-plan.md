# EVA Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a switchable EVA graph to the Humans tab with live coordinates, path history, resource markers, and controls backed only by the existing REST API.

**Architecture:** Extend `web/api.ts` with typed wrappers for the existing EVA, scan, and collection routes. Keep server responses as the source of truth, with a focused pure graph-data helper for coordinate normalization and path/marker rendering. Add the EVA view beside the existing HumanTracker UI in `web/main.tsx`, using the existing dark dashboard styles in `web/styles.css`.

**Tech Stack:** React, TypeScript, Bun tests, Hono REST API, SVG/CSS for the graph.

## Global Constraints

- React uses only existing `/api`-equivalent REST routes exposed by the current Hono server.
- No Habitat business rules, credentials, or browser-only API routes are added.
- Server validation remains authoritative for EVA movement, deployment, suit resources, capacity, and collection.
- Scan markers remain view state only until the dashboard is refreshed or the view is left.
- Preserve unrelated working-tree changes, including local database and generated dependency artifacts.

### Task 1: Add typed EVA API contracts

**Files:**
- Modify: `web/api.ts`
- Modify: `web/main.tsx` only if shared types currently live there
- Test: `web/api.test.ts` or the repository's existing web/API test file

**Interfaces:**
- `EvaStatus` mirrors the server's `HabitatEvaState` fields: deployed human, `x`, `y`, carried resources, suit battery/oxygen, capacities, and estimated ticks.
- `ResourceScan` preserves server scan fields including tile coordinates, probabilities, top candidate, and quantity estimate.
- `habitatApi.evaStatus(): Promise<{ eva: EvaStatus }>` calls `GET /eva/status`.
- `habitatApi.deployEva(humanId: string): Promise<{ eva: EvaStatus }>` calls `POST /eva/deploy` with `{ humanId }`.
- `habitatApi.moveEva(x: number, y: number): Promise<{ eva: EvaStatus }>` calls `POST /eva/move` with `{ x, y }`.
- `habitatApi.scan(strength: number, radius: number): Promise<ResourceScan>` calls `/world/scan?strength=...&radius=...`.
- `habitatApi.dockEva(): Promise<{ eva: EvaStatus }>` calls `POST /eva/dock`.
- The collection wrapper must use the exact existing collection route and request shape found in `src/server.ts`.

- [ ] Write failing request-shape tests for each wrapper.
- [ ] Run the focused web API tests and confirm they fail because the wrappers are absent.
- [ ] Implement the wrappers with the existing `request<T>` helper and exact route/payload shapes.
- [ ] Run the focused tests and then the full test suite.

### Task 2: Add pure EVA graph data shaping

**Files:**
- Create: `web/eva-graph.ts`
- Test: `web/eva-graph.test.ts`

**Interfaces:**
- `type Coordinate = { x: number; y: number }`.
- `type EvaGraphPoint = Coordinate & { kind: "origin" | "path" | "explorer" | "resource"; label?: string; detail?: string }`.
- `buildEvaPath(current: Coordinate): Coordinate[]` returns origin followed by the current route point; it does not validate or alter server coordinates.
- `buildResourceMarkers(scan: ResourceScan): EvaGraphPoint[]` maps only server-returned tile coordinates and resource metadata.
- `formatEvaCoordinate(point: Coordinate): string` returns `(${point.x}, ${point.y})`.

- [ ] Write failing tests for origin/current path creation and scan marker mapping.
- [ ] Run `bun test web/eva-graph.test.ts` and verify the expected missing-function failures.
- [ ] Implement the pure helpers without movement, bounds, capacity, or resource inference logic.
- [ ] Run the focused tests and full suite.

### Task 3: Build the switchable EVA graph view

**Files:**
- Modify: `web/main.tsx`
- Modify: `web/styles.css`
- Test: `web/eva-graph.test.ts` for graph data and existing browser test coverage for view rendering if available

**Interfaces:**
- Humans view owns `humanView: "habitat" | "eva"` and renders either the existing module map or `EvaGraph`.
- `EvaGraph` receives humans, EVA status, latest scan, and action callbacks; it does not call server routes directly.
- The SVG graph maps server coordinates into the server-provided sector bounds and renders origin, explorer, route, grid, and resource markers.

- [ ] Add the view-switch test/data assertion before rendering changes.
- [ ] Implement the switch and focused EVA status polling when the Humans tab is active.
- [ ] Implement SVG graph layout with a readable dark theme, coordinate labels, legend, and empty/deployed states.
- [ ] Add responsive CSS so the graph and controls fit the existing no-scroll dashboard layout.
- [ ] Run tests and build after the view is rendered.

### Task 4: Add EVA controls and live action feedback

**Files:**
- Modify: `web/main.tsx`
- Modify: `web/styles.css`
- Modify: `web/api.ts` if the exact collection wrapper requires a final contract adjustment
- Test: `web/api.test.ts` and `web/eva-graph.test.ts`

**Interfaces:**
- Deploy selects an available registered human and submits only that human ID.
- Movement controls submit the next coordinate calculated from the current displayed coordinate; server errors are shown unchanged/readably.
- Scan controls submit bounded strength/radius values and replace latest scan markers with the response.
- Collect controls submit a selected server-returned resource and positive quantity using the existing collection route.
- Dock submits no invented payload and refreshes EVA status.

- [ ] Add failing tests for action payloads and disabled states when EVA is not deployed/exhausted.
- [ ] Implement callbacks, pending states, success refresh, error handling, and scan-marker replacement.
- [ ] Add compact status cards for suit battery, oxygen, carrying load, and ticks remaining.
- [ ] Run focused tests, full tests, TypeScript validation, and dashboard build.

### Task 5: Verify integration and deployment readiness

**Files:**
- Modify: only files required by test/build findings
- Test: existing project test suite and production build

- [ ] Run `wsl bash -lc "cd /mnt/c/Users/xxome/Downloads/labs/habitat-cli && ~/.bun/bin/bun test"`.
- [ ] Run `wsl bash -lc "cd /mnt/c/Users/xxome/Downloads/labs/habitat-cli && ~/.bun/bin/bun x tsc --noEmit"`.
- [ ] Run `wsl bash -lc "cd /mnt/c/Users/xxome/Downloads/labs/habitat-cli && ~/.bun/bin/bun run web:build"`.
- [ ] Confirm no credentials or invented browser routes are present with `rg -n "KEPLER_PLANET_TOKEN|KEPLER_BASE_URL|/api/|fetch\(" web`.
- [ ] Verify the persistent server's `/eva/status`, `/humans`, and dashboard fallback after deployment if the user requests publishing in this session.
