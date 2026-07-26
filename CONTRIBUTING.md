# Contributing

_GRU953-Studio_

Thank you for your interest in improving GRU953-Studio. Contributions of
all sizes are welcome — from fixing a typo to proposing a change.

A contribution can also start life as a lesson recorded while building a
real project with the plugin — see the `dev-memory` skill's "Publishing a
lesson upstream, as a contributor" section. It follows the exact same
process below: your own DCO sign-off credits you as a **Contributor**;
nothing about that path changes who owns or maintains this project (see
`NOTICE` and `governance/GOVERNANCE.md`).

## Getting set up

1. Fork the repository and clone your fork locally.
2. Install [Node.js](https://nodejs.org) — the plugin's safety hooks
   (`plugins/gru953-studio/hooks/*.mjs`) need it.
3. If you're testing the plugin itself in Claude Code, see the README's
   "Installing" section.

## Running checks

Before opening a pull request, please run the project's checks:

```
# 1. the manifests parse as valid JSON
node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('plugins/gru953-studio/.claude-plugin/plugin.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('plugins/gru953-studio/hooks/hooks.json','utf8'))"
# 2. every hook parses
for f in plugins/gru953-studio/hooks/*.mjs; do node --check "$f"; done
# 3. the security hooks behave correctly
node plugins/gru953-studio/hooks/hooks.test.mjs
# 4. the repository is internally consistent (references, counts, versions)
node plugins/gru953-studio/hooks/repo-integrity.mjs .
# 5. the roster is within its committed baseline
node plugins/gru953-studio/hooks/roster-check.mjs plugins/gru953-studio .
# 6. the licence scanner runs
node plugins/gru953-studio/hooks/licence-scan.mjs .
# 7. documentation stays internally consistent (counts, duplicates, role references)
node plugins/gru953-studio/hooks/docs-consistency.mjs .
# 8. every required file is present (see .github/workflows/ci.yml for the exact list)
```

If your change touches `clients/cli`, `clients/antigravity`, or `clients/vscode`,
also run that package's own `npm ci && npm test` (or, for the VS Code
extension, `npm ci && npm run compile && npm run lint`) — see
`.github/workflows/ci.yml`'s `clients` job for the exact commands.

## A note on dependencies

The plugin itself (`plugins/gru953-studio/`) has **zero third-party runtime
dependencies** — Node's standard library only. That's a deliberate,
mechanically-checked property (see `docs-consistency.mjs` and
`licence-scan.mjs`), not an accident: it's what "no coding, no build step,
just describe your app" can promise honestly. The three `clients/` bridges
carry their own dev-only tooling (TypeScript, ESLint, `vsce`) to build and
lint the VS Code extension — that's a deliberate exception, since none of it
ships inside the plugin a user installs, and it shouldn't be "fixed" back
out by a well-meaning cleanup.

If your change touches a skill or hook that documents one of the five
project-level gates (verify-progress.mjs, quality-gate.mjs, traceability-check.mjs,
memory-integrity.mjs, content-check.mjs — these run against a *project built by*
the plugin, not this repo itself, so they no-op here), also run that gate
against a sample `Dev-Memory/` so the documented requirement and the script
that enforces it never drift apart. See `CLAUDE.md` for the full list.

Pull requests are expected to keep **continuous integration (CI) green** — CI
is the automated set of checks that runs on every change (see
`.github/workflows/ci.yml`).

## Branch naming

Create a branch from `main` for your work:

- `feature/<name>` — for new functionality.
- `fix/<name>` — for bug fixes.

## Commit messages

Use clear, Conventional-style commit messages, for example:

- `feat: extend devops-engineer to cover Linux packaging`
- `fix: correct the publish-gate token derivation`
- `docs: clarify the first-run setup`

## New specialist roles need a named gap

GRU953-Studio deliberately keeps its agent-role count small and bounded
(see `plugins/gru953-studio/ROSTER.md` for the current roster and the
reasoning behind it — this file is the committed, public record; a
built PROJECT's own equivalent reasoning lives in ITS OWN local
`Dev-Memory/decisions/`, which never ships and isn't part of this
repository). A pull request
proposing a new role must name the specific, real gap an existing role
can't cover — not just "this would be nice." Extending an existing role's
behaviour is usually a better fit than a new role.

A new role is a "substantial change" under `governance/GOVERNANCE.md`'s RFC
lifecycle (2026-07-26 clarification): before such a pull request can be
merged, it must point to its own Accepted RFC (Draft → 14-day Discussion →
7-day Final Comment Period) under that process, in addition to naming the
gap here — the ordinary "Pull request process" steps below still apply, but
for a new role they start only once that RFC has been Accepted, not before.

## Pull request process

1. Keep each pull request focused on a single change.
2. Describe what you changed and why.
3. Ensure CI is green and address review feedback.
4. A maintainer will review and merge once the change is ready.

## Sign-off (DCO)

This project uses the **Developer Certificate of Origin (DCO) 1.1** — a short
statement that you have the right to submit your contribution. There is **no
Contributor Licence Agreement (CLA)** to sign.

Add a `Signed-off-by` line to each commit (the `-s` flag does this for you):

```
git commit -s -m "feat: your change"
```

This produces:

```
Signed-off-by: Your Name <your.email@example.com>
```

## Licensing (inbound = outbound)

Contributions are accepted under the same licence as the project itself
(**inbound = outbound**): the PolyForm Noncommercial License 1.0.0 (see
`LICENSE`). By contributing, you agree your work is provided
under these terms, with a DCO 1.1 sign-off.

## Code of Conduct

All participation is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md).

Maintainer: **Aninda Sundar Howlader** — aninda.sh15@gmail.com
