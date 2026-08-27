# Handover — GRU953-Studio 7.0.0 LTS

**Written 2026-08-28. Branch `v7-lts-rebuild`, 37 commits ahead of `development`,
nothing merged and no tag pushed.** Read this before touching anything; it is written
for whoever picks this up next, Claude or human, with no memory of the sessions that
produced it.

---

## 1. The state in one paragraph

7.0.0 is code-complete and verified except for one thing. All nine commit gates are
green, the suite is 737 tests passing, and an unattended build works at Tiny Tier
(18/18 assertions, 71 minutes, 21 dispatches, nothing pushed). A Complex-Tier run found
one real defect — the coordinator ended the job at a turn boundary with 17 of 22 tasks
unstarted — that defect is fixed, and **the fix has not yet been verified by a run**,
because the attempt to verify it hit a session limit. That single re-run is what stands
between this and a release anyone can defend.

| | |
| :-- | :-- |
| Branch | `v7-lts-rebuild` (37 commits ahead of `development`) |
| Suite | 737 tests, 737 passing |
| Gates | all nine green, plus `actionlint` clean locally |
| Roles / skills / hooks / commands | 36 / 34 / 24 / 10 |
| Tiny Tier unattended build | **green**, 18/18 |
| Complex Tier | defect found, fixed, **unverified** |
| Standard Tier | **not run** |
| Pushed to npm / tagged | **no** |

---

## 2. The one thing blocking a verified release

Re-run the Complex-Tier unattended build. Nothing else is outstanding on the
engineering side.

```bash
env -u ANTHROPIC_BASE_URL node tools/e2e/headless-build.mjs --brief tools/e2e/briefs/complex.md --timeout-minutes 300 --keep
```

`env -u ANTHROPIC_BASE_URL` is required, not optional. With that variable set the CLI
expects an API key and OAuth fails; that cost a day to find once.

**How to read the result.** Exit `0` built working software, `1` a real product defect,
`2` could not measure. A `2` is not a pass — it means the test could not run (no
credentials, a timeout, a session limit), and the harness says which.

Two numbers decide whether the fix worked:

- **tasks done** — anything short of 22 while the ledger is still valid is the same
  defect recurring;
- **`Dev-Memory/evidence/` file count** — it was **zero** before, because the run never
  reached the Definition of Done at all. A non-zero count is the first direct proof that
  `dod.mjs` executed on a Complex project.

If it fails, the harness now names the cause in one line rather than reporting five
symptoms. Then update `docs/RELEASE-NOTES-7.0.0.md` (the Complex bullet) and
`docs/RELEASING-7.0.0.md` (the three-Tier table) with what it returned.

**Also run Standard Tier**, which has never been run:

```bash
env -u ANTHROPIC_BASE_URL node tools/e2e/headless-build.mjs --brief tools/e2e/briefs/standard.md --timeout-minutes 180
```

Run them one at a time. Concurrent runs compete for the same rate limit and make a slow
run indistinguishable from a stalled one.

---

## 3. The defect the Complex run found, in full

This is recorded here because the evidence lives in macOS temp directories that will be
cleaned, and because it is the reason the three-Tier rule exists at all.

A Complex-Tier run dispatched 14 specialists across six roles, wrote a TypeScript domain
with **92 passing tests**, produced a valid 22-task ledger, wrote the whole v7 substrate,
pushed nothing — and then **ended with 5 of 22 tasks done**:

```
stop_reason:       "end_turn"
terminal_reason:   "completed"
api_error_status:  null
permission_denials: []
subagent_stats:    spawned 14, completed 13, failed 0
```

At that moment `task-ledger.mjs` exited **0** — "valid, the run can continue" — and named
`T6` as the next runnable task. The run's final message was:

> "The domain is done — 92 tests green. Now the terminal interface, the largest task,
> tests first."

It announced the next task and treated the end of a turn as the end of the job. `dod.json`
was never written, the Definition of Done never ran, and nothing was committed — five
assertion failures with one cause.

**Nothing was broken, blocked, throttled or waiting on a human.** Two wrong diagnoses were
published before the evidence settled it: first that the run had been rate-limited (the
`429`/`529` strings were in the *app's own source* — it was building a service — and
`api_error_status` was null on all fourteen result rows), and second that the harness
should have reported "could not measure" (it should not: the session completed normally, so
exit 1 was correct by the harness's own definition).

**The fix** is in `skills/studio/SKILL.md`, as its own section "THE RUN IS NOT OVER WHILE
THE LEDGER SAYS IT CAN CONTINUE", and in `agents/project-lead.md` as a numbered step. The
operative sentence: *if you find yourself writing "now the next task is X", the next thing
you do is X, not a summary.* `tools/e2e/headless-build.mjs` now asserts that cause first,
verified against the failed run's preserved tree — it reports `next runnable task is T6`.

A Tiny brief has few enough tasks to fit inside one turn-group and could never fail this
way. That is the whole argument for requiring a Complex run, now demonstrated rather than
asserted.

---

## 4. What only the owner can do

None of these can be done from a checkout. They are listed in the order the release needs
them.

1. **Add `ANTHROPIC_API_KEY`** — Settings → Secrets and variables → Actions → New
   repository secret. `publish.yml` calls `e2e.yml` with `require-measurement: true`, so
   **pushing the v7.0.0 tag will fail at the `e2e` job until this exists.** That is
   deliberate: it is the difference between a release that cannot be published and one
   published without its product-level proof.
2. **Set up tag signing.** `CONTRIBUTING.md` requires `git tag -s` so GitHub shows the tag
   as Verified. Measured on the machine this was prepared on: no GPG, no SSH key, no
   `user.signingkey` — `git tag -s` produces `cannot run gpg` and creates no tag.
   `docs/RELEASING-7.0.0.md` carries a thirteen-step, one-action-per-step guide. Most steps
   need a password, so they cannot be automated.
3. **Confirm npm Trusted Publishing** is registered for `@gru953/studio-cli` against this
   repo, workflow and environment. Not visible from a checkout; if absent, `npm publish`
   fails for a configuration reason that looks like a code failure.
4. **`npm login`** — `npm whoami` returns 401 here, and two `npm deprecate` commands need
   it after the tag.
5. **One approval click** when `publish-npm-cli` pauses. The environment keeps its required
   reviewer by the owner's own choice.
6. **Withdraw the VS Code extension** from the Marketplace publisher page. The runbook
   states there is no CLI equivalent.

---

## 5. Remaining engineering work, in order

1. **The two runs in section 2.** Everything else waits on these.
2. **Open a PR from `v7-lts-rebuild` to `development` to get CI.** This matters more than
   it sounds: `ci.yml` runs only on push or PR to `main`/`development`, so **CI has never
   run against this branch** — including the Windows leg and the CRLF leg, and this session
   fixed a defect that would have reddened the CRLF leg on its first run.
   ```bash
   gh pr create --base development --head v7-lts-rebuild --title "v7.0.0 LTS" --body-file docs/RELEASE-NOTES-7.0.0.md
   ```
3. **Merge to `development`** once `ci-ok` is green on all six jobs.
4. **Sign and push the tag** (`git tag -s v7.0.0 …`), which starts `publish.yml`: nine
   gates against the tagged tree, then the `e2e` gate, then a pause for one approval click,
   then npm publish by Trusted Publishing and a draft GitHub release.
5. **Paste `docs/RELEASE-NOTES-7.0.0.md`** into the draft release. `publish.yml` creates
   the draft deliberately and declines to write the notes. **Update the Tier bullet and the
   Numbers table first** — see section 6.
6. **`npm deprecate`** the two withdrawn names; commands are in the runbook.
7. **Remove the two dead environments** (`publish-npm-antigravity`,
   `publish-vscode-marketplace`) and the `VSCE_PAT` secret.
8. **Post-tag only:** update the Homebrew formula and the winget manifests. Both need a
   sha256 of the *published* tarball, so they cannot be done earlier.

---

## 6. Numbers that drift, and how to re-measure them

Two figures in `CHANGELOG.md`'s Numbers table change with every commit, so they are dated
measurements rather than live claims. **Re-measure both at the tag.** They have been wrong
three times; the third time was the commit that corrected them, because it added prose to
the very files it measures.

```bash
node plugins/gru953-studio/hooks/hooks.test.mjs 2>&1 | grep -E '^. (tests|pass|fail)'
```

```bash
node -e 'const{execSync}=require("child_process");const s=f=>{try{return execSync(`git show HEAD:${f}`,{encoding:"utf8",maxBuffer:1e8})}catch{return null}};const b="plugins/gru953-studio/skills";const c=s(`${b}/studio/SKILL.md`);const k=c.slice(c.indexOf("Also load and follow these companion skills"));const e=k.indexOf("\n\n#");const n=[...new Set([...(e>0?k.slice(0,e):k).matchAll(/^- `([a-z0-9-]+)`/gm)].map(m=>m[1]))];let t=Buffer.byteLength(c,"utf8");for(const x of n){const y=s(`${b}/${x}/SKILL.md`);if(y)t+=Buffer.byteLength(y,"utf8")}console.log(t.toLocaleString()+" B across "+(n.length+1)+" files")'
```

The other four counts (roles, skills, commands, hooks) are re-derived by
`repo-integrity.mjs` on every commit and cannot go stale quietly. The 6.1.0 baseline column
was measured from the `v6.1.0` tag and is fixed history.

---

## 7. Facts that will cost you a day if you do not know them

Each of these was measured, and most cost real time to find.

- **`env -u ANTHROPIC_BASE_URL` is mandatory** for any nested `claude -p` run. With the
  variable set, OAuth fails with a message about an expired session on a machine that is
  signed in.
- **`--plugin-dir` must point at the plugin directory itself** — the one holding
  `.claude-plugin/` — never its parent. With the parent, the init event registers the plugin
  and loads *none* of its contents, so a run measures a plain Claude session that builds the
  app unaided and passes. The harness now refuses to grade that (`cannotMeasure`).
- **`task-ledger.mjs` exits 2 legitimately**: `0` continue, `1` the ledger is invalid, `2`
  valid but nothing runnable. A bare `&&` chain reads a legitimate 2 as failure.
- **`blockedReason` is mandatory** on both blocked states. A parked task without one makes
  the whole ledger invalid.
- **Clear the temp directory before a full suite run.** 510 leaked fixtures once caused a
  git "unable to create temporary file" error that looked exactly like a code defect.
- **A red suite may be the machine.** A Homebrew upgrade left `simdutf` inconsistent and 74
  tests failed with `dyld: Library not loaded` — every one a test that spawns a process. The
  suite was 737/737 minutes earlier. Re-run once before diagnosing.
- **Prettier reflows before your next patch matches.** Anchor edits on post-Prettier text,
  and never run `prettier --write .`: the project's scope is deliberately narrow
  (`plugins/gru953-studio/hooks/*.mjs`, `tools/**/*.mjs`, `eslint.config.mjs`), and a
  repo-wide run reformats the golden corpus so its corruption-matrix tests stop detecting
  their corruptions.
- **Never `git checkout` a file you have uncommitted work in.** That cost eleven fixes once
  in this effort; back up to the scratchpad instead.
- **Delegation costs about 5× wall clock** — 14.2 minutes without dispatching, 69–71 with.
- **`permissionDecision: 'ask'` is honoured headlessly** as a refusal-with-explanation, and
  `bypassPermissions` does **not** bypass it. Measured; several findings rest on this.

---

## 8. Open decisions, deliberately not made

1. **The Claude Desktop installer.** `clients/cli/src/detect.js` lists Claude Desktop as a
   `claude-plugin` target and the asset builder still produces its zip — but no file inside
   `plugins/gru953-studio/` mentions that host, and this project recorded before 7.0.0 that
   the plugin does not run there. So 7.0.0 ships an installer for a host where the studio
   installs and cannot build. Defensible either way; `README.md` and
   `docs/INSTALL-VERIFY.md` now state exactly what that install does and does not give you,
   which is true under either answer. Recorded in `docs/RELEASING-7.0.0.md`.
2. **`actionlint` in CI.** Nothing validates the workflow files themselves, and that gap is
   real — a stray `"` made the nightly fail on every run for a day. It is *not* wired into
   CI because every other `uses:` in `.github/workflows/` is pinned to a full-length SHA,
   and adding it means either a mutable `docker://rhysd/actionlint:TAG` or a digest that has
   to be looked up online. To wire it up, resolve the digest and pin it like the other five.
   Run it by hand meanwhile: `actionlint -shellcheck= .github/workflows/*.yml`.

---

## 9. What not to do

- **Do not push a tag** until `ANTHROPIC_API_KEY` exists. It will fail at the `e2e` job,
  and that is the gate working.
- **Do not hand-edit `Dev-Memory/QUALITY-GATE.md`, `PROGRESS.md` or `OBJECTIVE.md`.** They
  are rendered from `dod.json`, `tasks.json` and `run-brief.json`; the next gate run
  overwrites them. Change the JSON.
- **Do not read a green result as a pass without watching it go red.** The single most
  expensive lesson of this effort: 88 confirmed defects across three adversarial passes,
  and a large share were in fixes written hours earlier — three of them worse than the
  defect they fixed. Every new gate needs both directions proven, and an honest project
  that resembles the violation must be shown to pass.
- **Do not add a restatement of a guarded sentence.** A paragraph that paraphrased the
  consent guarantee defeated `charter-check.mjs` C5, which then found the guarantee in the
  paraphrase while the real clause was narrowed. Its own test caught it.

---

## 10. Where the evidence is

- `docs/RELEASING-7.0.0.md` — the release runbook, including the signing guide and the
  three-Tier proof.
- `docs/RELEASE-NOTES-7.0.0.md` — written; paste into the draft release after updating the
  Tier bullet.
- `CHANGELOG.md` §5 — the Numbers table, with every correction to it recorded in place.
- `docs/STABILITY.md` — what will not change in 7.0.x, worded as what is actually checked.
- `SECURITY.md` "Known limitations" — the disclosed residuals, including the two that were
  previously only in code comments each claiming to be disclosed there.
- `tools/e2e/briefs/README.md` — what each Tier's brief reaches, and the measured
  wall-clock per Tier.
- Commit messages on this branch — each defect, its reproduction, and what it was hiding.
  They are long on purpose: `git log development..HEAD` is the most detailed record of what
  changed and why.

The e2e evidence trees (`/var/folders/.../gru953-e2e-evidence-*`) hold the full transcripts
and the work trees as the studio left them. **They are in macOS temp and will be cleaned**,
which is why section 3 quotes the decisive fields rather than pointing at them.
