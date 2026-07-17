# Habitat Home Command Console Design

## Goal

Refine the Habitat dashboard Home screen so the new Habitat Status panel is the visual center of the page, with operational cards arranged around it in an L-shaped composition. Preserve the existing server-backed data, controls, and navigation behavior.

## Visual direction

- Keep the dark navy command-center palette.
- Use lighter, calmer surfaces and thinner borders than the current rounded-card treatment.
- Reduce excessive corner rounding and heavy shadows.
- Use clear section labels, compact uppercase metadata, and stronger whitespace hierarchy inspired by the supplied reference images.
- Make the center panel feel like a framed systems console rather than another generic card.

## Home layout

1. Existing header and connection state remain at the top.
2. First row: Power status on the left; Solar conditions and Clock stacked on the right.
3. Center row: Habitat Status spans the main content width and acts as the visual anchor.
4. The center panel contains:
   - habitat name and live connection state;
   - a schematic/illustration zone using CSS-native visual treatment;
   - environment summary values;
   - system health bars for the major installed systems;
   - compact metric tiles for power, storage, solar, and system count.
5. Lower row: Power overview and Module usage remain side-by-side.
6. Full-width Module status remains below the charts.

## Responsive behavior

- Desktop uses the L-shaped composition with a wide center console.
- Tablet collapses the right-side stack into normal flow while keeping Habitat Status prominent.
- Mobile becomes a single-column sequence: status console, power, environment, clock, charts, and module details.

## Data and interaction constraints

- Do not invent new backend values or routes.
- Reuse existing registration, module, solar, power, history, clock, and status data.
- Existing buttons, module status controls, clock controls, alerts, and unregister confirmation remain functional.
- Missing values use the existing unavailable/neutral states.

## Verification

- TypeScript compilation succeeds.
- Existing test suite passes.
- Web build succeeds.
- Home layout is checked at desktop and narrow viewport widths.
