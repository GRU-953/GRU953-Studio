# Changelog

## 1.0.2 — 2026-07-11

- **Licence changed again, from the GRU953 Community Licence 1.0 to the
  Polyform Noncommercial License 1.0.0**, following a critical audit
  requested by the user: a custom licence text, however well-intentioned,
  isn't machine-readable by GitHub's licence detector or dependency
  scanning tools, and creates a real adoption barrier. Same
  free-noncommercial/paid-commercial intent; `governance/` structure
  unchanged.
- README: added a full table of the 16 specialist roles and 6 skills;
  added a clear, honest statement that GRU953-Studio requires Claude Code
  and does not work in Claude Desktop (verified, not assumed — Desktop's
  only extension mechanism is MCP servers, with no equivalent to Claude
  Code's sub-agent spawning or hook system); added install-from-a-
  downloaded-zip instructions as an alternative to the marketplace command.
- Every GitHub Release now gets a downloadable `.zip` asset attached
  automatically as part of the publish protocol (`publish-github` skill),
  so non-technical users can install without typing marketplace commands.
  Retroactively attached to v1.0.0 and v1.0.1 as well.

## 1.0.1 — 2026-07-11

Found while archiving old repos using the freshly-published v1.0.0: the
`isPushCapable()` compound-command fallback treated ANY `gh` command
chained after a `cd` (e.g. `cd <dir> && gh repo view ...`) as push-capable
— including harmless reads (`gh repo view`, `gh auth status`, `gh api
user`). Since this environment's Bash tool doesn't reliably persist a
working directory, `cd <dir> && gh <command>` is the normal way to run
almost any `gh` command here, so this blocked ordinary use constantly.
Removed the fallback: every specific push-pattern regex already matches
anywhere in a compound string (unanchored `.test()`), so it added no real
detection power while causing this false-positive class.

## 0.1.0 — 2026-07-10

Initial plugin scaffold: 16 specialist agent roles (project-lead,
interviewer, architect, scope-guardian, builder, reviewer, tester,
security-compliance-auditor, brand-guardian, fixer, cut-recorder,
cost-monitor, publisher, memory-keeper, maintenance-agent, plus
ai-developer added during the gold-standard audit below), 6 skills
(studio, first-run, dev-memory, cost-guard, yagni-rules, publish-github),
3 commands, and security hooks adapted from the sibling GRU953-Crew
project's proven design.

Same-day gold-standard audit (multi-perspective review → fix loop) closed
before first publish:
- Retired the `minimalist` role (redundant with `reviewer`'s own
  whole-product trim pass) and added `ai-developer` in its place — net
  role count unchanged at 16, per this project's bounded-growth rule.
- Fixed a real security bug: `hooks/scan.mjs` could scan the wrong git
  tree in a multi-step publish sequence.
- Hardened `hooks/lib.mjs`'s push-command detection against a git-alias
  bypass and script/Makefile indirection.
- Added a separate, distinctly-tokened "go public" confirmation
  (`hooks/confirm-go-public.mjs`) so a private-publish confirmation can
  never also authorise making the repository public.
- Added real GitHub Release creation (tag + `gh release create` +
  `isDraft: false` verification) to the publish protocol — previously
  publishing stopped at a private repo push, the exact failure mode that
  affected every one of this project's ten predecessors.
- Replaced the internally-contradictory "Apache-2.0 + commercial
  restriction" licence with the Polyform Noncommercial License 1.0.0,
  which is designed for exactly this free-noncommercial/paid-commercial
  model.
- Added `hooks/verify-progress.mjs`, `SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `NOTICE`, issue/PR templates, and a baseline CI
  workflow.

Rounds 2-4 of the same audit found and fixed further real issues:
- A residual git-alias-reuse bypass class (disclosed as a limitation in
  `SECURITY.md`, not fully closable with stateless per-command matching),
  plus `git send-pack`/`gh alias set` detection added to `hooks/lib.mjs`.
- Two agents (`scope-guardian`, `interviewer`) were missing the `Bash`
  tool their own instructions required — a real bug, fixed.
- The plan's own headline sentence, plus `memory-keeper.md`,
  `cost-monitor.md`, and `cost-guard/SKILL.md`, described a private
  GitHub backup mirror for Dev-Memory that was never built and directly
  conflicted with the security hooks. Asked directly, the user chose
  **local-only, no mirror** — every file corrected to match.
- The publish sequence would have self-blocked: the confirmation was
  recorded AFTER `gh repo create --private`, but the publish-gate hook
  denies that exact command unless confirmation already exists. Reordered
  in `publish-github/SKILL.md` and `publisher.md`.
- `security-compliance-auditor.md` undercounted its own checks ("three"
  instead of four) and didn't state its Publish-gate checks apply at
  every Tier, including Tiny — both corrected.
- `agents/project-lead.md` had unused Bash/Write/Edit tools (trimmed to
  Read/Grep/Glob, matching its actual delegate-only behaviour);
  `agents/cost-monitor.md` was missing Bash for a cheap file-size check
  (added).
- `first-run/SKILL.md`'s surface-detection had no deterministic order —
  given a fixed 3-step check sequence.
- A stale "Apache-2.0" reference survived in the plugin's own
  machine-readable `plugin.json` (the most consequential one, since
  tooling reads it) plus a few agent files — all corrected to match the
  Polyform Noncommercial licence actually in use.

Rounds 5-6 came back clean — the project's own "2 consecutive clean
rounds" convergence rule was satisfied before this version was published.

## Brand alignment (2026-07-11, before first publish)

Aligned the whole repository to the established GRU953 brand system (the
GRU953 Brand & Engineering Guidebook), rather than the generic choices made
during the audit:
- Licence changed again, from Polyform Noncommercial License 1.0.0 to the
  **GRU953 Community Licence 1.0** — the same licence used across every
  other GRU953 product. Same free-noncommercial/paid-commercial intent,
  now the brand's own licence instead of a third-party template.
- `LICENSE`, `NOTICE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, and new `TRADEMARKS.md`, `LOGO-USAGE.md`, `GOVERNANCE.md`
  moved into a `governance/` folder, matching the brand's established repo
  structure.
- Added the GRU953 logo to the README and a Community section linking the
  governance docs.
- Added a DCO 1.1 sign-off requirement (checked in CI) to match the
  brand's standing contribution policy — the publish protocol's orphan
  commit now carries a `Signed-off-by` trailer.

## Pre-publish live-fire finding (2026-07-11)

Running the actual secrets scanner against the real repository — not just
reviewing its regex in the abstract, as all 6 prior audit rounds did —
found a genuine false positive that would have permanently blocked
publishing: `SECRETVAR_RE` matched the hooks' own
`const token = crypto.createHash(...)` lines, because "token" + "=" +
16+ letters-and-a-dot ("crypto.createHash") satisfied the old pattern,
which allowed the secret VALUE to be unquoted. Fixed by requiring the
value to actually be a quoted string literal — a real secret is always a
literal, never a function call — which keeps every genuine detection
case working while eliminating this false-positive class entirely.
