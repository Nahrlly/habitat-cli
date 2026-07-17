# Kepler Resource Art Assets Design

## Goal

Create a consistent sci-fi illustration asset set for the Habitat dashboard using the live Kepler resource catalog as the source of truth.

## Scope

Create both a detailed square artwork and a small icon derivative for these 11 resource types:

- basalt-composite
- build-capacity
- conductive-ore
- ferrite
- ice-regolith
- power-capacity
- power-storage
- rare-catalyst
- sealed-space
- silicate-glass
- volatile-compounds

Food, oxygen, and water are explicitly excluded from both asset types for now.

## Visual system

Use a cohesive sci-fi editorial illustration style: strong readable silhouettes, material-specific visual cues, controlled contrast, restrained atmospheric detail, and a shared palette suitable for the dark Habitat dashboard. Each resource gets one square detailed illustration; its icon is derived from the same source artwork so the pair remains visually consistent.

## Asset structure

Store stable project-bound image files under a dashboard asset directory, using resource-type filenames. Each resource has:

- `<resourceType>.png` for the square artwork
- `<resourceType>-icon.png` for the small dashboard icon

Add a typed manifest mapping Kepler `resourceType` values to display metadata and asset paths. The dashboard should resolve known resources through this manifest and use a neutral fallback for future catalog resources without an asset entry.

## Data and integration

The asset set is keyed by Kepler `resourceType`, not catalog-version-specific IDs, so it remains stable across catalog versions. Existing Kepler catalog data remains authoritative for resource names and descriptions; the manifest only supplies presentation metadata and asset references.

## Verification

Verify that all 11 resources have both files, every manifest entry resolves to an existing asset, excluded resources have no entries, the web build succeeds, and the dashboard can render an unknown resource with the fallback treatment.
