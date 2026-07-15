# No-Sudo User-Level Habitat Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the Habitat API and dashboard as `emi`'s persistent user-level systemd service without root privileges.

**Architecture:** Keep the existing root-level service template for administrators and add a user-level unit using paths under `/home/emi`. Store runtime data under `~/.local/share/habitat`, secrets under `~/.config/habitat`, and use `systemctl --user` for lifecycle management. Preserve `Linger=yes` as the reboot/startup requirement.

**Tech Stack:** Bun, Hono, Vite, SQLite, Bash, systemd user services.

## Global Constraints

- No deployment command may require `sudo`.
- SQLite and secrets must remain outside the disposable build output.
- The browser must use the same-origin Hono API.
- Existing root-level deployment files remain available for administrators.

### Task 1: Add user-level service and environment templates

**Files:**
- Create: `deploy/habitat-api.user.service`
- Create: `deploy/habitat-api.user.env.example`

- [x] Add a `systemd --user` unit with `WorkingDirectory=%h/habitat-cli`, `EnvironmentFile=%h/.config/habitat/habitat-api.env`, `Restart=on-failure`, and `WantedBy=default.target`.
- [x] Add environment defaults using `%h/.local/share/habitat` and `%h/habitat-cli/dist`.

### Task 2: Add no-sudo installation and upgrade commands

**Files:**
- Create: `deploy/install-user-service.sh`
- Modify: `deploy/deploy-habitat.sh`

- [x] Install the environment and unit into user-owned config directories.
- [x] Use `systemctl --user daemon-reload`, `enable --now`, and `restart` without `sudo`.
- [x] Preserve temporary frontend build and smoke-test behavior.

### Task 3: Document and verify user-level deployment

**Files:**
- Modify: `DEPLOYMENT.md`
- Modify: `deploy/smoke-test.sh` only if needed.

- [x] Document the exact SSH commands for `emi`.
- [x] Explain `Linger=yes` verification and the administrator-only fallback.
- [x] Run Bash syntax checks, the full Bun test suite, and TypeScript validation.
