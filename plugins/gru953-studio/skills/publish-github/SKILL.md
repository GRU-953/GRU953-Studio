---
name: publish-github
description: The GRU953-Studio protocol for publishing a finished MVP privately to the user's OWN GitHub account, with an explicit separate step to make it public later. Use when the studio reaches the Publish stage, when the user runs /studio-publish, or when the user says "publish", "push to GitHub", "put it on GitHub", or "release the app". Covers pre-flight secret/vulnerability/licence scanning, the signed-in user's own author identity, attribution cleanup, private repository creation and the final report.
---

# Publish to GitHub

Publish the current project as a PRIVATE repository under the SIGNED-IN
user's own GitHub account — never a hard-coded account. Follow every step
in order; do not push anything until every pre-flight step passes.

Two automatic safety nets back this up, wired in `hooks/hooks.json` on
every Bash command. `hooks/scan.mjs` blocks push-capable commands
(`git push`, `gh repo create`, `gh ... --push`, and the like) if the
would-ship set contains secrets, key files, or the private `Dev-Memory/`
folder. `hooks/gate.mjs` blocks the same commands unless the user's publish
confirmation has been recorded for this project via
`node "${CLAUDE_PLUGIN_ROOT}/hooks/confirm-publish.mjs"`, which writes a
project-bound confirmation token — so a push cannot fire outside the
Publish stage even on a clean tree. Both hooks stand down (allow) when no
studio project (no `Dev-Memory/` folder) exists anywhere above the working
directory, so they never interfere with unrelated projects.

## 1. Verify the tools

- `git --version`
- `gh auth status` — if missing or not signed in, STOP and explain: "Publishing
  needs one free tool called the GitHub CLI. Install it from
  https://cli.github.com, then run `gh auth login` once and follow the
  browser prompts. This is the only extra thing GRU953-Studio ever needs,
  and only for publishing." Then wait.

## 2. Set the author identity from the signed-in user (local to this repo only)

```
gh api user --jq '.login'
gh api user --jq '.name'
gh api user --jq '.email'
```

Set the committer locally (never `--global`):
```
git config user.name "<name from gh api user>"
git config user.email "<email from gh api user>"
```
If any field is empty, STOP and ask the user to confirm it — never assume.

## 3. Pre-flight blocking checks (four via security-compliance-auditor, plus a roster check via scope-guardian)

0. **Dev-Memory resume rehearsal** (2026-07-11 Round 9 fix: this step used
   to be a paragraph placed AFTER all four checks below, telling the reader
   to run it "before the pre-flight checks" — self-contradicting its own
   position in the document). If this project has a `Dev-Memory` resume
   rehearsal still outstanding (see the `dev-memory` skill), run it now,
   before the four checks that follow — a project that cannot prove it
   resumes correctly is not ready to publish regardless of how clean its
   code is.
1. **Secrets scan** — committed + staged + untracked-not-ignored files,
   checked against the same patterns as `hooks/scan.mjs`. Any hit is a hard
   stop; report redacted (`{type, file, line}`), never the value.
2. **Dependency vulnerability scan** — the platform's equivalent of
   `npm audit` / `pip-audit`. A serious, fixable vulnerability is a hard
   stop until fixed or explicitly accepted by the user with the risk
   explained plainly.
3. **Dependency licence scan** — `node "${CLAUDE_PLUGIN_ROOT}/hooks/licence-scan.mjs" .`. Only a
   `clean` result clears this gate; `BLOCKED`, `NEEDS HUMAN REVIEW` or
   `INCOMPLETE` all stop the publish.
4. **Progress-evidence check** (2026-07-10 audit addition) —
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/verify-progress.mjs" .`. Exit 0 = every task marked "done" in
   `Dev-Memory/PROGRESS.md` has a real `verified:` line; a non-zero exit
   means something was marked done without evidence — fix the record (by
   actually running the missing verification) before publishing, never by
   editing the status back to make the check pass.
5. **Roster check, via `scope-guardian`** (2026-07-12 fix: this file — the
   role's own declared "single source of truth" — used to omit this step
   even though `publisher.md` and `/studio-publish` both treat it as
   mandatory) — `node "${CLAUDE_PLUGIN_ROOT}/hooks/roster-check.mjs"`. A
   non-zero exit means the agent roster grew past its recorded baseline
   with no named reason; resolve that first too.

## 4. Attribution cleanup (in a throwaway temp clone only)

Never rewrite history in the user's live project directory.
1. Temp-clone the project to a scratch directory; assert no pre-existing
   remotes before touching it.
2. Apply a plain regex substitution stripping AI/Claude attribution lines
   ("Co-Authored-By: Claude", "Generated with Claude Code" and similar)
   from files and messages; create ONE clean orphan commit authored as the
   signed-in user, WITH a DCO sign-off trailer (2026-07-11 brand-alignment
   addition — GRU953's contribution policy requires this on every commit):
   `git commit --signoff -m "GRU953-Studio v<version>"` (with `<version>`
   chosen by `publisher` per SemVer; the `--signoff` flag
   adds `Signed-off-by: <name> <email>` using the identity set in step 2
   above).
3. Delete `Dev-Memory/` from the temp clone before the orphan commit —
   it never ships.
4. KEEP third-party credit intact: `governance/LICENSE`, `governance/NOTICE`,
   `governance/TRADEMARKS.md`, `governance/LOGO-USAGE.md`, licence headers,
   citations.
5. This temp clone is what gets published; the user's own directory is
   untouched.

## 5. Create the private repository, add licensing, and push

**Order matters here (2026-07-10 Round 4 audit fix):** `gate.mjs` denies
`gh repo create`/`git push` unless the publish confirmation is ALREADY
recorded — so confirming (step 3 below) must happen before `gh repo create`
(step 4), not after it. The earlier version of this list got this backwards
and would have denied itself if followed literally outside the
`/studio-publish` command (which already had the order right). (2026-07-11
Round 9 fix: this note previously said "before step 2, not after it" — a
cross-reference to an older, differently-numbered version of this same
list, left stale after a later renumbering. Referencing the actual step
names now instead of numbers, so this can't drift again.)

1. `gh repo view <login>/<project-name>` — if it exists, stop and ask for a
   different name.
2. Ask the single AskUserQuestion pop-up using "permanent and irreversible"
   wording — the only place in the lifecycle that phrase is used. If the
   user declines, stop here; nothing below this step runs.
3. Record the confirmation NOW, before any gated command:
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/confirm-publish.mjs"`.
4. `gh repo create <login>/<project-name> --private` — never create-and-push
   in one step.
5. Read visibility back: `gh repo view <login>/<project-name> --json
   visibility` — must be `private` before any push.
6. Ensure the full `governance/` folder (LICENSE, NOTICE, CODE_OF_CONDUCT.md,
   CONTRIBUTING.md, SECURITY.md, TRADEMARKS.md, LOGO-USAGE.md, GOVERNANCE.md)
   is present in the published tree, kept in `governance/` to match the
   established GRU953 repo structure rather than at the repository root.
   Licence: **Polyform Noncommercial License 1.0.0** plus a commercial-use
   contact path — a professionally drafted, independently reviewed licence
   template (2026-07-11: chosen over a GRU953-branded custom licence
   specifically because it's recognised by name by dependency-compliance
   tooling, which matters for a publicly-distributed developer tool).
   Tell the user plainly at Publish time: because the file lives in
   `governance/` and not at the repository root, GitHub's own automatic
   licence badge on the repo page will show "no license detected" — this is
   expected, not a sign anything broke, and doesn't change what the licence
   actually says or requires.
7. Push: `git -C <temp-clone-path> push -u origin main` — never
   create-and-push in one step. (The downloadable zip is attached later, in
   section 6, as part of the real Release.)

## 6. Tag and create a REAL GitHub Release (2026-07-10 audit addition)

A private repo existing is NOT the same as a shipped release — this is the
literal, named failure mode across every one of the user's ten prior
tools (a git tag at best, zero real Releases ever). Do not skip this step
and do not consider Publish complete without it:

```
git -C <temp-clone-path> tag v<version>
git -C <temp-clone-path> push origin v<version>
gh release create v<version> --repo <login>/<project-name> --title "v<version>" --notes "<publisher's plain-English release notes>"
gh release view v<version> --repo <login>/<project-name> --json tagName,isDraft
```

**Attach a downloadable zip (2026-07-11 addition)** — every release gets a
zip of the release tree as a downloadable asset, so non-technical users
can install from a direct download without using git at all. Use
`<project-name>` exactly as it appears in the repository's own name (2026-07-12
final-audit fix: the v3.0.0 and v3.0.1 zip assets differ only in casing —
`GRU953-Studio-v3.0.0.zip` vs `gru953-studio-v3.0.1.zip` — cosmetic, doesn't
break the install instructions, but pinned here so it can't drift a third
time):

```
cd <temp-clone-path> && zip -rq /tmp/<project-name>-v<version>.zip . -x ".git/*"
gh release upload v<version> /tmp/<project-name>-v<version>.zip --repo <login>/<project-name>
```

The last `gh release view` command must show `"isDraft": false` before this step is
considered done. If it shows `true`, or the release command fails, this is
not yet published — report the failure plainly, do not report success.

## 7. Report

Tell the user in plain English: the repository's address, that it is
private, what was published, that all four pre-flight checks came back
clean, and that a real Release (not just a tag) exists — quote the
`isDraft: false` confirmation. Record the address, tag and date in
`Dev-Memory/PROGRESS.md` and `SESSION-LOG.md`. Delete
`Dev-Memory/PUBLISH-APPROVED` afterwards, so a later publish (e.g. a
maintenance release) must be re-confirmed by the user.

## Going public (separate, later, explicit step — never bundled here)

Only when the user explicitly asks, via its OWN AskUserQuestion pop-up
(distinct from the private-publish confirmation — do not reuse that
wording or that answer):

1. Record the confirmation: `node "${CLAUDE_PLUGIN_ROOT}/hooks/confirm-go-public.mjs"`
   from the project root — this writes a separately-derived token that
   `hooks/gate.mjs` checks specifically for visibility-changing commands;
   the ordinary publish token from step 5 does NOT satisfy it.
2. Only then: `gh repo edit <login>/<project-name> --visibility public`.
3. Verify: `gh repo view <login>/<project-name> --json visibility` shows
   `public`, and report this back to the user plainly.
