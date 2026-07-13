# Habitat CLI

This repo is split into a Hono backend and a CLI frontend.

## Local development

1. Create a `.env` file in the repo root from `.env.example`.
2. Set `KEPLER_BASE_URL` and `KEPLER_PLANET_TOKEN`.
3. Start the backend:
   ```bash
   bun run server
   ```
4. Point the CLI at the backend:
   ```bash
   HABITAT_API_BASE_URL=http://localhost:8787 bun run src/index.ts status
   ```

## Test flow

The integration script expects the backend to be running:

```bash
./test.sh
```
