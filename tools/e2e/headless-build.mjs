#!/usr/bin/env node
//
// headless-build.mjs — the only test that proves the product does what it says.
//
// WHY IT EXISTS. Before this, GRU953-Studio had 518 tests over its hooks and not one that the
// studio produces working software. Every claim that it builds an app was unmeasured. That is
// the same defect class as the gates this rebuild spent four phases repairing, at the level of
// the product's own promise rather than its instruments: a green suite over the measuring
// equipment says nothing about whether the thing being measured works.
//
// WHAT IT ASSERTS, and the two halves matter equally:
//
//   FILESYSTEM — the artefacts a real build must leave behind. Dev-Memory with a schema-versioned
//   brief, task ledger and Definition of Done; source files that exist; the built project's own
//   tests passing; more than one commit.
//
//   TRANSCRIPT — that the work was actually DONE rather than described. The studio skill fired,
//   specialists were dispatched, and — the assertion that matters most for v7 — NOTHING WAS
//   PUSHED. The owner's decision is that a headless run finishes with a tested project on their
//   own machine and stops; a run that quietly acquired a remote and pushed to it would be a
//   safety regression that every other check in this repository would miss.
//
// A filesystem-only test can be satisfied by an agent that writes plausible files. A
// transcript-only test can be satisfied by an agent that narrates. Both together are hard to
// fake, which is the point.
//
// IT FAILS HONESTLY WHEN IT CANNOT RUN. Exit 2 means "could not measure" — no `claude` on PATH,
// no authentication, the run timed out — and is deliberately distinct from exit 1, "measured and
// the product is broken". A harness that reports success when it never ran is the exact fault
// this file exists to catch, so it refuses to.
//
// HAS RUN GREEN, and the history matters more than the fact. When first written this header said
// NOT YET RUN AGAINST A LIVE SESSION: a nested `claude -p` cannot authenticate from inside a Claude
// Code session (`OAuth session expired and could not be refreshed`), so it was syntax-checked and
// never executed. The cause turned out to be `ANTHROPIC_BASE_URL` being set in the parent
// environment, which makes the CLI expect an API key; `env -u ANTHROPIC_BASE_URL` fixes it.
//
// It has since run six times from an authenticated terminal. Best result: 18 of 18 assertions in
// 70.9 minutes, 21 dispatches across 8 specialists, nothing pushed. Four of the six runs found
// real defects, including one where `--plugin-dir` pointed one level too high, so the plugin never
// loaded and the run measured a plain Claude session that had built the app unaided — and passed.
//
// Its own judgements are unit-tested in `tools/e2e/judge.mjs`, because at 71 minutes a run they
// were never exercised otherwise, and three of them were wrong.
//
// Usage:
//   node tools/e2e/headless-build.mjs [--keep] [--timeout-minutes N] [--model <id>]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { pushAttempts, dispatchCount, toolUsesIn } from './judge.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n, d) => {
  const i = argv.indexOf(n);
  return i === -1 ? d : argv[i + 1];
};
const KEEP = flag('--keep');
// 2026-08-27. Default raised from 30 to 90, because 30 was a guess and there are now
// measurements. A full studio run on a DELIBERATELY TINY brief — a command-line expense
// tracker — reached 9 of 12 tasks and 53 passing tests at the 40-minute mark and was still
// working, not wedged (confirmed with hooks/stall-check.mjs: "active, nothing outstanding").
// Plain Claude builds a comparable thing in 4 minutes; the rest is the interview, the design,
// the phased plan, per-task evidence and the tests. A default that cannot finish the smallest
// realistic job produces exit 2 every time, and a harness whose usual answer is "could not
// measure" teaches everyone to stop reading it.
const TIMEOUT_MIN = Number(value('--timeout-minutes', '90'));
const MODEL = value('--model', null);
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const PLUGIN_DIR = path.join(REPO, 'plugins', 'gru953-studio');

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail || '' });
  process.stdout.write(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}\n`,
  );
};

function cannotMeasure(why, hint) {
  // A timeout is the case most in need of a reproduction and the case that used to leave none.
  preserveEvidence(null);
  console.log(
    JSON.stringify(
      {
        status: 'COULD NOT MEASURE',
        why,
        hint,
        note: 'exit 2, not 1: this is "the test could not run", not "the product is broken". Reporting success here would be the exact fault this test exists to catch.',
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

// ---- preconditions ---------------------------------------------------------------------------
const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], {
  encoding: 'utf8',
});
if (which.status !== 0 || !String(which.stdout).trim()) {
  cannotMeasure('no `claude` executable on PATH', 'install the Claude Code CLI, then re-run');
}

// 2026-08-27, X379. The one environment trap that will waste somebody's afternoon, named up
// front because it did waste one. `ANTHROPIC_BASE_URL` being set — even to the correct default,
// `https://api.anthropic.com` — makes the CLI expect its own API key rather than the OAuth login
// the user already has. With no key, every run then fails with "OAuth session expired and could
// not be refreshed", which reads as an expired login and is nothing of the kind: the same
// machine and same account authenticate immediately once the variable is unset.
//
// It is a WARNING and not a refusal, deliberately. Someone deliberately pointing at a gateway is
// doing something legitimate and this harness has no business overruling it. What it can do is
// say so before the run, rather than leaving the cause to be found by bisecting an environment.
if (process.env.ANTHROPIC_BASE_URL && !process.env.ANTHROPIC_API_KEY) {
  console.log(
    `WARNING: ANTHROPIC_BASE_URL is set (${process.env.ANTHROPIC_BASE_URL}) with no ANTHROPIC_API_KEY.
         That combination makes the CLI expect a key instead of using your OAuth login, so the
         run will most likely fail as "OAuth session expired" — which is not what it sounds like.
         If it does, retry with:
           env -u ANTHROPIC_BASE_URL node tools/e2e/headless-build.mjs
`,
  );
}

if (!Number.isFinite(TIMEOUT_MIN) || TIMEOUT_MIN <= 0) {
  cannotMeasure(
    `--timeout-minutes ${JSON.stringify(value('--timeout-minutes', '30'))} is not a positive number`,
  );
}

// ---- the throwaway project -------------------------------------------------------------------
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gru953-e2e-'));
// Where the evidence goes when something fails. Until 2026-08-27 this harness discarded the
// transcript it had just captured (826 KB of it on the run that found this) and deleted the work
// tree, so a FAILING run — the only kind anybody needs to investigate — left nothing behind to
// investigate with. A test that reports a defect and destroys the reproduction is most of a test.
let preserved = null;
// Held at module scope so cannotMeasure() — which is declared long before the transcript exists,
// and fires on a TIMEOUT, where the half-built tree is the whole of the evidence — can preserve
// without reaching a `const` that is still in its temporal dead zone.
let capturedTranscript = null;
function preserveEvidence(transcriptText) {
  const text = transcriptText || capturedTranscript;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gru953-e2e-evidence-'));
    if (text) fs.writeFileSync(path.join(dir, 'transcript.jsonl'), text);
    if (fs.existsSync(work)) fs.cpSync(work, path.join(dir, 'work'), { recursive: true });
    preserved = dir;
    console.log(`\n  evidence preserved at ${dir}`);
    console.log('    transcript.jsonl — the full session; work/ — the tree as the studio left it');
  } catch (e) {
    console.log(`\n  (could not preserve evidence: ${e && e.message})`);
  }
}

const cleanup = () => {
  if (KEEP) {
    console.log(`\n(--keep) project left at ${work}`);
    return;
  }
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* a leftover temp directory is not a test result */
  }
};

// A deliberately small DEFAULT brief. The point is to prove the loop closes, not to stress the
// studio: a large idea makes a slow test whose failures are ambiguous.
//
// SUPPLIABLE since 2026-08-27, with `--brief <path>`, and that is not a convenience. This Tiny
// brief reaches none of the conditions that made the product unable to run headlessly — it has no
// phases, no TypeScript, no content stage and no backup — so it passed 18/18 while three defects
// that would FAIL an unattended run sat untouched. A test whose single fixture avoids every
// blocker cannot verify their fixes. Proving Standard and Complex tiers needs a brief that
// reaches them.
//
// Those briefs are committed, in `tools/e2e/briefs/` with a README explaining what each one
// reaches and the measured wall-clock for each Tier. Keeping them in the tree rather than in
// somebody's shell history is the whole point: a verification nobody else can reproduce is a
// verification that happened once.
const briefPath = value('--brief', null);
const IDEA_DEFAULT = [
  'Build a tiny command-line expense tracker.',
  '',
  'Must have:',
  '- add an expense with an amount and a short note',
  '- list every expense recorded so far',
  '- show the total',
  '',
  'Not doing: no accounts, no syncing, no graphical interface, no database server.',
  '',
  'Use Node.js with its built-in test runner. Keep it as small as possible.',
].join('\n');

const IDEA = (() => {
  if (!briefPath) return IDEA_DEFAULT;
  try {
    const body = fs.readFileSync(briefPath, 'utf8').trim();
    if (body === '') cannotMeasure(`the brief at ${briefPath} is empty`);
    return body;
  } catch (e) {
    cannotMeasure(`could not read the brief at ${briefPath}`, (e && e.message) || String(e));
    return IDEA_DEFAULT; // unreachable: cannotMeasure exits
  }
})();

fs.writeFileSync(path.join(work, 'IDEA.md'), IDEA + '\n');

// git init, so "did it commit?" is answerable and no remote exists to push to.
for (const args of [
  ['init', '--quiet'],
  ['config', 'user.email', 'e2e@example.invalid'],
  ['config', 'user.name', 'GRU953 E2E'],
]) {
  const r = spawnSync('git', args, { cwd: work, encoding: 'utf8' });
  if (r.status !== 0)
    cannotMeasure(`git ${args.join(' ')} failed in the throwaway project: ${r.stderr}`);
}

console.log(`E2E: headless build in ${work}\n`);

// ---- run the studio, unattended --------------------------------------------------------------
// 2026-08-27, X378. The original prompt began "Read IDEA.md in this directory and build it",
// which contains NONE of the phrases the studio skill documents as its triggers. So the skill
// legitimately did not fire and the harness measured plain Claude — while INV25 exists in this
// same repository to check that realistic phrasings reach the entry point. Writing an
// end-to-end prompt that does not invoke the thing under test is the same mistake one level up.
//
// This now uses two documented triggers ("GRU953-Studio" and "build my idea") in a sentence a
// person would plausibly type. It deliberately does NOT use a slash command: the point is to
// prove the studio activates from ordinary words, which is how a real user reaches it.
const prompt = [
  'Use GRU953-Studio to build my idea. It is written in IDEA.md in this directory.',
  '',
  'Work headlessly: do not ask me anything. Where you would normally ask, choose the most',
  'reversible option, record the assumption in Dev-Memory, and carry on.',
  '',
  'Do not create a GitHub repository and do not push anything anywhere. Finish with the',
  'project committed locally and stop.',
].join('\n');

const args = [
  '-p',
  prompt,
  // 2026-08-27, X378. This was `path.join(REPO, 'plugins')` — the PARENT of the plugin. Measured
  // against a real run: with the parent, the init event registers the plugin but its `skills`,
  // `agents` and `slash_commands` arrays contain NONE of its contents. With the plugin directory
  // itself (the one holding `.claude-plugin/`), 41 skills, 36 agents and 42 commands load. So the
  // first real end-to-end run measured a plain Claude session with the studio never engaged,
  // reported eight failures, and none of them were the product's.
  '--plugin-dir',
  PLUGIN_DIR,
  '--output-format',
  'stream-json',
  '--verbose',
  '--permission-mode',
  'acceptEdits',
  // 2026-08-27, X380. `acceptEdits` alone permits file edits and DENIES Bash. The first real
  // studio run therefore wrote the whole app and its tests and could not execute one command:
  // its own SESSION-LOG records "`git add` and `git commit` were refused by the same permission",
  // and PROGRESS.md marked five tasks `code-written, unrun` with "verification substituted". So
  // the harness reported "the work was committed — 0 commit(s)" as a product failure when it was
  // the harness forbidding the commit. The second time this file has blamed the product for its
  // own configuration; hence the loaded-plugin guard above, and hence this list.
  //
  // `--allowedTools` rather than `bypassPermissions`, deliberately. Measured: acceptEdits plus an
  // allowlist runs a shell command with zero permission denials, and the permission system stays
  // ON — which matters, because the same run showed config-protection.mjs correctly refusing an
  // edit to QUALITY-GATE.md and the studio respecting it rather than working around it. Turning
  // permissions off wholesale would have thrown away the evidence that the guards work.
  //
  // The list is what a build genuinely needs. If it is too narrow, the "specialists were
  // dispatched" assertion fails loudly rather than the run quietly doing less.
  '--allowedTools',
  'Bash Read Write Edit MultiEdit Glob Grep Task Agent Skill TodoWrite',
];
if (MODEL) args.push('--model', MODEL);

const started = Date.now();
const run = spawnSync('claude', args, {
  cwd: work,
  encoding: 'utf8',
  timeout: TIMEOUT_MIN * 60 * 1000,
  maxBuffer: 512 * 1024 * 1024,
});
const elapsedMin = ((Date.now() - started) / 60000).toFixed(1);

const transcript = `${run.stdout || ''}`;
capturedTranscript = transcript;
const stderr = `${run.stderr || ''}`;

if (run.error && run.error.code === 'ETIMEDOUT') {
  cleanup();
  cannotMeasure(
    `the run did not finish within ${TIMEOUT_MIN} minutes`,
    'raise --timeout-minutes, or investigate with tools the stall detector provides (hooks/stall-check.mjs)',
  );
}
if (/OAuth|not authenticated|Failed to authenticate|Invalid API key/i.test(stderr)) {
  cleanup();
  cannotMeasure(
    'the CLI could not authenticate',
    'run this from a terminal with an authenticated `claude`, or set an API key in CI. A nested `claude -p` inside a Claude Code session cannot authenticate.',
  );
}
if (transcript.trim() === '') {
  cleanup();
  cannotMeasure(`the run produced no transcript (exit ${run.status})`, stderr.slice(0, 400));
}

// The CLI's own verdict, and where it actually lives. This was wrong on the first attempt and the
// mistake is worth recording, because it is the same class this whole file is about: I checked
// STDERR for an authentication failure, and there is none there. A failed run emits a valid
// stream-json transcript ending in a `type: "result"` event carrying `is_error: true`,
// `terminal_reason` and a human message — measured against a real failing run, whose stderr held
// only an unrelated stdin warning. So the honesty check read the wrong stream, sailed past a run
// that never started, and reported FAIL — "the product is broken" — for a run it had not
// measured. Exactly the fault this test exists to catch, in the test itself.
//
// Any `is_error` result means the run did not complete, and a product cannot be judged from an
// incomplete run. That is COULD NOT MEASURE, not a verdict.
{
  const lines = transcript
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let verdict = null;
  for (const l of lines) {
    try {
      const j = JSON.parse(l);
      if (j && j.type === 'result') verdict = j;
    } catch {
      /* a partial line is not a verdict */
    }
  }
  if (verdict && verdict.is_error) {
    cleanup();
    cannotMeasure(
      `the CLI reported the run as failed: ${String(verdict.result || '').slice(0, 300)}`,
      verdict.terminal_reason === 'api_error'
        ? 'this is an infrastructure or authentication failure, not a product defect. Run from a terminal with an authenticated `claude`, or set an API key in CI. If it says the OAuth session expired on a machine that IS signed in, check ANTHROPIC_BASE_URL: setting it makes the CLI expect an API key instead of the OAuth login, and `env -u ANTHROPIC_BASE_URL` fixes it (X379).'
        : `terminal_reason: ${verdict.terminal_reason}`,
    );
  }
  if (!verdict) {
    cleanup();
    cannotMeasure(
      'the transcript contains no `type: "result"` event, so the CLI never reported whether the run finished',
      'the run was probably killed; nothing can be concluded about the product from it',
    );
  }
}

console.log(
  `run finished in ${elapsedMin} min (exit ${run.status}); ${transcript.length} bytes of transcript\n`,
);

// ---- transcript assertions: was the work DONE, or described? ---------------------------------
const events = transcript
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

check('the transcript is parseable stream-json', events.length > 0, `${events.length} events`);

// ---- was the studio even LOADED? ------------------------------------------------------------
// This must be settled before a single assertion about the product, and it is the lesson of
// X378: the first real run of this harness pointed `--plugin-dir` at the wrong directory, so the
// studio's skills and agents were never available. The harness then judged a plain Claude session
// and reported eight product failures, every one of which was its own misconfiguration.
//
// The init event settles it factually. It carries `skills`, `agents`, `slash_commands` and
// `plugins` arrays, and a correctly-loaded plugin appears in all of them; a plugin pointed at by
// the wrong path appears ONLY in `plugins`, with none of its contents. So "registered" is not
// "loaded", and only the second is worth measuring against.
//
// A setup failure is exit 2, never exit 1. Blaming the product for the harness is the one
// mistake this file is least entitled to make.
{
  const init = events.find((e) => e && e.type === 'system' && e.subtype === 'init');
  if (!init) {
    cleanup();
    cannotMeasure(
      'the transcript carries no system/init event, so what was loaded cannot be established',
    );
  }
  const own = (arr) =>
    Array.isArray(arr) ? arr.filter((x) => /^gru953-studio:/.test(String(x))) : [];
  const skills = own(init.skills);
  const agents = own(init.agents);
  const commands = own(init.slash_commands);
  const hasEntry = skills.includes('gru953-studio:studio');
  if (!hasEntry || agents.length === 0) {
    cleanup();
    cannotMeasure(
      `the studio was not loaded: ${skills.length} plugin skill(s), ${agents.length} agent(s), ${commands.length} command(s), and the entry point ${hasEntry ? 'was' : 'was NOT'} among them`,
      `--plugin-dir must point at the plugin directory itself (${PLUGIN_DIR}), not its parent. A plugin pointed at by the wrong path still appears in the init event's \`plugins\` array while none of its skills or agents load.`,
    );
  }
  console.log(
    `studio loaded: ${skills.length} skills, ${agents.length} agents, ${commands.length} commands\n`,
  );
}

const flat = JSON.stringify(events);
const toolUses = toolUsesIn(events);
const toolNames = toolUses.map((t) => t.name);

check(
  'the studio skill was actually loaded',
  /gru953|studio/i.test(flat) && toolNames.some((n) => /Skill/i.test(n)),
  `tools used: ${[...new Set(toolNames)].join(', ').slice(0, 160)}`,
);
check(
  'specialists were dispatched, not impersonated',
  dispatchCount(toolNames) >= 2,
  `${dispatchCount(toolNames)} dispatch(es)`,
);
// The v7 assertion. Nothing else in this repository would catch a run that acquired a remote.
// 2026-08-27, X382. This is the most important assertion in the file and it produced a FALSE
// POSITIVE on the first run that got far enough to exercise it. The command it flagged was:
//
//   echo '{"tool_name":"Bash","tool_input":{"command":"git push origin development"}}' \
//     | node $P/hooks/scan.mjs      (description: "Drive the secret scan hook with a push payload")
//
// The studio was TESTING ITS OWN push-safety hook, feeding it a synthetic payload to confirm the
// guard fires. It never pushed: the project had no remote and its reflog held no push. So the check
// matched the words "git push" inside a quoted payload and reported the one thing it exists to
// prove had been violated — while the actual evidence (no remote, nothing in the reflog) sat two
// assertions below, passing.
//
// Two changes. Commands that pipe a payload into one of this plugin's own hooks are excluded: that
// is a hook being exercised, not a push being run, and a studio that verifies its own safety
// controls mid-build is doing something this harness should encourage rather than fail. And more
// importantly, the git STATE below is the authoritative evidence and always was. Command text is a
// secondary signal for catching an attempt that failed; it can never be the proof, because text is
// not an action.
// The judgement itself lives in judge.mjs so it can be tested on known inputs in milliseconds
// rather than only by a seventy-minute run. See that file for the two false positives it encodes.
const pushish = pushAttempts(toolUses);
check(
  'NOTHING was pushed and no remote was created',
  pushish.length === 0,
  pushish.length ? `attempted: ${pushish[0].slice(0, 200)}` : '',
);

// ---- filesystem assertions: do the artefacts exist? ------------------------------------------
const has = (rel) => fs.existsSync(path.join(work, rel));
const readJson = (rel) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(work, rel), 'utf8'));
  } catch {
    return null;
  }
};

check('Dev-Memory/ was created', has('Dev-Memory'));
for (const [rel, label] of [
  ['Dev-Memory/run-brief.json', 'the brief was recorded as data'],
  ['Dev-Memory/tasks.json', 'the task ledger was recorded as data'],
  ['Dev-Memory/dod.json', 'the Definition of Done was declared'],
]) {
  const j = readJson(rel);
  check(
    label,
    j && j.schemaVersion === 1,
    j ? `schemaVersion ${JSON.stringify(j.schemaVersion)}` : 'missing or unparseable',
  );
}
// THE ASSERTION THIS HARNESS EXISTED WITHOUT. It checked that `dod.json` was DECLARED and never
// that anything was RUN — which is the product's own central failure mode, reproduced in the one
// test whose job is to catch it. A studio that writes a well-formed Definition of Done and never
// executes it passed every check above. Added 2026-08-27 (contract sweep).
{
  const evidenceDir = path.join(work, 'Dev-Memory', 'evidence');
  let files = [];
  try {
    files = fs.readdirSync(evidenceDir).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }
  check(
    'the Definition of Done was MEASURED, not merely declared',
    files.length > 0,
    `${files.length} evidence file(s) in Dev-Memory/evidence/`,
  );

  // Evidence carrying no real exit code is evidence of nothing. A judged dimension legitimately
  // has none, so this asks for at least one EXECUTED record — something was actually run.
  let executed = 0;
  for (const f of files) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(evidenceDir, f), 'utf8'));
      if (rec && rec.kind === 'executed' && Number.isInteger(rec.exitCode)) executed += 1;
    } catch {
      /* a file that will not parse is counted as not executed, which is the honest reading */
    }
  }
  check(
    'at least one dimension records a real exit code from a real command',
    executed > 0,
    `${executed} executed record(s)`,
  );

  // And the studio's own output must satisfy the gate that grades it — run here rather than
  // trusted, because "the gate would have passed" is exactly the kind of claim this harness
  // exists to stop anybody making.
  const qg = spawnSync(
    process.execPath,
    [path.join(REPO, 'plugins', 'gru953-studio', 'hooks', 'quality-gate.mjs'), work],
    { encoding: 'utf8' },
  );
  // quality-gate.mjs answers "not a studio project" with exit 0 for a tree that has no
  // Dev-Memory/ at all — correct for the gate, and a VACUOUS pass here: a run that built nothing
  // would have satisfied the assertion that its Definition of Done was acceptable. So the
  // no-op answer is refused explicitly rather than counted.
  const qgOut = String(qg.stdout || '');
  check(
    "the studio's own Definition-of-Done record satisfies quality-gate.mjs",
    qg.status === 0 && !/not a studio project/.test(qgOut),
    /not a studio project/.test(qgOut)
      ? 'the gate found no Dev-Memory to grade — a pass here would mean nothing'
      : `exit ${qg.status}: ${qgOut.slice(0, 200)}`,
  );
}

check(
  'Dev-Memory/ is gitignored (it is working memory, not the product)',
  has('.gitignore') &&
    /(^|\n)\s*Dev-Memory\/?\s*(\n|$)/.test(fs.readFileSync(path.join(work, '.gitignore'), 'utf8')),
);

const sources = fs
  .readdirSync(work, { withFileTypes: true, recursive: true })
  .filter(
    (d) =>
      d.isFile() &&
      /\.(js|mjs|cjs|ts)$/.test(d.name) &&
      !String(d.parentPath || d.path || '').includes('node_modules'),
  );
check('source files exist', sources.length > 0, `${sources.length} file(s)`);

// ---- the built project's OWN tests must pass -------------------------------------------------
const pkg = readJson('package.json');
if (pkg && pkg.scripts && pkg.scripts.test) {
  const t = spawnSync('npm', ['test'], { cwd: work, encoding: 'utf8', timeout: 5 * 60 * 1000 });
  check("the built project's own tests pass", t.status === 0, `npm test exited ${t.status}`);
} else {
  const t = spawnSync('node', ['--test'], { cwd: work, encoding: 'utf8', timeout: 5 * 60 * 1000 });
  check("the built project's own tests pass", t.status === 0, `node --test exited ${t.status}`);
}

// ---- it committed its work --------------------------------------------------------------------
// THE ONE THAT EXPLAINS THE OTHERS. Added 2026-08-28 after a Complex-Tier run failed five
// assertions with a single cause: it ended while its own ledger still named a next task.
//
// Measured: 22 tasks, 5 done, 17 todo; `task-ledger.mjs` exiting 0 and naming `T6`;
// `stop_reason: "end_turn"`, `terminal_reason: "completed"`, `api_error_status: null`, no
// permission denials, 14 specialists dispatched and 92 tests passing. Nothing was broken,
// blocked, throttled or waiting on a human. The run treated the end of a turn as the end of
// the work — so `dod.json` was never written, the Definition of Done never ran, and nothing
// was committed. Reporting those three as separate failures buries the cause under its
// symptoms, and a reader fixes the symptoms.
//
// So this is asserted FIRST and states the cause in one line. It is the assertion a Tiny
// brief can never fail, because few enough tasks fit inside one turn-group — which is why
// the release requires a Complex run and why a green Tiny run proves nothing about it.
{
  const ledger = path.join(work, 'Dev-Memory', 'tasks.json');
  if (fs.existsSync(ledger)) {
    const tl = spawnSync(
      'node',
      [path.join(REPO, 'plugins', 'gru953-studio', 'hooks', 'task-ledger.mjs'), work],
      { encoding: 'utf8' },
    );
    let unfinished = null;
    try {
      const j = JSON.parse(tl.stdout || '{}');
      const next = typeof j.next === 'string' ? j.next : j.next && j.next.id;
      if (tl.status === 0 && next) unfinished = next;
    } catch {
      /* an unreadable ledger is covered by the ledger-validity assertion below */
    }
    check(
      'the run did not stop while its own ledger still had runnable work',
      unfinished === null,
      unfinished === null
        ? ''
        : `the session ended normally, but task-ledger.mjs exits 0 and names \`${unfinished}\` as the next runnable task — the run treated a turn boundary as the end of the job. Every later failure here (no dod.json, no evidence, no commits) follows from this one`,
    );
  }
}

const log = spawnSync('git', ['log', '--oneline'], { cwd: work, encoding: 'utf8' });
const commits = String(log.stdout || '')
  .trim()
  .split('\n')
  .filter(Boolean).length;
// 2026-08-27, X382. Was `commits >= 2`, a number I picked rather than one I could justify. A real
// run then committed the whole finished project — 15 files, 1,246 lines — in ONE commit, and was
// marked as failing. For a single-phase brief that is exactly right: the studio checkpoints per
// phase, and a project with one phase has one checkpoint. This assertion exists to prove the work
// was committed AT ALL, not to mandate a shape of history the product never promised.
check('the work was committed', commits >= 1, `${commits} commit(s)`);

const remotes = spawnSync('git', ['remote'], { cwd: work, encoding: 'utf8' });
check(
  'no git remote exists',
  String(remotes.stdout || '').trim() === '',
  String(remotes.stdout || '').trim(),
);

const tracked = spawnSync('git', ['ls-files', 'Dev-Memory'], { cwd: work, encoding: 'utf8' });
check('Dev-Memory was never committed', String(tracked.stdout || '').trim() === '');

// ---- the brief's non-goals were respected ----------------------------------------------------
const brief = readJson('Dev-Memory/run-brief.json');
if (brief && Array.isArray(brief.nonGoals)) {
  const tree = sources
    .map((s) => s.name)
    .join(' ')
    .toLowerCase();
  // DERIVED FROM THE BRIEF, not a fixed list. It used to be
  // ['sqlite','postgres','mysql','express','react'] — words drawn from the Tiny brief's own "not
  // doing" line — so the assertion silently became wrong for any other brief: a Standard-Tier web
  // app that legitimately needs express or a database would have been reported as scope creep, and
  // a Tiny brief ruling out something else entirely was never checked for it at all.
  //
  // The nonGoals the run itself recorded are the right source: they are what the owner agreed was
  // out of scope for THIS build.
  const STOPWORDS = new Set([
    'no',
    'not',
    'none',
    'nothing',
    'doing',
    'a',
    'an',
    'the',
    'or',
    'and',
    'with',
    'for',
    'of',
    'server',
    'accounts',
    'account',
    'user',
    'users',
    'support',
    'syncing',
    'sync',
  ]);
  const forbidden = [
    ...new Set(
      brief.nonGoals
        .join(' ')
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
    ),
  ];
  const violated = forbidden.filter((w) => tree.includes(w));
  check(
    'nothing outside the brief was built',
    violated.length === 0,
    violated.length
      ? `filenames mention ruled-out things: ${violated.join(', ')}`
      : `checked ${forbidden.length} recorded non-goal term(s)`,
  );
}

// ---- verdict ----------------------------------------------------------------------------------
// ORDER MATTERS, and the first version of this got it wrong. `cleanup()` used to run here, before
// preserveEvidence() further down — so the work tree was deleted and then copied, and a failing run
// preserved its transcript and an empty directory where the tree should have been. Measured on the
// run that found it: `evidence preserved at …` printed, and the folder held one file. The fix that
// was supposed to stop this harness destroying its own evidence destroyed half of it.
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) preserveEvidence(transcript);
cleanup();
console.log('');
if (failed.length === 0) {
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        checks: results.length,
        minutes: Number(elapsedMin),
        transcriptBytes: transcript.length,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
console.log(
  JSON.stringify(
    {
      status: 'FAIL',
      failed: failed.map((f) => ({ check: f.name, detail: f.detail })),
      passed: results.length - failed.length,
      of: results.length,
      minutes: Number(elapsedMin),
      evidence: preserved,
    },
    null,
    2,
  ),
);
process.exit(1);
