# EVA Dashboard Design

## Goal

Add a switchable EVA view to the Humans tab so an operator can see the deployed explorer's live coordinates, path, and known resource markers, while controlling EVA through the existing Habitat REST API.

## Scope

The Humans tab will provide an `EVA / Habitat` view switch. The existing module assignment map remains the default Habitat view. The EVA view will display:

- the habitat origin at `(0, 0)`;
- the explorer's current `(x, y)` coordinate;
- a connected path from the origin to the explorer;
- known resource markers returned by the latest server scan;
- a coordinate grid and the server-provided sector boundaries;
- live suit battery, suit oxygen, carrying capacity, deployed human, and estimated ticks remaining.

The view will provide controls for deploy, one-tile movement, scan, collect, and dock.

## Data flow

React will use only the existing REST API:

| Dashboard action | REST operation |
| --- | --- |
| Load EVA state | `GET /eva/status` |
| Deploy explorer | `POST /eva/deploy` with `{ humanId }` |
| Move explorer | `POST /eva/move` with `{ x, y }` |
| Scan current position | `GET /world/scan?strength=...&radius=...` |
| Collect resource | existing collection REST operation using the current EVA coordinate |
| Return to habitat | `POST /eva/dock` |

The implementation will inspect and follow the real response shapes. Server validation remains authoritative for deployment eligibility, one-tile movement, sector bounds, suit resources, carrying capacity, and collection results.

## Resource markers

The browser will retain the latest successful scan result in view state until the page is refreshed or the view is left. It will render marker coordinates and server-provided resource information such as type, probability, and quantity estimate. The browser will not infer resource locations, quantities, movement rules, or collection eligibility.

## Interaction behavior

- EVA status is polled while the Humans tab is open.
- Every EVA action refreshes `/eva/status` and displays the server response or readable error.
- Movement buttons are disabled when no explorer is deployed, while an action is pending, or when the server reports EVA exhaustion.
- Scan strength and radius use bounded controls matching the API contract.
- Collection controls use the latest server scan data and submit only the selected server-provided resource and quantity.
- Dock is available only when the explorer is deployed at the origin; the server remains the final authority.

## Testing

Tests will cover:

- EVA API client request paths, methods, and payloads;
- conversion of server coordinates and scan results into graph data;
- display of origin, current position, path, and resource markers;
- action refresh behavior and server-error presentation.

No credentials, Habitat business rules, or browser-only Habitat API routes will be added.
