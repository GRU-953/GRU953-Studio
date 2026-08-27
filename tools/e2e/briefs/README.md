# End-to-end briefs

`tools/e2e/headless-build.mjs` takes `--brief <path>`. These are the three briefs the
release is verified against, one per Tier, and they exist because a single fixture was
once the whole of this product's product-level coverage.

That mattered concretely. Until 2026-08-27 the harness had one hardcoded Tiny brief and
it passed 18 of 18 — while three defects that would have made an unattended run FAIL sat
untouched, because a Tiny command-line app reaches none of the conditions that trigger
them: no phases, no TypeScript, no content stage, no backup. A test whose only fixture
avoids every blocker cannot verify the fixes for those blockers.

| Brief | Tier it must derive as | What it reaches that the Tiny brief does not |
| :-- | :-- | :-- |
| (built in) | Tiny | nothing — it is the fast smoke test, and that is its job |
| `standard.md` | Standard | per-user persistence, so the memory and Tier-derivation paths |
| `complex.md` | Complex | phases, TypeScript with strict on, sensitive data, two integrations |

The Tier is not a label chosen here: `hooks/run-brief.mjs` re-derives it from the three
recorded interview answers and refuses a mismatch, so a brief that does not actually
derive as its intended Tier fails the run rather than quietly testing something smaller.
The mapping is `handlesSensitiveData || integrations >= 2` for Complex,
`remembersUsers || integrations === 1` for Standard, otherwise Tiny.

Each brief states its non-goals explicitly. That is not padding: the harness derives the
"nothing outside the brief was built" assertion from the run's recorded `nonGoals`, so a
brief with none makes that assertion vacuous.

Measured wall-clock, so nobody budgets from a guess:

- Tiny — 71 minutes, best of six runs, 21 dispatches across 8 specialists
- Complex — a run on 2026-08-27 was still working at 170 minutes and was killed, not
  wedged; allow at least four hours. `e2e.yml`'s job ceiling is the real constraint.

```bash
env -u ANTHROPIC_BASE_URL node tools/e2e/headless-build.mjs --brief tools/e2e/briefs/complex.md --timeout-minutes 300 --keep
```

`env -u ANTHROPIC_BASE_URL` is required, not optional: with that variable set the CLI
expects an API key and OAuth fails. That cost a day to find, so it is written here rather
than remembered.
