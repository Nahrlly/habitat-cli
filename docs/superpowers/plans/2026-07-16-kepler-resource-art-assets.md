# Kepler Resource Art Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 11 cohesive sci-fi resource artworks, small icon derivatives, and dashboard manifest integration keyed to Kepler resource types.

**Architecture:** Generate square PNG source art under `web/assets/resources`, derive icon PNGs locally from each source, and expose a typed presentation manifest in a focused web module. Dashboard components consume the manifest by `resourceType` and fall back to a neutral generated SVG/data treatment for unknown future resources.

**Tech Stack:** TypeScript, React, Vite, PNG raster assets, Bun, existing Vitest tests.

## Global Constraints

- Use the live Kepler `resourceType` values as stable keys.
- Exclude `food`, `oxygen`, and `water` from both asset types.
- Preserve existing dashboard behavior and API boundaries.
- Keep new logic out of `web/main.tsx` where a focused module is sufficient.
- Verify the asset set, manifest, tests, and production web build.

---

### Task 1: Add resource asset manifest and tests

**Files:**
- Create: `web/resource-assets.ts`
- Create: `web/resource-assets.test.ts`

**Interfaces:**
- Produce `RESOURCE_ASSETS: Record<string, { artwork: string; icon: string }>` and `getResourceAsset(resourceType: string)`.
- `getResourceAsset` returns the known asset record or a neutral fallback record.

- [ ] Write tests asserting all 11 included resource types resolve, excluded types do not, and unknown types return the fallback.
- [ ] Run `bun test web/resource-assets.test.ts` and confirm failure before implementation.
- [ ] Implement the typed manifest with Vite asset imports and a deterministic fallback path.
- [ ] Run the focused test and confirm it passes.

### Task 2: Generate the 11 square source illustrations

**Files:**
- Create: `web/assets/resources/<resourceType>.png` for the 11 included resource types.

**Interfaces:**
- Each source is a square PNG with a shared sci-fi editorial illustration style and enough contrast to support icon derivation.

- [ ] Generate one square illustration per resource using the built-in image generation tool, with a consistent prompt foundation and resource-specific subject cues.
- [ ] Inspect the generated outputs for subject accuracy, square framing, readable silhouettes, no text, and no watermark.
- [ ] Copy the selected final outputs into the exact workspace asset paths.

### Task 3: Derive and validate small icons

**Files:**
- Create: `web/assets/resources/<resourceType>-icon.png` for the 11 included resource types.

- [ ] Create icon derivatives from the square sources at a small dashboard-friendly resolution with centered subject and preserved contrast.
- [ ] Validate that all 22 files exist and the icon files are materially smaller than the source artworks.
- [ ] Confirm excluded resources have no asset files or manifest entries.

### Task 4: Wire resource visuals into the dashboard

**Files:**
- Modify: `web/main.tsx` at resource card/list rendering sites.
- Modify: `web/styles.css` for resource artwork/icon presentation if required.

- [ ] Locate the current resource rendering path and add `getResourceAsset(resourceType)` lookups without changing API response shapes.
- [ ] Render the small icon in compact rows/cards and the square artwork in resource detail surfaces where available.
- [ ] Add accessible alt text from the Kepler display name and preserve a neutral fallback for excluded/unknown resources.
- [ ] Keep the implementation focused in `web/resource-assets.ts`; do not add a second resource metadata system.

### Task 5: Verify the complete integration

**Files:**
- Modify: `web/resource-assets.test.ts` only if verification exposes a real contract issue.

- [ ] Run `bun test web/resource-assets.test.ts`.
- [ ] Run the relevant dashboard tests with `bun test web`.
- [ ] Run `bun run web:build`.
- [ ] Check the built output contains the 22 resource image assets and that no excluded resource asset is referenced.
- [ ] Review `git diff --stat` and `git status --short` to ensure only scoped files are included.
