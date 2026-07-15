# Deployment Notes

- Deployed Git commit: `741961be0eaa0365a4718f03e7b17f56f510eb5c`
- Local API verification on the LXC: `Habitat backend listening on http://0.0.0.0:8787`, and `GET /registration -> 200 returned registration`
- Laptop CLI verification through Tailscale: `habitat status` reached the LXC and returned the registration response
- OpenClaw server request logs observed during `habitat status`:
  - `[api] GET /registration -> 200 returned registration`
  - `[api] GET /registration -> 200 returned registration`
  - `[api] GET /registration -> 200 returned registration`
- Connection failure after stopping the manual server: `Unable to connect. Is the computer able to access the url?`

Why `0.0.0.0` is required for remote access:

- Binding to `127.0.0.1` makes the server listen only on the local loopback interface, so other machines cannot reach it.
- Binding to `0.0.0.0` tells the server to listen on all network interfaces, which allows remote clients on the same reachable network path to connect.

Why `.env` and `habitat.sqlite` remain in the checkout but are ignored by Git:

- `.env` holds machine-local configuration and secrets, so it stays on disk but is excluded from version control.
- `habitat.sqlite` is the local persistent state database, so it also remains in the working tree while being left out of Git history.
- This keeps deploy-time configuration and runtime state available on the machine without publishing credentials or local state to the repository.

## Persistent dashboard deployment

The production server serves the Vite build and the Hono API from the same origin. The browser URL is the reverse-proxy URL (for example, `https://habitat.example.com`); it is separate from `HABITAT_API_HOST`, which controls the server bind address.

On a new host:

1. Create the locked-down `habitat` user and persistent directory: `/var/lib/habitat`.
2. Copy `deploy/habitat-api.env.example` to `/etc/habitat/habitat-api.env`, fill in the Kepler token, and set mode `600`.
3. Install the checkout at `/opt/habitat-cli`, install Bun for the service user, and copy `deploy/habitat-api.service` to `/etc/systemd/system/`.
4. Enable the service: `sudo systemctl daemon-reload && sudo systemctl enable --now habitat-api`.
5. Use `deploy/deploy-habitat.sh` for upgrades. It runs tests, TypeScript validation, and a temporary frontend build before replacing `dist/`, then restarts and health-checks the service.

After a restart, run `deploy/smoke-test.sh http://127.0.0.1:8787`. The same script can target the reverse-proxy URL to verify external reachability. It accepts `404` for stateful routes when no habitat is registered, but requires successful health and SPA responses.

The service owns the persistent SQLite directory through `HABITAT_DATA_DIRECTORY`; deployments must not remove that directory or the server-only environment file.

## No-sudo user deployment

For an account without `sudo`, use the user-level unit. This assumes the checkout is `/home/emi/habitat-cli`, Bun is available at `/home/emi/.bun/bin/bun`, and lingering is already enabled.

```bash
cd /home/emi/habitat-cli
cp deploy/habitat-api.user.env.example /tmp/habitat-api.user.env.example
sed -i "s|%h|$HOME|g" /tmp/habitat-api.user.env.example
mkdir -p "$HOME/.local/share/habitat"
sed "s|%h|$HOME|g" /tmp/habitat-api.user.env.example > "$HOME/.local/share/habitat/habitat-api.env"
chmod 600 "$HOME/.local/share/habitat/habitat-api.env"
```

If `/home/emi/habitat-cli/.env` already exists, `deploy/install-user-service.sh` copies it into the user-service environment automatically. Otherwise, edit `~/.local/share/habitat/habitat-api.env` and add the Kepler token before starting the service:

```bash
bash deploy/install-user-service.sh
systemctl --user is-enabled habitat-api
systemctl --user is-active habitat-api
bash deploy/smoke-test.sh http://127.0.0.1:8787
```

For later upgrades:

```bash
cd /home/emi/habitat-cli
bash deploy/deploy-habitat.sh
```

The user service intentionally binds to `127.0.0.1`. To make it reachable through a reverse proxy, keep the proxy on the same server and forward to `http://127.0.0.1:8787`; do not change the browser URL to `0.0.0.0`. The unit and its environment live under `~/.local/share` because this account's `~/.config` directory is administrator-owned.

For remote access, place a TLS-capable reverse proxy or VPN boundary in front of Hono. Proxy `/` and the API paths to the same upstream origin, expose only the intended hostname, and keep `/etc/habitat/habitat-api.env`, `/var/lib/habitat`, source files, and the Vite development server off the network.
