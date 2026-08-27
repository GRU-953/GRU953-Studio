# Releasing 7.0.0 — the handover

> **Current state: see [../HANDOVER.md](../HANDOVER.md).** This runbook is the procedure;
> the handover says which steps are done, which are blocked on the owner, and that one
> verification run is still outstanding. Read it first.

Everything is prepared. Nothing has been pushed. This file is the one thing left to
read, and the commands at the end are the only actions still outstanding.

Prepared 2026-08-26 on branch `v7-lts-rebuild`.

## 1. What state it is in

|         |                                                                                                                 |
| :------ | :-------------------------------------------------------------------------------------------------------------- |
| Branch  | `v7-lts-rebuild`, local only — never pushed                                                                     |
| Commits | 12, one per phase instalment, each DCO-signed                                                                   |
| Version | `7.0.0` in the plugin manifest, the marketplace manifest and the CLI package                                    |
| Tests   | plugin **520/520**, CLI **46/46**                                                                               |
| Gates   | all nine green, including `npm run lint` and `npm run format:check`                                             |
| Tag     | **not created**, deliberately — it must point at the merge commit, which does not exist yet. Step 4 creates it. |

Re-run the checks yourself before doing anything else. The block is the one in
[CLAUDE.md](../CLAUDE.md); it takes about six minutes, most of it the test suite.

## 2. Read these three, in this order

They are the documents a reader of the release will judge it by, and they are the ones
worth your eyes before it is public.

1. **[CHANGELOG.md](../CHANGELOG.md)** — the 7.0.0 entry. Section 1 is what a user
   notices; section 7 explains what was withdrawn from the previous cycle's pending
   notes and why.
2. **[MIGRATION.md](../MIGRATION.md)** — the upgrade guide. Check section 2 in
   particular: it tells people the studio no longer publishes for them, which is the
   change most likely to surprise.
3. **[docs/STABILITY.md](STABILITY.md)** — the promise that makes "LTS" mean something.
   This is the file you will be held to, so it is the one to disagree with now rather
   than later.

## 3. Two things to decide before you tag

**The licence change is irreversible for anything published under it.** 7.0.0 is
Apache-2.0: commercial use becomes free for everyone, permanently, and the paid
commercial licence is retired. You confirmed this deliberately; it is repeated here
because a tag is where it becomes real.

**The end-to-end test now runs, and it has found real defects.** `tools/e2e/headless-build.mjs`
is the only test that judges whether the studio actually builds working software. On
2026-08-27 it completed for the first time, in 14 minutes, and returned **17 of 18**:
the studio built a working, tested, committed command-line expense tracker, its
Definition of Done was executed rather than attested, and nothing was pushed.

The one failure was the product's own premise. The run used **zero specialist
dispatches** — a complete app built by the coordinator alone, with the 36-role roster
unused. Nothing was wrong with the app; what was missing was the studio. Cause and fix
are in `X401-X413`; `INV26` now guards it.

**Tier drives wall clock far harder than anything else — measured 2026-08-27.**

| Brief                                                          | Tier        | Result                                                         |
| :------------------------------------------------------------- | :---------- | :------------------------------------------------------------- |
| Tiny CLI expense tracker                                       | Tiny        | **PASS 18/18 in 70.9 min**, 21 dispatches across 8 specialists |
| Household expenses web app (sign-in, SQLite, TypeScript, a11y) | **Complex** | **COULD NOT MEASURE — did not finish in 170 min**              |

The Complex run is worth reading properly rather than as a failure. At the 170-minute
cut-off it had completed **18 of 19 tasks**; the outstanding one was the last,
"README, dod.json, and the quality gate green". `stall-check.mjs` reported it
**clean, 0 unanswered calls, idle 1 minute, 4175 records** — actively working when
the harness killed it, not wedged. The app it built has **155 tests, all passing**:
TypeScript with `strict: true` (which it did not weaken), SQLite with a STRICT
schema, scrypt password hashing, signed session cookies, CSRF tokens and security
headers. It ran test-first — two testers wrote 96 failing tests before any
implementation — and recorded four decision records, one of which settles six
places where its own design documents were underspecified, each flagged rather
than guessed.

So: **a Complex-Tier build needs well over three hours.** The harness default of 90
minutes and `e2e.yml`'s 120-minute job ceiling are sized for Tiny only. Raise
`--timeout-minutes` to at least 240 for anything with a login and a database, and
treat exit 2 as "give it longer", not "the product is broken" — which is precisely
what exit 2 means and why it is distinct from 1.

**Delegation costs roughly five times the wall clock — measured, not estimated.** The same class
of app took **14.2 minutes** on the run that dispatched nothing and **69.1 minutes** on the run
that dispatched 21 times across 8 specialists. Both built working software. So the harness's
75–90 minute default is right for a Tiny-Tier app and leaves little room for a Standard or
Complex one; raise `--timeout-minutes` rather than reading a timeout as a defect, and note that
`e2e.yml`'s job ceiling of 120 minutes is the real constraint in CI.

Run it from an authenticated terminal before tagging:

```bash
env -u ANTHROPIC_BASE_URL node tools/e2e/headless-build.mjs --timeout-minutes 75
```

Exit `0` means it built working software, `1` means a real defect, `2` means it could
not measure — and `2` is not a pass. On any failure it now preserves the session
transcript and the work tree and prints where, because the run that needs
investigating is the one that fails.

(`env -u ANTHROPIC_BASE_URL` matters: with that variable set, the CLI expects an API
key instead of the OAuth login and fails to authenticate on a machine that IS signed
in. X379.)

## 4. The commands

Run them in order. Each is safe to stop after.

```bash
# 1. Merge the rebuild into your development branch.
git checkout development && git merge --no-ff v7-lts-rebuild
```

```bash
# 2. Push the branch and let CI prove it on real infrastructure. Stop here until green.
git push origin development
```

```bash
# 3. Tag it. This is the irreversible step: publish.yml fires on the tag, and every
#    publishing job now depends on a gates job that re-runs all nine checks first.
git tag -s v7.0.0 -m "GRU953-Studio 7.0.0 (LTS) — Apache-2.0, headless, Claude Code only" && git push origin v7.0.0
```

**Step 3 will not run yet, and this was measured rather than assumed (2026-08-27.)**
`CONTRIBUTING.md` requires `git tag -s` so that GitHub shows the tag as Verified,
and `-s` needs a signing key. On the machine this release was prepared on there is
no GPG installed, no SSH key, and no `user.signingkey` set; running the command
above produces `error: cannot run gpg: No such file or directory` and creates no
tag. Signing has to be set up once, by hand, before step 3. Doing it with an SSH
key is the shorter route and needs no new software:

1. Open Terminal.
2. Type `ls ~/.ssh/*.pub` and press Return. If it prints a file name, skip to step 5.
3. Type `ssh-keygen -t ed25519 -C "aninda.sh.15@gmail.com"` and press Return.
4. Press Return three more times to accept the default location and an empty
   passphrase (or type a passphrase if you prefer — you will be asked for it when
   you tag).
5. Type `git config --global gpg.format ssh` and press Return.
6. Type `git config --global user.signingkey ~/.ssh/id_ed25519.pub` and press
   Return. If step 2 printed a different file name, use that name instead.
7. Type `pbcopy < ~/.ssh/id_ed25519.pub` and press Return. Your key is now on the
   clipboard.
8. In a browser, go to <https://github.com/settings/keys>.
9. Click **New SSH key**.
10. In the **Key type** dropdown, choose **Signing Key**. This is the step that
    matters — an Authentication key will let you push but will not make the tag
    show as Verified.
11. Click in the **Key** box and paste (Cmd-V).
12. Click **Add SSH key**.
13. Back in Terminal, type `git tag -s zz-probe -m probe && git tag -d zz-probe`
    and press Return. If it prints `Deleted tag 'zz-probe'` with no error, signing
    works and step 3 above will run.

If you would rather not set signing up, the release can proceed with `git tag -a`
instead of `-s`. The consequence is specific and small: the tag will not carry the
Verified badge on GitHub, and `CONTRIBUTING.md` will then be stating a rule this
release did not follow — so change that file in the same commit rather than leaving
the two disagreeing.

## The release notes are written, and one paragraph is deliberately unfinished

`publish.yml` creates a DRAFT release to hold the installers and declines to write the
notes — by design, so a human writes them. They are written:
[docs/RELEASE-NOTES-7.0.0.md](RELEASE-NOTES-7.0.0.md). Paste that file into the draft.

Every number in it was cross-checked against the tree, and the 6.1.0 column was measured
from the `v6.1.0` tag rather than remembered. Two things must be updated before you
publish:

1. **The three-Tier paragraph.** It currently states only what has actually been
   measured — the Tiny run — and says so. Replace it with what the Standard and Complex
   runs returned once the step above has run. Do not write "verified at all three sizes"
   until three runs have returned 0.
2. **The Numbers table**, if the re-measure step above changed the test count or the
   standing context load.

Leaving that paragraph honest-but-incomplete is deliberate. An earlier draft claimed all
three tiers were verified while two of the runs had not happened, which is the exact
defect this release removes.

## Before the tag: the three-Tier proof (2026-08-28)

**State as of 2026-08-28, so nobody repeats the diagnosis:**

| Tier     | Result                                                         |
| :------- | :------------------------------------------------------------- |
| Tiny     | **green** — 18/18 in 71 minutes, 21 dispatches, nothing pushed |
| Standard | not run                                                        |
| Complex  | **one real defect found, fixed, NOT YET VERIFIED**             |

The Complex defect and its evidence, because it is the reason the three-Tier rule exists:
a run dispatched 14 specialists, wrote 92 passing tests, completed 5 of 22 tasks and then
ENDED — `stop_reason: "end_turn"`, `terminal_reason: "completed"`,
`api_error_status: null`, no permission denials — while `task-ledger.mjs` exited 0 and
named `T6` as next. Its last message was "Now the terminal interface, the largest task,
tests first." It announced the next task and treated the end of a turn as the end of the
job. `dod.json`, the evidence directory and the commits were all downstream of that.

The fix is in `skills/studio/SKILL.md` ("THE RUN IS NOT OVER WHILE THE LEDGER SAYS IT CAN
CONTINUE") and in `agents/project-lead.md`, and the harness now asserts the cause rather
than its symptoms. **A run must confirm it.** The attempt to do so returned exit 2 —
"could not measure" — on a session limit, which is the harness refusing to grade a run it
could not observe.

Two signals to read the re-run by:

- **tasks done** — anything short of 22 with a valid ledger is the same defect;
- **`Dev-Memory/evidence/` file count** — it was ZERO before, because the run never
  reached the Definition of Done. A non-zero count is the first direct proof `dod.mjs`
  executed on a Complex project.

The owner's decision is that all three Tiers are proven unattended, not just the fast
one. The briefs are committed so anyone can repeat this:

```bash
env -u ANTHROPIC_BASE_URL node tools/e2e/headless-build.mjs --timeout-minutes 120
```

```bash
env -u ANTHROPIC_BASE_URL node tools/e2e/headless-build.mjs --brief tools/e2e/briefs/standard.md --timeout-minutes 180
```

```bash
env -u ANTHROPIC_BASE_URL node tools/e2e/headless-build.mjs --brief tools/e2e/briefs/complex.md --timeout-minutes 300
```

`env -u ANTHROPIC_BASE_URL` is required, not optional: with that variable set the CLI
expects an API key and OAuth fails. Run them one at a time — concurrent runs compete for
the same rate limit and make a slow run indistinguishable from a stalled one.

Exit codes: `0` built working software, `1` a real product defect, `2` could not measure
(a timeout, or an incomplete run). A `2` is not a pass. See `tools/e2e/briefs/README.md`
for what each brief reaches and the measured wall-clock per Tier.

## Before the tag: re-measure the two drifting numbers (2026-08-27)

`CHANGELOG.md`'s Numbers table carries two figures that change with every commit —
the test count and the standing context load. They are measured at the release
commit, and the tag is usually a few commits later. Re-measure both and update the
table before step 3, or the release notes ship a number that was true last week.

The other four rows (roles, skills, commands, hooks) are re-derived by
`repo-integrity.mjs` on every commit and cannot go stale quietly.

```bash
node plugins/gru953-studio/hooks/hooks.test.mjs 2>&1 | grep -E '^. (tests|pass|fail)'
```

```bash
node -e 'const{execSync}=require("child_process");const s=f=>{try{return execSync(`git show HEAD:${f}`,{encoding:"utf8",maxBuffer:1e8})}catch{return null}};const b="plugins/gru953-studio/skills";const c=s(`${b}/studio/SKILL.md`);const k=c.slice(c.indexOf("Also load and follow these companion skills"));const e=k.indexOf("\n\n#");const n=[...new Set([...(e>0?k.slice(0,e):k).matchAll(/^- `([a-z0-9-]+)`/gm)].map(m=>m[1]))];let t=Buffer.byteLength(c,"utf8");for(const x of n){const y=s(`${b}/${x}/SKILL.md`);if(y)t+=Buffer.byteLength(y,"utf8")}console.log(t.toLocaleString()+" B across "+(n.length+1)+" files")'
```

This is the whole method the changelog states, so running it reproduces the figure
in the table. The 6.1.0 baseline is the same command with `v6.1.0` in place of
`HEAD`; it is fixed history and does not need re-running.

## An open decision, recorded rather than settled (2026-08-27)

`clients/cli/src/detect.js` still lists **Claude Desktop** as an install target,
and `tools/build-release-assets.mjs` still builds a `claude-desktop` zip with its
own install guide. Both were kept deliberately when Phase 4 removed Antigravity
and the VS Code family.

But no file inside `plugins/gru953-studio/` mentions Claude Desktop at all, and
this project's own changelog recorded, before 7.0.0, that the plugin does not run
there. So 7.0.0 ships an installer for a host where the studio installs and cannot
build. That is defensible — a user may want the skills visible in the chat app —
and it is also arguably a leftover.

It is not a release blocker either way, and it is the owner's call, so it is
written down here instead of being decided quietly. Both README.md and
docs/INSTALL-VERIFY.md now say exactly what the Claude Desktop install does and
does not give you, which is true under either answer.

## 5. After the tag: deprecate the two withdrawn packages

A published package name cannot be deleted, only deprecated. Until you run these, both
remain installable and neither says so.

```bash
npm deprecate "@gru953/studio-antigravity@*" "Withdrawn in GRU953-Studio 7.0.0 (Claude Code only). No published version of this package could install correctly. Use @gru953/studio-cli."
```

The VS Code extension is withdrawn from the Marketplace through its publisher page —
there is no CLI equivalent. Unpublish or mark it deprecated there.

## 6. What is deliberately not done

- **Nothing was pushed yet** — no branch, no tag, no npm publish, no GitHub release.
  The owner's decision of 2026-08-27 changed the boundary: the release now proceeds
  autonomously through all of those. They are listed here as not-yet-done, not as
  out-of-scope.
- **The end-to-end test IS now a release gate (2026-08-27).** `publish.yml` calls
  `e2e.yml` with `require-measurement: true`, and both publishing jobs depend on it.
  The earlier note here said this must wait for the secret, because a gate wired to a
  missing secret fails every release. That is now handled by the input rather than by
  waiting: without it the nightly still ends green on an absent secret, and with it a
  release fails. **So pushing the v7.0.0 tag will fail at the `e2e` job until
  `ANTHROPIC_API_KEY` is configured** — deliberately. Add the secret first (Settings →
  Secrets and variables → Actions → New repository secret) and the tag proceeds.
- **The trace-graded LLM-judge harness was not built.** It answers the same question
  as the end-to-end test, less cheaply and with a judge that can be wrong.
- **A findings register does not exist.** 370-plus numbered findings are referenced
  across the repository with no index. Until one exists, the retrospective commentary
  inside the runtime skill files is the only accessible record of most of them, which
  is why it was not stripped.
