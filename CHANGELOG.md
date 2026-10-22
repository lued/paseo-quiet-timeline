# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Add `SECURITY.md`: supported versions, private vulnerability reporting, the trust model
  (a trusted, unsandboxed Paseo plugin running as the daemon user) and the out-of-scope list.
- Remove absolute home paths, a machine name and internal workspace paths from the docs and
  test fixtures. Tests use a neutral `/home/dev` path; behaviour is unchanged.

## [0.1.0] - 2026-10-21

First public release.

### Added

- One collapsible grey row per run of thinking and tool calls, drawn like
  Paseo's own tool call rows.
- Summary labels such as "Thought 2 times, ran 3 commands, and read 1 file",
  plus the latest live activity while the agent works.
- Inline expansion on desktop and a sheet on compact layouts.
- Thinking shown in order and expanded by default, with every thinking block
  kept regardless of run length.
- Tool output on tap, with shell, read, edit, write, search, fetch, sub-agent,
  worktree setup, and generic tool details.
- A 60-tool-call window per run, with earlier calls revealed 200 at a time;
  thinking is never capped.
- Runs end at messages, todo lists, errors, plan approvals, `speak` calls, and
  other plugin cards.
- Safe fallback: unresolved items are drawn on their own, and a failed timeline
  mirror never hides anything.
- MIT license, README, paseo.cafe registry entry, and a GitHub Actions CI
  workflow running `npm ci`, `npm run typecheck`, and `npm test`.

### Changed

- Package metadata: version 0.1.0, public package, description, keywords,
  repository, homepage, bugs, and license.
- `OVERVIEW.md` documents the collapsed and expanded behaviour and the known
  limitation for listing readers.

### Known limitations

- Tool output inside an expanded group is plain monospace text, not Paseo's
  native code and diff viewer. The 0.12 plugin SDK exposes renderers only for
  plugin-owned timeline kinds and does not export the built-in tool row.
- Grouping is client-side and derives from a read-only mirror of the agent
  timeline. History older than the loaded pages is fetched on demand, up to the
  plugin's older-page limit.
- Only runs of reasoning and tool calls are grouped. Messages, todo lists,
  errors, plan approvals, `speak` calls, and other plugin cards stay separate.

### Decisions

- No runtime dependencies were added. The plugin uses only Paseo host modules,
  React, React Native, and Zod, all already provided.
- The package stays out of npm for this release. Install and paseo.cafe use the
  GitHub source; the registry entry deliberately omits the optional `package`
  field.
- The paseo-plugin.json ID remains `paseo-quiet-timeline`, pinned to Paseo
  `>=0.12.0`.

[0.1.0]: https://github.com/lued/paseo-quiet-timeline/releases/tag/v0.1.0
