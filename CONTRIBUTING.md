# Contributing

## Repository layout

```
.claude-plugin/plugin.json   # Claude Code plugin manifest (installable skills, by path)
skills.sh.json               # Groups skills into topics on the skills.sh page
skills/<name>/SKILL.md        # One skill per directory
skills/<name>/references/      # Optional supporting docs a skill routes to
.changeset/                  # Pending release notes + changesets config
scripts/sync-version.mjs     # Mirrors package.json version into plugin.json
```

## Adding a skill

1. Create `skills/<name>/SKILL.md` with frontmatter (`name`, `description`) and the skill body.
2. Register it in **two** manifests:
   - `.claude-plugin/plugin.json` → add `"./skills/<name>"` to the `skills` array (makes it installable).
   - `skills.sh.json` → add `<name>` to a `groupings` entry (places it under a topic on skills.sh).
3. List it in the README's **Available skills** table.
4. Record a changeset (see below) so the next release bumps the version and documents the change.

## Versioning & changelog

This repo uses [Changesets](https://github.com/changesets/changesets). You never edit the version number or `CHANGELOG.md` by hand — a changeset drives both.

The version lives in three files that must always agree:
`package.json`, `package-lock.json`, and `.claude-plugin/plugin.json`.
`scripts/sync-version.mjs` keeps `plugin.json` in line; `npm run version` runs it automatically.

### The normal loop (per change)

1. Make your change (add/edit a skill).
2. Record a changeset:

   ```bash
   npm run changeset
   ```

   Pick the bump type and write a one-line summary:
   - **patch** — fixes, wording, small tweaks (`1.0.0` → `1.0.1`)
   - **minor** — a new skill or new capability (`1.0.0` → `1.1.0`)
   - **major** — a breaking change to an existing skill (`1.0.0` → `2.0.0`)

   This creates a file in `.changeset/`. **Commit it with your change.**
3. Push to `main`. The [release workflow](.github/workflows/release.yml) sees the
   pending changeset and opens a **"Version Packages" PR**.
4. **Merge that PR.** Merging consumes the changeset, bumps the version across all
   manifests (with the plugin.json sync), regenerates `CHANGELOG.md`, and tags the release.

So: you choose the *intent* (bump type + summary); the workflow does the bumping,
changelog, and tagging. Your only manual step after pushing is approving the version PR.

### Doing the version bump locally (optional)

If you'd rather not go through the version PR, run the bump yourself before pushing:

```bash
npm run changeset            # record the intent
npm run version              # apply it: bump package.json + plugin.json, write CHANGELOG.md
npm install --package-lock-only   # sync package-lock.json (changeset version doesn't touch it)
git add -A && git commit -m "release: vX.Y.Z"
git push
```

When you push an already-applied version (no pending changesets), the workflow
skips the PR and just tags the release.

> **Gotcha:** `changeset version` only *increments* — it can't set an absolute
> number. To land on a specific version, start from the right base (e.g. a major
> bump from `0.0.0` produces `1.0.0`).
