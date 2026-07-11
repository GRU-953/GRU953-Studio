# Contributing

_GRU953-Studio_

Thank you for your interest in improving GRU953-Studio. Contributions of
all sizes are welcome — from fixing a typo to proposing a change.

## Getting set up

1. Fork the repository and clone your fork locally.
2. Install [Node.js](https://nodejs.org) — the plugin's safety hooks
   (`plugins/gru953-studio/hooks/*.mjs`) need it.
3. If you're testing the plugin itself in Claude Code, see the README's
   "Installing" section.

## Running checks

Before opening a pull request, please run the project's checks:

```
# 1. every hook parses
for f in plugins/gru953-studio/hooks/*.mjs; do node --check "$f"; done
# 2. the repository is internally consistent (references, counts, versions)
node plugins/gru953-studio/hooks/repo-integrity.mjs .
# 3. the roster is within its committed baseline
node plugins/gru953-studio/hooks/roster-check.mjs
# 4. the security hooks behave correctly
node --test plugins/gru953-studio/hooks/hooks.test.mjs
# 5. the licence scanner runs
node plugins/gru953-studio/hooks/licence-scan.mjs .
```

Pull requests are expected to keep **continuous integration (CI) green** — CI
is the automated set of checks that runs on every change (see
`.github/workflows/ci.yml`).

## Branch naming

Create a branch from `main` for your work:

- `feature/<name>` — for new functionality.
- `fix/<name>` — for bug fixes.

## Commit messages

Use clear, Conventional-style commit messages, for example:

- `feat: add a deployment-engineer role for Linux packaging`
- `fix: correct the publish-gate token derivation`
- `docs: clarify the first-run setup`

## New specialist roles need a named gap

GRU953-Studio deliberately keeps its agent-role count small and bounded
(see `Dev-Memory/decisions/` in the build history for why). A pull request
proposing a new role must name the specific, real gap an existing role
can't cover — not just "this would be nice." Extending an existing role's
behaviour is usually a better fit than a new role.

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
(**inbound = outbound**): the Polyform Noncommercial License 1.0.0 (see
`governance/LICENSE`). By contributing, you agree your work is provided
under these terms, with a DCO 1.1 sign-off.

## Code of Conduct

All participation is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md).

Maintainer: **Aninda Sundar Howlader (GRU-953)** — aninda.sh15@gmail.com
