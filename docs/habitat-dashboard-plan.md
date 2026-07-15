# Habitat Dashboard Plan

## Goal

Build a dark-mode-only React and TypeScript Habitat command dashboard inside this project. The browser must use the Hono REST API as the only source of Habitat state; React must not duplicate Habitat business rules or invent browser-only state routes.

## Current implementation direction

- Use a Vite React/TypeScript SPA served by the existing Hono server.
- Keep the visual language aligned with the supplied reference: dark navy surfaces, rounded cards, a left navigation rail, and blue/purple/orange/red status accents.
- Keep Home as the only functional navigation view initially; other navigation items are placeholders.
- Poll live state every 30 seconds and show a retryable stale-state error when refresh fails.
- Show an inline registration form when the habitat is not registered.
- Protect unregistering with a destructive confirmation modal.
- Allow module state changes from the Home screen with an Online/Offline selector.

## REST contract

The current checkout's authoritative routes are defined in `src/server.ts`. The dashboard currently uses:

- `GET /registration`
  - Registered: returns the persisted registration object.
  - Unregistered: returns `404` with `{ "error": "Habitat is not registered." }`.
- `GET /solar/status`
  - Returns `{ solarIrradiance: { wPerM2, condition? } }`.
- `GET /power/overview`
  - Server-owned aggregate returning `generationKw`, `consumptionKw`, `netKw`, and `solarIrradiance`.
  - Uses the existing power calculation helpers rather than calculating Habitat rules in React.
- `POST /commands/register`
  - Request: `{ name: string }`.
  - Success: `{ registration }`.
- `POST /commands/unregister`
  - Success: `{ ok: true }`.
- `PATCH /modules/:selector/status`
  - Request: `{ status: string }`.
  - Success: `{ module }`.

The earlier requested `/api` overview, registration, module-status, and simulation-tick route names are not present in this checkout. Do not target those names unless a verified backend contract is added later.

## Dashboard content

- Registration state and habitat name.
- Battery charge from registered power-storage module runtime attributes.
- Solar irradiance and condition.
- Server-provided power generation, consumption, and net power.
- Module list with server-backed Online/Offline controls.
- Error, loading, and empty states without fabricated Habitat values.

## Future extensions

- Add a verified `/api` compatibility layer only if the backend contract is formally introduced.
- Add historical charts only after the backend defines persisted snapshot storage and a history route.
- Add functional Modules, Weather, Reports, or Settings views as separate scoped features.

## Verification

```bash
cd /mnt/c/Users/xxome/Downloads/labs/habitat-cli
~/.bun/bin/bun test
~/.bun/bin/bunx tsc --noEmit
~/.bun/bin/bun run web:build
~/.bun/bin/bun run server
```

Open `http://localhost:8787`, not the `file://` path to `index.html`.
