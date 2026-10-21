# Submit to paseo.cafe

The registry entry lives in `docs/paseo-cafe-registry.json`. It is Git-only and
deliberately has no `package` field because nothing is published to npm for
this release. paseo.cafe reads the plugin version from the repository's
`package.json` (`0.1.0`).

Prerequisites:

- `lued/paseo-quiet-timeline` is public on GitHub.
- `main` contains `paseo-plugin.json` with `"id": "paseo-quiet-timeline"` and
  `package.json` version `0.1.0`.
- The `v0.1.0` tag points at the same commit as `main`.

## Exact commands

```bash
# 1. Confirm the public repository and release commit.
gh repo view lued/paseo-quiet-timeline --json visibility,url,defaultBranchRef
git ls-remote --tags https://github.com/lued/paseo-quiet-timeline.git v0.1.0

# 2. Clone the registry and create one branch.
git clone https://github.com/paseo-cafe/paseo-cafe.git
cd paseo-cafe
git checkout -b add-paseo-quiet-timeline

# 3. Add exactly one registry file.
cp /home/xander/git/paseo-quiet-timeline/docs/paseo-cafe-registry.json registry/paseo-quiet-timeline.json

# 4. Validate and commit.
bun install
bun run registry:validate
git add registry/paseo-quiet-timeline.json
git commit -m "Add paseo-quiet-timeline"

# 5. Push and open the PR.
git push -u origin add-paseo-quiet-timeline
gh pr create \
  --repo paseo-cafe/paseo-cafe \
  --base main \
  --head add-paseo-quiet-timeline \
  --title "Add paseo-quiet-timeline" \
  --body-file /home/xander/git/paseo-quiet-timeline/docs/paseo-cafe-pr-body.md
```

If `bun` is unavailable, the same check runs in the registry CI on the PR.

## PR title

`Add paseo-quiet-timeline`

## PR body

```markdown
Adds the Quiet timeline plugin.

- Repository: https://github.com/lued/paseo-quiet-timeline
- Manifest ID: `paseo-quiet-timeline`
- Version: `0.1.0` (tag `v0.1.0`)
- Categories: productivity
- License: MIT

This is a Git-only listing. The `package` field is intentionally omitted
because this release is not published to npm. paseo.cafe reads version
`0.1.0` from the repository's package.json.

Known limitation, declared as a caveat: tool output inside an expanded group is
plain monospace text rather than Paseo's native code and diff viewer, because
the 0.12 plugin SDK does not export that component to plugins.
```

## After merge

No follow-up file is needed. The registry scanner regenerates the listing from
the public repository and the pinned version. Future releases must bump
`package.json`, add a changelog section, tag the release, and open a registry PR
only if the entry itself changes.
