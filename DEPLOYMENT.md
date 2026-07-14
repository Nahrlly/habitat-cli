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
