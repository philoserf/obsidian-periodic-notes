---
name: deploy-local
description: Build and deploy the plugin to the local Obsidian vault. Use when testing locally, copying to vault, or installing a dev build.
user-invocable: true
---

Build and deploy the periodic-notes plugin to the local Obsidian vault for testing.

## Destination

`deploy.ts` reads the destination from the `OBSIDIAN_DEPLOY_DEST` environment variable and exits with an error if it is unset. Set it in `.env.local` (gitignored) — for example `OBSIDIAN_DEPLOY_DEST=~/source/philoserf/notes/.obsidian/plugins/periodic-notes/`. There is no hard-coded path and nothing to change in `package.json`.

## Steps

1. Run `bun run build` — this runs checks first, then builds
2. If build succeeds, run `bun run deploy` — copies main.js, manifest.json, styles.css to `$OBSIDIAN_DEPLOY_DEST`
3. Report success or failure

If the build fails, show the error output and stop. Do not deploy a broken build.

If deploy fails with `OBSIDIAN_DEPLOY_DEST not set`, tell the user to create `.env.local` with that variable rather than editing `deploy.ts`.
