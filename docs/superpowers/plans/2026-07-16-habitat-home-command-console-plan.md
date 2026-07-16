# Habitat Home Command Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Recompose the Habitat Home screen around a central Habitat Status console with surrounding cards in an L-shaped desktop layout.

**Architecture:** Keep the existing `App` data loading and interaction handlers in `web/main.tsx`. Add a focused `HabitatStatusPanel` presentational component in the same file because it consumes the existing Home snapshot directly, and update `web/styles.css` with a dedicated home layout and console visual system. No API or state-model changes.

**Tech Stack:** React, TypeScript, Vite, CSS.

## Global Constraints

- Do not invent new backend values or routes.
- Reuse existing registration, module, solar, power, history, clock, and status data.
- Existing buttons, module status controls, clock controls, alerts, and unregister confirmation remain functional.
- Missing values use the existing unavailable/neutral states.
- Preserve unrelated user changes in the working tree.

---

### Task 1: Add the central Habitat Status panel

**Files:**
- Modify: `web/main.tsx` Home rendering and add `HabitatStatusPanel` presentational component

**Interfaces:**
- Consumes: `registration`, `modules`, `solar`, `power`, and `connectionState` already held by `App`.
- Produces: a presentational center panel with no new state or API calls.

- [ ] **Step 1: Add the component markup**

Create a `HabitatStatusPanel` component that renders the habitat name, connection state, a CSS-native habitat schematic, environment metrics, system bars, and compact metric tiles. Derive system rows from `modules` and use `Math.min/Math.max` only for display widths.

- [ ] **Step 2: Insert the panel into the Home layout**

Render the panel between the top operational cards and the lower chart cards. Keep the existing `PowerChart`, `ModuleChart`, `ClockCard`, and `ModuleRow` calls intact.

- [ ] **Step 3: Run TypeScript compilation**

Run `wsl bash -lc 'cd /mnt/c/Users/xxome/Downloads/labs/habitat-cli && ~/.bun/bin/bunx tsc --noEmit'`.

Expected: the command exits successfully with no type errors.

### Task 2: Recompose and restyle the Home screen

**Files:**
- Modify: `web/styles.css` Home layout, card, console, metric, and responsive rules

**Interfaces:**
- Consumes: class names emitted by the existing Home cards and `HabitatStatusPanel`.
- Produces: desktop L-shaped composition, tablet flow, and mobile single-column layout.

- [ ] **Step 1: Add dedicated home layout rules**

Define `.home-grid` as a two-column grid with a wide center panel spanning both columns. Place the first operational cards in the upper corners, charts beneath the console, and module status full-width.

- [ ] **Step 2: Add console styling**

Style `.habitat-status-panel`, `.habitat-schematic`, `.system-health`, and `.status-metric-grid` with lighter navy surfaces, thin blue-gray borders, restrained radii, compact labels, and a framed-console treatment.

- [ ] **Step 3: Add responsive rules**

At widths below 900px collapse to one column, remove grid spans, and keep the center panel before charts and module details.

- [ ] **Step 4: Build the web app**

Run `wsl bash -lc 'cd /mnt/c/Users/xxome/Downloads/labs/habitat-cli && ~/.bun/bin/bun run web:build'`.

Expected: the Vite web build completes successfully.

### Task 3: Verify the dashboard regression surface

**Files:**
- Test: existing project test suite and web build output

- [ ] **Step 1: Run the full test suite**

Run `wsl bash -lc 'cd /mnt/c/Users/xxome/Downloads/labs/habitat-cli && ~/.bun/bin/bun test'`.

Expected: all existing tests pass.

- [ ] **Step 2: Inspect the final diff**

Run `git diff -- web/main.tsx web/styles.css` and confirm the change is limited to the Home composition, the new presentational panel, and its styling.

- [ ] **Step 3: Report verification**

Provide the user with the changed files and the exact verification commands.
