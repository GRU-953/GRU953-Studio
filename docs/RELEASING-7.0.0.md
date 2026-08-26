# Releasing 7.0.0 — the handover

Everything is prepared. Nothing has been pushed. This file is the one thing left to
read, and the commands at the end are the only actions still outstanding.

Prepared 2026-08-26 on branch `v7-lts-rebuild`.

## 1. What state it is in

| | |
| :-- | :-- |
| Branch | `v7-lts-rebuild`, local only — never pushed |
| Commits | 12, one per phase instalment, each DCO-signed |
| Version | `7.0.0` in the plugin manifest, the marketplace manifest and the CLI package |
| Tests | plugin **520/520**, CLI **46/46** |
| Gates | all nine green, including `npm run lint` and `npm run format:check` |
| Tag | **not created**, deliberately — it must point at the merge commit, which does not exist yet. Step 4 creates it. |

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

**The end-to-end test has never run green.** `tools/e2e/headless-build.mjs` is the only
test that judges whether the studio actually builds working software, and it cannot
authenticate from inside a Claude Code session. It is written, syntax-checked, and
proven to fail honestly rather than reporting a false pass — but it has not once
completed. Either run it from an authenticated terminal before tagging:

```bash
node tools/e2e/headless-build.mjs --timeout-minutes 30
```

...or tag knowing that this specific proof is outstanding. Exit `0` means it built
working software, `1` means a real defect, `2` means it could not measure — and `2` is
not a pass.

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
git tag -a v7.0.0 -m "GRU953-Studio 7.0.0 (LTS) — Apache-2.0, headless, Claude Code only" && git push origin v7.0.0
```

## 5. After the tag: deprecate the two withdrawn packages

A published package name cannot be deleted, only deprecated. Until you run these, both
remain installable and neither says so.

```bash
npm deprecate "@gru953/studio-antigravity@*" "Withdrawn in GRU953-Studio 7.0.0 (Claude Code only). No published version of this package could install correctly. Use @gru953/studio-cli."
```

The VS Code extension is withdrawn from the Marketplace through its publisher page —
there is no CLI equivalent. Unpublish or mark it deprecated there.

## 6. What is deliberately not done

- **Nothing was pushed** — no branch, no tag, no npm publish, no GitHub release. That
  was the agreed boundary.
- **The end-to-end test is not a release gate.** It should become `needs: e2e` in
  `publish.yml` beside `gates`, but only once `ANTHROPIC_API_KEY` exists as a
  repository secret. A gate wired to a missing secret fails every release for a reason
  unrelated to the release.
- **The trace-graded LLM-judge harness was not built.** It answers the same question
  as the end-to-end test, less cheaply and with a judge that can be wrong.
- **A findings register does not exist.** 370-plus numbered findings are referenced
  across the repository with no index. Until one exists, the retrospective commentary
  inside the runtime skill files is the only accessible record of most of them, which
  is why it was not stripped.
