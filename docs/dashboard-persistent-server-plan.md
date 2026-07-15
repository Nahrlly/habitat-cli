# Persistent Habitat Dashboard Hosting Plan

## Goal

Move the dashboard from a manually started `localhost` development workflow to a persistent server deployment. The website should be reachable after reboot, service restarts, or reconnects without requiring the operator to manually run the Habitat server.

## Target architecture

1. Build the React/Vite dashboard with `bun run web:build`.
2. Serve the generated `dist/` files from the existing Hono server.
3. Keep all dashboard API requests relative (`/registration`, `/modules`, `/power/overview`, etc.) so the browser and API share one origin.
4. Run the Hono server as an enabled, restart-on-failure `systemd` service.
5. Keep SQLite and `.env` in a persistent server-side directory outside the disposable build output.
6. Put a TLS-capable reverse proxy in front of the service when the dashboard needs to be accessed beyond the trusted private network.

## Implementation steps

### 1. Make Hono serve the production SPA

- Add a production static-file handler for the Vite output directory.
- Return `dist/index.html` for the SPA entry route and supported client-side routes.
- Leave `/registration`, `/modules`, `/alerts`, `/power/*`, `/solar/*`, and `/commands/*` owned by the existing API routes.
- Return a clear 404 for missing assets instead of forwarding API paths to the SPA.
- Confirm that the frontend continues using the REST API as its only Habitat state source.

### 2. Separate development and production configuration

- Keep Vite dev server usage for local development only.
- Define an explicit production working directory and absolute `HABITAT_DATA_DIRECTORY`.
- Keep `HABITAT_API_HOST=0.0.0.0` for server binding, but never use `0.0.0.0` as a browser/client URL.
- Keep Kepler credentials and other secrets in a server-only environment file with restricted permissions.
- Document the public dashboard URL separately from the internal Hono bind address.

### 3. Build a persistent deployment unit

- Update `deploy/habitat-api.service` to run the production Hono entrypoint from the deployed checkout.
- Use `Restart=always` or `Restart=on-failure` with a short restart delay.
- Add `After=network-online.target` and `Wants=network-online.target` so the service starts after networking is ready.
- Set the service to start automatically at boot with `systemctl enable --now habitat-api`.
- Use a dedicated service account or locked-down user where practical.
- Ensure the service account owns the persistent data directory and can read the environment file.

### 4. Add deployment and upgrade commands

- Add a documented deploy script or runbook that:
  - fetches the intended revision;
  - installs dependencies with Bun;
  - builds the dashboard;
  - verifies TypeScript and tests;
  - restarts the service only after a successful build;
  - checks the service status and health endpoint.
- Keep the previous build available until the new build passes verification.
- Do not delete `habitat.sqlite`, `.env`, or other persistent runtime state during upgrades.

### 5. Add health and observability checks

- Verify a lightweight `/health` response without requiring Habitat registration.
- Check both the local listener and the externally reachable URL.
- Use `journalctl -u habitat-api` for startup and crash diagnostics.
- Add a deployment smoke test for the SPA HTML, `/registration`, `/modules`, `/power/overview`, and `/alerts`.
- Confirm that a browser refresh, machine reboot, and service restart all return the dashboard without manual server startup.

### 6. Add safe remote access

- Bind Hono privately to the server interface and use a reverse proxy for the public/private hostname.
- Configure TLS and restrict access with the existing network boundary, VPN, or authentication layer.
- Forward API and SPA traffic to the same Hono origin so no browser CORS workaround is needed.
- Do not expose `.env`, SQLite files, source files, or the Vite development server.

## Verification checklist

```bash
cd /path/to/habitat-cli
~/.bun/bin/bun test
~/.bun/bin/bunx tsc --noEmit
~/.bun/bin/bun run web:build
systemctl is-enabled habitat-api
systemctl is-active habitat-api
curl -fsS http://127.0.0.1:8787/health
curl -fsS http://127.0.0.1:8787/
curl -fsS http://127.0.0.1:8787/registration
```

Then restart the machine or service and verify that the dashboard loads without running `bun run server` manually. Finally, unregister and re-register a test habitat to confirm the persistent API state and dashboard reset behavior still match.

## Completion criteria

- The dashboard and Hono API are served from one production origin.
- The service starts automatically after reboot and restarts after failure.
- The dashboard loads when no terminal or manual server process is open.
- SQLite state survives deploys and restarts.
- API routes remain the only source of Habitat state.
- A failed frontend build does not replace the last known-good deployment.
