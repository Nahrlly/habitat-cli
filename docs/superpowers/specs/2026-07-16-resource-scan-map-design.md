# Resource Scan Map Design

## Goal

Show a spatial plot in the existing scan popup after an EVA scan succeeds.

## Design

The popup will render a dark SVG coordinate grid centered on the scan origin. Each returned tile is positioned from its server-provided `x` and `y` coordinates and labeled with only its highest-probability `topCandidate`. Marker color is presentation-only and is paired with a text legend. Focused or hovered tiles expose the server-provided coordinate, terrain, probability, and quantity estimate. The existing compact table remains available below the map for precise values.

The browser will read the existing `GET /world/scan` response, including Kepler's nested `scan.tiles` shape. It will not infer resource probabilities, locations, quantities, or Habitat rules.

## Verification

Add pure model tests for nested scan tile extraction and coordinate/resource plot data. Run the full Bun test suite, TypeScript validation, production dashboard build, and live REST smoke checks after deployment.
