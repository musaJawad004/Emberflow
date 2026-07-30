---
name: cut-release
description: "Cut an Emberflow release: verify develop is green, finalize the CHANGELOG entry, merge develop into main, tag vX.Y.Z, push, and create the GitHub release. Use when the user wants to ship a version."
---

# cut-release

Ship a release following the flow in CONTRIBUTING.md: `main` is release-only —
every commit on it corresponds to a tagged release. Ask for the version
(`vX.Y.Z`, semver) if not given.

## Steps

### 1. Verify develop is green

```bash
git fetch origin
git checkout develop && git pull
gh run list --branch develop --limit 3
```

The latest CI run on `develop` must be green. If not, stop — fix CI first.

### 2. Finalize the CHANGELOG entry

Edit `CHANGELOG.md` (Keep-a-Changelog format, semver):

- Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and make sure the
  `Added` / `Changed` / `Fixed` sections reflect everything on `develop`
  since the last tag (`git log $(git describe --tags --abbrev=0)..develop --oneline`).
- Add a fresh empty `## [Unreleased]` section above it.

Commit on develop:

```bash
git add CHANGELOG.md
git commit -m "docs: finalize changelog for vX.Y.Z"
git push origin develop
```

### 3. Merge develop into main

```bash
git checkout main && git pull
git merge --no-ff develop -m "chore: release vX.Y.Z"
```

### 4. Tag (annotated) and push

```bash
git tag -a vX.Y.Z -m "Emberflow vX.Y.Z"
git push origin main --follow-tags
```

### 5. Create the GitHub release

```bash
gh release create vX.Y.Z --title "Emberflow vX.Y.Z" \
  --notes "$(sed -n '/^## \[X.Y.Z\]/,/^## \[/p' CHANGELOG.md | sed '$d')"
```

(Use the finalized CHANGELOG section as the notes body.)

### 6. Verify

```bash
git ls-remote --tags origin | grep vX.Y.Z
gh release view vX.Y.Z
gh run list --branch main --limit 1   # CI green on main
```

Finish by switching back to develop (`git checkout develop`) so day-to-day
work does not continue on main.
