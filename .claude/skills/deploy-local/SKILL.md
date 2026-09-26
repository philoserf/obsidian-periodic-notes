---
name: deploy-local
description: Build and deploy the plugin to the local Obsidian vault. Use when testing locally, copying to vault, or installing a dev build.
user-invocable: true
---

Build and deploy the periodic-notes plugin to the local Obsidian vault for testing.

## Destination

`deploy.ts` reads the destination from the `OBSIDIAN_DEPLOY_DEST` environment variable and exits with an error if it is unset. Set it in `.env.local` (gitignored) to an absolute path — `~` is not expanded — for example `OBSIDIAN_DEPLOY_DEST=/absolute/path/to/vault/.obsidian/plugins/periodic-notes/`. There is no hard-coded path and nothing to change in `package.json`.

## Steps

Run `bun run deploy`. It runs checks and builds first, and copies main.js, manifest.json and styles.css to `$OBSIDIAN_DEPLOY_DEST` only if the build succeeds. Report the result; on failure, show the error output.

If deploy fails with `OBSIDIAN_DEPLOY_DEST not set`, tell the user to create `.env.local` with that variable rather than editing `deploy.ts`.
