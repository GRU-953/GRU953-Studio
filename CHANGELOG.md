# Changelog

## 2.0.2 — 2026-07-11

Round 3 of the same "until golden" audit-fix loop on v2.0.1 — a fresh,
independent review pass with instructions to assume nothing from the prior
two rounds is guaranteed correct. Found the most serious issue of the whole
loop, plus one architectural misdescription affecting four agent files.

**Fixed**

- **Security (CRITICAL, real bypass): the v2.0.1 confirm-script exemption
  trusted a filename suffix, not an identity.** `isConfirmScriptOnly()` in
  `plugins/gru953-studio/hooks/lib.mjs` (added in 2.0.1 to fix the
  confirm-publish.mjs bootstrap deadlock) matched any path that merely
  ENDED WITH `confirm-publish.mjs` or `confirm-go-public.mjs` — so
  `node ./evil-confirm-publish.mjs` or `node /tmp/attacker/z-confirm-publish.mjs`
  were exempted just as completely as the real script. Since `gate.mjs` and
  `scan.mjs` both `allow()` immediately once a command is judged non-push,
  this gave any arbitrarily-named script an unconditional, unscanned,
  ungated pass. The same regex also failed the confirm scripts' own
  documented bare usage (`node confirm-publish.mjs`, no directory prefix),
  recreating the exact deadlock the exemption exists to close. Fixed by
  comparing an exact `path.basename()` match instead of a suffix test;
  verified live against both bugs before and after the fix, and locked in
  with a new regression test in `hooks.test.mjs` (now 16/16 passing).
- **`repo-integrity.mjs` INV9 had no `else fail()`.** Unlike every sibling
  invariant, the role-count-in-description check silently stopped verifying
  anything if the wording ever stopped matching its expected pattern —
  the same shape of blind spot it was written to close. Now fails loud if
  the description is missing or doesn't state a role count in the expected
  form.
- **A real architectural misdescription, found by verifying against
  Claude Code's own subagent documentation rather than assuming:**
  `interviewer.md`, `publisher.md` and `scope-guardian.md` were written as
  if they themselves called `AskUserQuestion` to show the user a live
  pop-up. Task-tool subagents cannot do this — the tool depends on the main
  conversation's session state and is unavailable to them even when
  declared. Corrected all three to prepare question content / confirmation
  wording / an escalation recommendation and hand it to the Project Lead,
  which is the one role played by the main conversation itself and the
  only place that can actually show a pop-up or wait for a live answer —
  documented explicitly in `project-lead.md`. This was a documentation
  correction, not a behavioural change: every real GRU953-Studio session
  observed so far already worked this way in practice.
- Stray "Claude Code or Claude Desktop" claim in `memory-keeper.md` —
  the plugin does not run on Claude Desktop (see README); corrected to
  match the accurate wording already used in `dev-memory/SKILL.md`.
- `reviewer.md` said it performs deletions and "fixes" stale docs directly,
  contradicting its own deliberately read-only tool list (Read, Grep, Glob,
  Bash — no Write/Edit) and the project's stated "every review-only role is
  correctly read-only" guarantee. Reworded to recommend and report findings
  for the builder/Project Lead to act on, matching its actual tools and its
  own Output section.

Verified: 16/16 behavioural tests, `repo-integrity.mjs` clean (31 agents,
version 2.0.2 in both `plugin.json` and `marketplace.json`), `roster-check.mjs`
clean, `licence-scan.mjs` clean — all re-run after every fix in this round.

## 2.0.1 — 2026-07-11

A follow-up audit round on v2.0.0, requested explicitly ("identify and fix
all issues... until golden"). GitHub Copilot was requested for this round
too — checked and reported honestly that this account has no active
Copilot subscription (`user/copilot_seat` → 404), so this round used the
same Claude-based adversarial audit process instead, across four lenses:
role-redundancy/growth, security, cross-file consistency, and non-technical
end-user experience.

**Fixed**

- **Security (MAJOR, real bypass): `isPushCapable()` defeated by shell
  word-splitting/quote-splicing — found and closed across two audit
  rounds, not one.** Round 1: `git${IFS}push` (bash's `$IFS` expands to
  whitespace, triggering word-splitting) and `git pu""sh` / `git pu''sh`
  (empty adjacent quotes are zero-width to bash) both resolved to a real
  `git push` while the matcher — which only ever sees the un-expanded
  literal text — rated them non-push, skipping the secret scan and the
  publish gate entirely. Round 2 (an independent re-audit of the Round 1
  fix, not just re-reading it): found the fix only stripped EMPTY quote
  pairs, missing the equally trivial non-empty case (`git p"u"s"h"`),
  plus backslash-escaped mid-word splicing (`git p\ush`) and
  backslash-newline line continuations. Generalised the fix to a
  fixed-point loop that strips any quote touching a word character on
  either side (so chained splices like `p"u"s"h"` fully resolve, not just
  the first pair), plus the two backslash techniques. This closes every
  proof-of-concept bypass demonstrated across both rounds; shell text
  obfuscation in general remains an open-ended problem (command
  substitution, variable reuse), documented plainly in SECURITY.md rather
  than implied to be solved. Locked in with 2 new test cases (14 tests
  total, up from 12 at v2.0.0).
- **`hooks/repo-integrity.mjs` false-clean bug (MAJOR).** The
  plugin.json/marketplace.json version-agreement check compared
  `pv !== mv` only — if BOTH files were entirely missing, both values were
  `undefined`, `undefined !== undefined` is `false`, and the check
  reported "clean." Reproduced directly (a repo missing both files passed
  as clean) and fixed: now fails explicitly when either file is
  unreadable or either version is absent. Also added a new invariant
  (INV9) checking marketplace.json's own plugin-description text states
  the correct role count — the systemic fix for the next finding.
- **`marketplace.json`'s plugin description said "up to 16 specialised
  roles"** — visible in the actual marketplace listing, unnoticed for a
  full day after the roster grew to 31 because nothing checked
  description text, only the version field. Fixed, and now mechanically
  checked (see above).
- **CHANGELOG's own "11 tests" claim was wrong** (actually 12 at the time of
  v2.0.0, now 14 after this round's fixes) — fixed for the record, per the
  user's own note that this project's CHANGELOG has a history of
  overclaiming.
- **`responsible-ai-reviewer` narrowed.** Previously fired on ANY Standard+
  AI feature — an opus-tier (priciest) role waking for a harmless
  AI-generated encouragement message added cost with no matching risk.
  Now scoped to AI features that make or meaningfully influence a real
  decision about a person.
- **Security (MAJOR, real deadlock, found live while publishing this very
  release): `confirm-publish.mjs`/`confirm-go-public.mjs` could never be
  run.** Both scripts' own filenames contain "publish"/"go-public", so
  invoking either via the Bash tool matched the generic "script whose name
  suggests deploy/release/publish/ship" indirection rule and was itself
  treated as push-capable — meaning `gate.mjs` denied the very command
  that RECORDS a user's publish confirmation, on the grounds that no
  confirmation was recorded yet. An unbreakable deadlock with no way to
  ever create the record. Fixed with a narrowly-scoped exemption (matches
  ONLY a plain `node <path-ending-in-one-of-these-two-scripts>
  [one optional arg]` invocation with no chained commands anywhere in the
  string — verified a decoy like `git push origin main; node
  confirm-publish.mjs` is still correctly caught, not exempted). Existing
  tests never caught this because they invoke the confirm scripts directly
  via `spawnSync` (bypassing the Bash-tool hook layer entirely) rather than
  through the actual PreToolUse interface; a new test exercises the real
  interface and locks the fix in (15 tests total).
- **README "31 AI roles" headline softened** to "The specialist team,"
  with the count moved into supporting text — a minor but real instance of
  number-forward framing cutting against this product's plain-language,
  non-overwhelming design ethos.

**Considered and explicitly declined**

- An independent audit flagged 4 of the 15 new v2.0.0 roles (`qa-lead`,
  `project-assistant`, `prompt-engineer`, `release-manager`) as likely
  duplicating `tester`, `memory-keeper`, `ai-developer`, and `publisher`
  respectively — the same "one job as two roles" pattern that sank an
  earlier 26-role tool. Asked directly; the user chose to keep all 31
  roles as-is. Not re-litigated further.

## 2.0.0 — 2026-07-11

A major gold-standard audit and expansion. Breaking only in the sense that
the specialist-role contract changed (the roster grew); every existing
project, command and skill continues to work unchanged.

**Added**

- **15 new specialist roles (16 → 31)**, the standard SDLC/AI specialist
  set, each Tier- or feature-gated so it only wakes when a project actually
  needs it (a Tiny site never loads them): `devops-engineer`,
  `sre-observability`, `release-manager`, `mlops-engineer`, `prompt-engineer`,
  `responsible-ai-reviewer`, `qa-lead`, `accessibility-specialist`,
  `ux-designer`, `technical-writer`, `data-engineer`, `privacy-dpo`,
  `localisation-specialist`, `researcher`, `project-assistant`. The `studio`
  skill's Tier table now has a companion "feature-triggered roles" table.
- **The `dev-memory` skill now exists.** It was referenced by five files
  (the studio skill, publish-github, memory-keeper, a command and a hook)
  but the `SKILL.md` had never been written — the headline "it remembers
  everything" feature had no defining document. Now it does.
- **`hooks/repo-integrity.mjs`** — a repository self-consistency check
  (referenced skills/hooks exist, role/skill counts match the README,
  versions agree, roster matches its baseline). This is the systemic fix
  for the class of bug above: CI now fails on a dangling reference, so a
  missing skill can't hide again.
- **`hooks/hooks.test.mjs`** — the first behavioural test suite for the
  security hooks (12 tests): the push-matcher catches real bypasses and
  allows ordinary reads; the scanner refuses planted secrets and the
  private Dev-Memory folder while ignoring look-alike code; the publish
  gate's two tokens are proven independent.
- **`plugins/gru953-studio/ROSTER.md`** — a committed roster baseline so the
  product's own role count is mechanically verifiable (previously
  `roster-check.mjs` could never pass on this repo, because the baseline
  lived only in a built project's Dev-Memory).
- Community-health pointer files under `.github/` (SECURITY, CONTRIBUTING,
  CODE_OF_CONDUCT) so GitHub discovers the canonical `governance/` versions;
  a `CODEOWNERS`; and a Dependabot config for the CI Actions.
- **Every role now declares a model deliberately** (6 haiku · 21 sonnet ·
  4 opus) instead of 12 roles inheriting the surface default — cheapest-first
  per `cost-guard`, with the tiers and reasoning recorded in
  `plugins/gru953-studio/ROSTER.md`. Existing opus/sonnet choices were left
  untouched; only the 12 unset roles were assigned.

**Fixed**

- **Security (fail-open risk): `lib.deny()` emitted invalid JSON** whenever a
  deny reason contained a quote, backslash or newline — which several of the
  gate's own reasons do. An unparseable PreToolUse deny risks not being
  honoured (failing open). Both `allow()` and `deny()` now build their
  output with `JSON.stringify`, so any reason is always correctly escaped.
  Caught by the new test suite.
- `roster-check.mjs` now falls back to the committed `ROSTER.md` when no
  per-project Dev-Memory baseline exists, so it works on the product repo.
- `publish-github` skill: removed a duplicated, mis-numbered "step 7" in
  section 5, and de-hardcoded the `v0.1.0`/`v1.0.0` version strings to a
  `<version>` placeholder set by the new `release-manager` role.
- CI: the DCO sign-off check now inspects only the commits introduced by
  the current push or pull request (merge commits exempt), instead of
  scanning all history — a single unsigned legacy or fork commit can no
  longer block every future change. CI also now runs the integrity check,
  the roster check and the behavioural test suite on every change.
- **Role-boundary sharpen (independent verification audit):**
  `ai-developer` still claimed prompt authoring as its own step, which
  duplicated the newly added `prompt-engineer`. It now delegates prompt
  authoring to `prompt-engineer` (drafting inline only when none is
  engaged, e.g. Tiny Tier) and keeps AI-justification, integration and the
  safety guardrails — closing the only genuine overlap the 16 → 31
  expansion introduced. A second, independent audit confirmed every other
  role boundary is distinct, no role is redundant, and every review-only
  role is correctly read-only.
- **Security (fail-open bypass in the push matcher):** `isPushCapable()`
  rated `git "push"`, `git 'push'` and `"git" push` as NON-push, so a
  quote-obfuscated push could have slipped past both the secret scan and the
  publish gate (failing open) — the opposite of the matcher's stated
  "prove non-push or treat as push" rule. The matcher now tolerates optional
  quotes around the `git` binary and the `push` subcommand. Found by an
  adversarial audit that ran the matcher against a battery of bypasses;
  a new `hooks.test.mjs` case locks it in, and the safe-command set was
  re-verified to confirm no new false positives.

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
