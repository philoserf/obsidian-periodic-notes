---
name: deploy-local
description: Build and deploy the plugin to the local Obsidian vault. Use when testing locally, copying to vault, or installing a dev build.
user-invocable: true
---

Build and deploy the periodic-notes plugin to the local Obsidian vault for testing.

## Steps

1. Run `bun run build` — this runs checks first, then builds
2. If build succeeds, run `bun run deploy` — copies main.js, manifest.json, styles.css to the vault
3. Report success or failure

If the build fails, show the error output and stop. Do not deploy a broken build.
