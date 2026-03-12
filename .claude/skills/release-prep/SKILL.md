---
name: release-prep
description: Orchestrate the full release preparation sequence — version bump, changelog, walkthrough, and validation
user-invocable: true
argument-hint: "[version]"
---

Prepare a release for the given version. Runs the full release prep sequence on a dedicated branch.

## Inputs

- `version` (required) — semver string (e.g., `1.3.0`)

## Steps

1. **Create branch**: `chore/release-{version}`
2. **Bump version**: Edit `package.json` version field, then run `bun run version` to sync manifest.json and versions.json
3. **Update changelog**: Add a release entry to CHANGELOG.md for the new version
4. **Commit**: `chore: bump version to {version} and update changelog`
5. **Regenerate walkthrough**: Run `uvx showboat verify walkthrough.md --output walkthrough-new.md && mv walkthrough-new.md walkthrough.md`
6. **Commit**: `docs: regenerate walkthrough for {version}`
7. **Rebuild main.js**: Run `bun run build` and commit the output — `chore: rebuild main.js for {version}`
8. **Run pre-release checks**: Invoke the `/pre-release` skill to validate everything
9. **Report**: Show what was done and ask for confirmation before push/PR

## Important

- Do NOT push or create a PR without explicit confirmation
- If any step fails, stop and report the failure
- The walkthrough regen may show drift warnings — report these to the user
