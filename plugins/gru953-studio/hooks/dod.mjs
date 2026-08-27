#!/usr/bin/env node
//
// dod.mjs — the Definition of Done, EXECUTED rather than attested.
//
// WHY THIS EXISTS. `quality-gate.mjs` reads `Dev-Memory/QUALITY-GATE.md` and checks that every
// required dimension appears as a row marked pass with some evidence text. Neither it nor
// `verify-progress.mjs` imports `child_process` at all — the only `exec` in either is a regex
// `.exec()`. **The agents write that table themselves.** Interactively that is defensible: a
// person reads the summary and notices when the app does not work. With nobody watching, the
// loop becomes — agent does the work, agent writes its own report card, gate marks the report
// card, gate passes. That is the "measured nothing, reported healthy" class of X348-X368,
// one level up: at the level of the product's own promise rather than its gates.
//
// So this gate RUNS things. Every executed dimension either produces a real exit code from a
// real command, or is explicitly marked not-applicable with a reason. Nothing is believed
// because a file says so.
//
// HOW IT FITS THE EXISTING GATE, rather than competing with it. This does not replace
// quality-gate.mjs; it feeds it. After running the commands, this gate REGENERATES
// `Dev-Memory/QUALITY-GATE.md` from the evidence it just collected, so the table
// quality-gate.mjs verifies is machine-written from measured exit codes instead of composed by
// the agent being graded. Both gates then run, and they check different things: this one that
// the work was done, that one that no required dimension is missing from the record. A
// hand-edited QUALITY-GATE.md is overwritten on the next run — deliberately, because a table
// that can be edited by the thing it grades is the defect this file exists to remove.
//
// TRUST MODEL, stated plainly. This executes commands named in the project's own
// `Dev-Memory/dod.json`. That is not a privilege escalation: the agent that writes that file
// can already run commands directly. What it buys is that a claim of "tests pass" is bound to
// an execution that actually happened, with its exit code and output recorded. Commands are
// spawned as an argv ARRAY with no shell, so nothing in a project file is interpolated into a
// shell line — a project whose test command contains a semicolon runs a program with a
// semicolon in its arguments, it does not gain a second command.
//
// Usage: node dod.mjs [projectRoot]
// Exit 0 = every required dimension passed or is n/a with a reason, and evidence was written.
// Exit 1 = anything else, including anything this gate could not determine.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { classifyStudioRoot, formatFsError, readOrBlock, MISSING } from './lib.mjs';

const root = process.argv[2] || process.cwd();
// Resolved separately from `root`, which is reported verbatim in this gate's output so a caller
// sees the path it passed. Containment must be decided on the absolute, normalised form: a
// prefix test against a relative root ('.') would admit any path that happens to start with a
// dot, which is every relative path there is.
const rootAbs = path.resolve(root);
const problems = [];
const fail = (msg) => problems.push(msg);

const SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_CAPTURED_OUTPUT = 20000; // per stream, per dimension

// The dimensions this gate EXECUTES. Each maps onto a row quality-gate.mjs already requires,
// so this is a superset of that taxonomy rather than a fork of it — the seven keys it knows
// (acceptance, tests, review, security, accessibility, docs, build) all still appear in the
// generated table.
//
// `runs` is the machine-checkable form of "acceptance criteria proven": start the thing and
// drive a real user journey. It is the single most important row here, because it is the only
// one that can fail while every other one passes — which is exactly what "the tests are green
// but the app does not work" means.
// The lowest coverage floor this product will accept as a measurement. A project may state a
// floor; it may not state one so low that the dimension stops discriminating. Found 2026-08-27
// (contract sweep): `{"coverage":{"command":[...],"minPercent":0,"reportPath":"c.json"}}` produced
// the row "coverage 0% meets the 0% floor" and a clean exit — the gate rendering its own
// vacuousness as a pass. The old check only required 0 <= minPercent <= 100, so 0 was in range.
//
// A floor BELOW this is not silently raised, because silently measuring something other than what
// the project declared is its own defect. It is refused, and the refusal names both numbers. A
// project with a real reason (a spike, a generated-code package) may go lower by declaring
// `floorBelowProductMinimumBecause`, which makes the exception a recorded decision rather than a
// quiet number. Zero is refused even then: at 0% the dimension cannot fail, so it is not a check.
const MIN_COVERAGE_FLOOR = 60;

// Programs that cannot measure anything, whatever they are declared against. `["true"]` satisfied
// all ten executed dimensions before this existed — ten green rows, nothing run. Enumerated rather
// than pattern-matched, the same discipline scan.mjs applies to catastrophic commands: a list of
// named programs is auditable, a regex over command text is a guess.
//
// RESIDUAL, STATED: this catches the obvious vacuity, not a determined one. `["node","-e","0"]` or
// a script whose body is `exit 0` still passes, and no static check can tell a real test runner
// from a program that pretends to be one. What closes that gap is not this list but the artefacts
// the other checks demand — a coverage report with a real percentage, a report file that has to
// exist and parse. This list exists because the vacuous case was reachable by accident, not only
// by intent.
const VACUOUS_PROGRAMS = new Set(['true', ':', 'echo', 'printf', 'exit', 'sleep', 'pwd', 'false']);

const EXECUTED = [
  { key: 'build', label: 'build succeeds', row: 'Reproducible build' },
  { key: 'tests', label: 'test suite passes', row: 'Automated tests' },
  { key: 'coverage', label: 'coverage meets its floor', row: 'Test coverage' },
  { key: 'lint', label: 'linter clean', row: 'Lint' },
  { key: 'types', label: 'type check clean', row: 'Type check' },
  { key: 'security', label: 'security scan clean', row: 'Security / licence / privacy' },
  { key: 'dependencies', label: 'dependency audit clean', row: 'Dependency audit' },
  {
    key: 'runs',
    label: 'the built software actually runs a real user journey',
    row: 'Acceptance criteria (it actually runs)',
  },
  { key: 'accessibility', label: 'accessibility checks pass', row: 'Accessibility' },
  { key: 'performance', label: 'performance budgets met', row: 'Performance budget' },
];

// Dimensions no machine can measure. They are kept SEPARATE and labelled as judgements, not
// folded in among the measurements — the honest distinction the rebuild plan requires. Each
// must still name what was judged (an artefact reference), so a verdict is at least bound to
// something concrete rather than floating free.
const JUDGED = [
  { key: 'review', label: 'independent code review', row: 'Independent code review' },
  { key: 'docs', label: 'documentation matches what was built', row: 'Documentation' },
];

function iso(ms) {
  return new Date(ms).toISOString();
}

function truncate(s) {
  const t = String(s || '');
  return t.length > MAX_CAPTURED_OUTPUT
    ? `${t.slice(0, MAX_CAPTURED_OUTPUT)}\n…[truncated ${t.length - MAX_CAPTURED_OUTPUT} bytes]`
    : t;
}

// ---- the root must be a studio project, and this gate must be able to read it -------------
const kind = classifyStudioRoot(root);
if (kind.kind === 'unreadable') {
  console.log(JSON.stringify({ status: 'BLOCKED', problems: [kind.why], root }, null, 2));
  process.exit(1);
}
if (kind.kind === 'not-studio') {
  console.log(
    JSON.stringify({
      status: 'not a studio project',
      reason: 'no Dev-Memory/ directory — nothing to run',
      root,
    }),
  );
  process.exit(0);
}

const devMemory = kind.devMemory;
const configPath = path.join(devMemory, 'dod.json');
const evidenceDir = path.join(devMemory, 'evidence');

// ---- the configuration, read fail-closed --------------------------------------------------
const rawConfig = readOrBlock(configPath);
if (rawConfig === MISSING) {
  console.log(
    JSON.stringify(
      {
        status: 'BLOCKED',
        problems: [
          `Dev-Memory/dod.json is missing. This gate proves the Definition of Done by RUNNING it, so it needs the project to declare, per dimension, either the command that proves it or that the dimension does not apply and why. Without that file there is nothing to execute — and reporting clean would be exactly the self-attestation this gate replaces. Required dimensions: ${EXECUTED.map((d) => d.key).join(', ')} (executed) and ${JUDGED.map((d) => d.key).join(', ')} (judged).`,
        ],
        root,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

let config;
try {
  config = JSON.parse(rawConfig);
} catch (e) {
  console.log(
    JSON.stringify(
      {
        status: 'BLOCKED',
        problems: [
          `Dev-Memory/dod.json is not valid JSON (${e.message}) — an unparseable definition of done is not a met one`,
        ],
        root,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

// A schema version is checked from the first release deliberately. A 7.0.0 gate meeting a
// 6.1.0 project has to be able to tell "written by an older version" from "damaged", and the
// only thing that makes that possible is having recorded a version from the beginning.
if (config.schemaVersion !== SCHEMA_VERSION) {
  console.log(
    JSON.stringify(
      {
        status: 'BLOCKED',
        problems: [
          `Dev-Memory/dod.json declares schemaVersion ${JSON.stringify(config.schemaVersion)}, and this gate understands ${SCHEMA_VERSION}. It refuses rather than guessing: a file in a shape this gate does not know might mean every dimension passes, or might mean none of them was ever run, and those must not share an answer.`,
        ],
        root,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const declared =
  config.dimensions && typeof config.dimensions === 'object' ? config.dimensions : null;
if (!declared) {
  console.log(
    JSON.stringify(
      {
        status: 'BLOCKED',
        problems: [
          'Dev-Memory/dod.json has no `dimensions` object — nothing is declared, so nothing can be proven',
        ],
        root,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

// ---- evidence directory -------------------------------------------------------------------
try {
  fs.mkdirSync(evidenceDir, { recursive: true });
} catch (e) {
  console.log(
    JSON.stringify(
      {
        status: 'BLOCKED',
        problems: [
          `cannot create Dev-Memory/evidence/ — ${formatFsError(e)}. Evidence that cannot be written is evidence that does not exist, so this gate blocks rather than running checks whose results it could not record`,
        ],
        root,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const results = [];

function writeEvidence(key, payload) {
  const p = path.join(evidenceDir, `${key}.json`);
  try {
    fs.writeFileSync(p, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return true;
  } catch (e) {
    fail(
      `could not write Dev-Memory/evidence/${key}.json — ${formatFsError(e)}. A dimension whose evidence cannot be recorded is not proven`,
    );
    return false;
  }
}

/**
 * Run one declared command and return a structured, recorded result.
 *
 * Deliberately `shell: false` with an argv array. A project file is data, and a string handed
 * to a shell is a command line — that difference is the whole distance between running the
 * project's test suite and running whatever else somebody put in the string.
 */
function execute(key, spec) {
  const argv = spec.command;
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === 'string')) {
    fail(
      `${key}: \`command\` must be a non-empty array of strings (an argv array, e.g. ["npm","test"]). A single string is refused on purpose — it would have to be handed to a shell to run, and this gate never does that.`,
    );
    return null;
  }
  // Look THROUGH the programs whose job is to run another program, and past environment
  // assignments and their flags. 2026-08-27: `["env","true"]` gave ten green executed dimensions
  // and two clean gates having measured nothing, because this checked argv[0] and argv[0] was
  // `env`. `["sh","-c","true"]` is caught by the same walk reaching the script text.
  const RUNNERS = new Set([
    'env',
    'nice',
    'nohup',
    'time',
    'timeout',
    'stdbuf',
    'command',
    'exec',
    'xargs',
    'sudo',
    'doas',
  ]);
  let pi = 0;
  while (
    pi < argv.length - 1 &&
    (RUNNERS.has(path.basename(argv[pi]).toLowerCase()) ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[pi]) ||
      (pi > 0 && argv[pi].startsWith('-')))
  ) {
    pi += 1;
  }
  const program = path.basename(argv[pi]);
  // `sh -c 'true'` / `bash -c ':'` — the vacuity is in the script text, not in argv[0].
  if (/^(sh|bash|zsh|dash|ksh)$/.test(program)) {
    const dashC = argv.indexOf('-c');
    const script = dashC >= 0 ? (argv[dashC + 1] || '').trim() : '';
    const firstWord = path.basename(script.split(/\s+/)[0] || '');
    if (script === '' || VACUOUS_PROGRAMS.has(firstWord)) {
      fail(
        `${key}: \`${argv.join(' ')}\` cannot measure ${key} — the shell script it runs (${JSON.stringify(script.slice(0, 60))}) does nothing but produce an exit code. Declare the command that actually checks this dimension, or mark it \`notApplicable\` with a reason.`,
      );
      return null;
    }
  }
  if (VACUOUS_PROGRAMS.has(program)) {
    fail(
      `${key}: \`${argv.join(' ')}\` cannot measure ${key}. \`${program}\` produces an exit code without inspecting anything, so this row would be green whatever the state of the code. Declare the command that actually checks this dimension, or mark it \`notApplicable\` with a reason.`,
    );
    return null;
  }

  // The directory a check runs in is part of what it measures. Unconfined, `"cwd": "../.."` runs
  // the parent repository's green test suite and records it as this project's — and the generated
  // table said nothing about where anything ran, so the substitution was invisible in the output
  // as well as unchecked in the input. Confined to the project, and surfaced in the row below.
  const cwd = path.resolve(rootAbs, typeof spec.cwd === 'string' ? spec.cwd : '.');
  if (!(cwd === rootAbs || cwd.startsWith(rootAbs + path.sep))) {
    fail(
      `${key}: \`cwd\` resolves to ${cwd}, which is outside the project root ${rootAbs}. A check that runs somewhere else measures somewhere else — most usefully for whoever wanted a green row, since the parent repository's suite probably passes.`,
    );
    return null;
  }
  const timeout =
    Number.isInteger(spec.timeoutMs) && spec.timeoutMs > 0 ? spec.timeoutMs : DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    timeout,
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  const endedAt = Date.now();

  // A command that could not be started, or that was killed on timeout, has not passed and has
  // not failed the thing it measures — it has not measured. Both are blocks, and both are named
  // as what they are rather than folded into "non-zero exit".
  let verdict;
  let why;
  if (r.error && r.error.code === 'ETIMEDOUT') {
    verdict = 'timeout';
    why = `did not finish within ${timeout} ms and was killed. An unattended run cannot wait forever, and a check that never completed proves nothing`;
  } else if (r.error) {
    verdict = 'could-not-run';
    why = `could not be started — ${r.error.code || r.error.message}. Check the command exists in this environment`;
  } else if (r.status === 0) {
    verdict = 'pass';
    why = 'exit 0';
  } else {
    verdict = 'fail';
    why = `exit ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}`;
  }

  return {
    dimension: key,
    kind: 'executed',
    command: argv,
    cwd,
    startedAt: iso(startedAt),
    endedAt: iso(endedAt),
    durationMs: endedAt - startedAt,
    exitCode: r.status === undefined ? null : r.status,
    signal: r.signal || null,
    verdict,
    why,
    stdout: truncate(r.stdout),
    stderr: truncate(r.stderr),
  };
}

/**
 * Coverage is the one executed dimension whose pass condition is a NUMBER, not an exit code.
 * A coverage tool exits 0 while reporting 4% just as happily as it does at 95%, so reading the
 * exit code alone would make this dimension decorative. The percentage is read from the tool's
 * own machine-readable report file — never scraped from stdout prose, which is how a
 * "coverage: see report" evidence cell used to satisfy the old gate.
 */
/**
 * Refuse this dimension AND mark the result, in one act.
 *
 * 2026-08-27, found by attacking the fix that added the coverage floor. `fail()` records a
 * problem for THIS process's exit code; it does not touch the result object. So a refusal left
 * `res.verdict` at 'pass' (set from the command's exit code), and the run went on to write
 * `{"verdict":"pass"}` into evidence and render `| Test coverage | pass | ... |` into
 * QUALITY-GATE.md. dod.mjs exited 1 — but quality-gate.mjs, reading the table it had just
 * written, returned CLEAN. Measured end to end: a `minPercent: 0` project, refused by dod.mjs,
 * certified by the gate immediately after.
 *
 * The two must never diverge again: a dimension this gate refuses is BLOCKED in the record as
 * well as in the exit code. Everything downstream reads the record.
 */
function refuse(res, message) {
  fail(message);
  if (res && typeof res === 'object') {
    res.verdict = 'blocked';
    res.why = message;
  }
  return res;
}

function checkCoverageFloor(spec, res) {
  const floor = spec.minPercent;
  if (typeof floor !== 'number' || !(floor >= 0 && floor <= 100)) {
    return refuse(
      res,
      'coverage: `minPercent` must be a number between 0 and 100. Without a stated floor this dimension measures nothing — a run at 3% would pass',
    );
  }
  if (floor <= 0) {
    return refuse(
      res,
      'coverage: `minPercent` is 0, so this dimension cannot fail and therefore is not a check. A floor of zero is refused outright — no reason makes a measurement that always passes into a measurement. Either state a real floor or mark coverage `notApplicable` with a reason, which is at least honest about not measuring it.',
    );
  }
  if (floor < MIN_COVERAGE_FLOOR) {
    const because =
      typeof spec.floorBelowProductMinimumBecause === 'string'
        ? spec.floorBelowProductMinimumBecause.trim()
        : '';
    if (because === '') {
      return refuse(
        res,
        `coverage: \`minPercent\` is ${floor}, below this product's minimum floor of ${MIN_COVERAGE_FLOOR}. A floor set beneath the bar is the bar being lowered by the work being graded. If the project genuinely needs a lower one, declare \`floorBelowProductMinimumBecause\` with the reason, so the exception is a recorded decision rather than a quiet number.`,
      );
    }
    res.floorBelowProductMinimum = { floor, productMinimum: MIN_COVERAGE_FLOOR, because };
  }
  if (typeof spec.reportPath !== 'string' || spec.reportPath === '') {
    return refuse(
      res,
      "coverage: `reportPath` must name the coverage tool's machine-readable report. The percentage is never scraped from stdout — prose is not a measurement",
    );
  }
  const rp = path.resolve(rootAbs, spec.reportPath);
  if (!(rp === rootAbs || rp.startsWith(rootAbs + path.sep))) {
    return refuse(
      res,
      `coverage: \`reportPath\` resolves to ${rp}, which is outside the project root ${rootAbs}. A coverage figure read from another repository is that repository's figure.`,
    );
  }
  // THE NUMBER MUST COME FROM THIS RUN. 2026-08-27: dod.mjs ran the coverage command and then
  // read `reportPath`, never checking that the file was written BY that command. A report dated
  // 2020, sitting in the tree and produced by nobody knows what, satisfied an 80% floor — and
  // unlike dod.json and evidence/, the report file is not guarded, so anything could author it.
  // An executed Definition of Done that reads a number it did not cause is an attestation with
  // extra steps.
  try {
    const st = fs.statSync(rp);
    const startedAt = Date.parse(res.startedAt);
    if (Number.isFinite(startedAt) && st.mtimeMs < startedAt - 2000) {
      return refuse(
        res,
        `coverage: ${spec.reportPath} was last written ${new Date(st.mtimeMs).toISOString()}, BEFORE the coverage command started at ${res.startedAt}. This run did not produce that report, so the percentage in it is not this run's coverage. Make the coverage command write its report, or point reportPath at the file it does write.`,
      );
    }
  } catch (e) {
    return refuse(
      res,
      `coverage: could not inspect ${spec.reportPath} to confirm this run produced it — ${formatFsError(e)}`,
    );
  }
  const raw = readOrBlock(rp);
  if (raw === MISSING) {
    res.verdict = 'could-not-run';
    res.why = `coverage command finished but its report ${spec.reportPath} does not exist, so the percentage could not be read`;
    return res;
  }
  let pct = null;
  try {
    const j = JSON.parse(raw);
    // Support the two shapes real tools emit, and nothing else. Guessing at a third would be
    // how a wrong number gets read as a right one.
    if (j && j.total && j.total.lines && typeof j.total.lines.pct === 'number')
      pct = j.total.lines.pct;
    else if (typeof j.lineCoverage === 'number')
      pct = j.lineCoverage * (j.lineCoverage <= 1 ? 100 : 1);
  } catch (e) {
    res.verdict = 'could-not-run';
    res.why = `coverage report ${spec.reportPath} is not valid JSON (${e.message})`;
    return res;
  }
  if (pct === null) {
    res.verdict = 'could-not-run';
    res.why = `coverage report ${spec.reportPath} parsed, but no recognised total-line-coverage field was found (expected total.lines.pct or lineCoverage)`;
    return res;
  }
  res.coveragePercent = pct;
  res.floorPercent = floor;
  if (res.verdict === 'pass' && pct < floor) {
    res.verdict = 'fail';
    res.why = `coverage ${pct}% is below the declared floor of ${floor}%`;
  } else if (res.verdict === 'pass') {
    res.why = `exit 0 and coverage ${pct}% meets the ${floor}% floor`;
  }
  return res;
}

// ---- an n/a the project itself contradicts ------------------------------------------------
// `notApplicable` was any non-empty string, and any non-empty string was accepted. So the whole
// Definition of Done could be waived one sentence at a time — twelve reasons, nothing run, exit 0
// and a clean table — and the reasons never had to be true. Found 2026-08-27 (contract sweep).
//
// The fix is not to judge the prose. It is to notice when the TREE disagrees with it: "no tests in
// this project" is a checkable claim, and a project with a test suite has just made a false one.
// Only the dimensions with a cheap, unambiguous refutation are listed. `accessibility`,
// `performance`, `runs` and `security` are legitimately n/a for many real projects and have no
// mechanical refutation that would not fire on honest configurations, so they are NOT here — a
// gate that cries wolf on a correct project is a gate that gets switched off.
//
// `coverage` was drafted into this list and then removed, deliberately: "we have tests but no
// coverage instrumentation" is an ordinary, honest state for a small project, and refusing it
// would force coverage tooling onto every Tiny-Tier build just to satisfy a check. Coverage is
// held honest in checkCoverageFloor instead — which acts when the project says it IS measuring,
// and that is the claim capable of being hollow.
function refuteNotApplicable(key) {
  const has = (rel) => {
    try {
      return fs.existsSync(path.join(rootAbs, rel));
    } catch {
      return false;
    }
  };
  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(rootAbs, 'package.json'), 'utf8'));
  } catch {
    pkg = null;
  }
  // 2026-08-27, second correction. The first version of this took a FILENAME as evidence, and
  // three ordinary projects were refused for it:
  //   * `npm init -y` writes `"test": "echo \"Error: no test specified\" && exit 1"`. That is the
  //     commonest starting state a Node project has, and it is a placeholder meaning THERE ARE NO
  //     TESTS — read here as proof that there were. The project could then neither mark `tests`
  //     n/a (refused) nor give it a command (there is nothing to run): no legal move.
  //   * a plain-JavaScript project keeping a `tsconfig.json` purely for editor IntelliSense was
  //     told it must run a type check it has no types for.
  //   * a `spec/` directory holding written specifications, not test files, counted as tests.
  //
  // The rule is now: refute only on evidence of the CAPABILITY, never of a filename. If this
  // cannot find something that would actually run, it says nothing — which leaves the honest n/a
  // standing, and that is the right way for this to fail.
  const PLACEHOLDER_SCRIPT =
    /no test specified|not implemented|^\s*(true|exit\s+0|echo\b[^&|;]*)\s*$/i;
  const realScript = (name) => {
    if (!pkg || !pkg.scripts || typeof pkg.scripts[name] !== 'string') return null;
    const body = pkg.scripts[name].trim();
    if (body === '' || PLACEHOLDER_SCRIPT.test(body)) return null;
    return body;
  };

  // Files that would actually be RUN as tests. A directory's existence is not enough: `spec/` and
  // `test/` hold prose in plenty of real projects.
  const testFiles = () => {
    const RE = /\.(test|spec)\.[cm]?[jt]sx?$|^test_.*\.py$|_test\.(py|go|rb)$|Test\.java$/;
    const look = (dir) => {
      let names = [];
      try {
        names = fs.readdirSync(path.join(rootAbs, dir), { withFileTypes: true });
      } catch {
        return null;
      }
      const hit = names.find((d) => d.isFile() && RE.test(d.name));
      return hit ? path.join(dir, hit.name) : null;
    };
    for (const d of ['.', 'test', 'tests', '__tests__', 'spec', 'src']) {
      const hit = look(d);
      if (hit) return hit;
    }
    return null;
  };

  const testEvidence = () => {
    const script = realScript('test');
    if (script)
      return `package.json declares a real \`test\` script (${JSON.stringify(script.slice(0, 40))})`;
    const f = testFiles();
    return f ? `${f} is a test file` : null;
  };

  switch (key) {
    case 'tests':
      return testEvidence();
    case 'build':
      return realScript('build') ? 'package.json declares a real `build` script' : null;
    case 'lint': {
      if (realScript('lint')) return 'package.json declares a real `lint` script';
      for (const c of [
        'eslint.config.js',
        'eslint.config.mjs',
        '.eslintrc',
        '.eslintrc.json',
        '.eslintrc.cjs',
        'ruff.toml',
        '.flake8',
      ]) {
        if (has(c)) return `${c} exists, so this project has a linter`;
      }
      return null;
    }
    case 'types': {
      if (!has('tsconfig.json')) return null;
      if (realScript('typecheck') || realScript('tsc') || realScript('types')) {
        return 'tsconfig.json exists and package.json declares a type-check script';
      }
      // A tsconfig with no TypeScript in the tree is an editor convenience, not a type check.
      let names = [];
      try {
        names = fs.readdirSync(rootAbs, { withFileTypes: true });
      } catch {
        names = [];
      }
      const dirs = ['.', 'src', 'lib', 'app'];
      for (const d of dirs) {
        let entries = [];
        try {
          entries = fs.readdirSync(path.join(rootAbs, d), { withFileTypes: true });
        } catch {
          continue;
        }
        const ts = entries.find(
          (e) => e.isFile() && /\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name),
        );
        if (ts) return `tsconfig.json exists and ${path.join(d, ts.name)} is TypeScript`;
      }
      void names;
      return null;
    }
    case 'dependencies':
      return pkg &&
        ((pkg.dependencies && Object.keys(pkg.dependencies).length) ||
          (pkg.devDependencies && Object.keys(pkg.devDependencies).length))
        ? 'package.json declares dependencies, so there is a dependency tree to audit'
        : null;
    default:
      return null;
  }
}

// ---- run the executed dimensions ----------------------------------------------------------
for (const dim of EXECUTED) {
  const spec = declared[dim.key];
  if (spec === undefined) {
    fail(
      `${dim.key} (${dim.label}) is not declared in Dev-Memory/dod.json. Every dimension must be either given a command or marked notApplicable with a reason — the one thing it may never be is absent, because quietly skipping the check that would have caught something is the easiest way to ship below the bar.`,
    );
    continue;
  }
  if (spec && typeof spec.notApplicable === 'string' && spec.notApplicable.trim() !== '') {
    const refutation = refuteNotApplicable(dim.key);
    if (refutation) {
      fail(
        `${dim.key}: marked notApplicable ("${spec.notApplicable.trim()}"), but ${refutation}. A dimension is not waived by saying it does not apply — if it can be measured here, measure it. Give this dimension a command, or correct the claim.`,
      );
      continue;
    }
    const res = {
      dimension: dim.key,
      row: dim.row,
      kind: 'executed',
      verdict: 'n/a',
      why: spec.notApplicable.trim(),
      recordedAt: iso(Date.now()),
    };
    writeEvidence(dim.key, res);
    results.push(res);
    continue;
  }
  if (spec && spec.notApplicable !== undefined) {
    fail(
      `${dim.key}: \`notApplicable\` must be a non-empty reason string. "n/a" with no reason is an omission wearing a label`,
    );
    continue;
  }

  let res = execute(dim.key, spec || {});
  if (!res) continue;
  if (dim.key === 'coverage') res = checkCoverageFloor(spec, res);
  // The row this dimension renders as, recorded IN the evidence. That is what lets
  // quality-gate.mjs check the table against the evidence without keeping a second copy of this
  // vocabulary — and a second copy is how two gates come to disagree about what a row means.
  res.row = dim.row;
  writeEvidence(dim.key, res);
  results.push(res);
  if (res.verdict !== 'pass' && res.verdict !== 'n/a') {
    fail(`${dim.key} (${dim.label}): ${res.why}. Command: ${JSON.stringify(res.command)}`);
  }
}

// ---- record the judged dimensions ---------------------------------------------------------
for (const dim of JUDGED) {
  const spec = declared[dim.key];
  if (spec === undefined) {
    fail(`${dim.key} (${dim.label}) is not declared in Dev-Memory/dod.json`);
    continue;
  }
  if (spec && typeof spec.notApplicable === 'string' && spec.notApplicable.trim() !== '') {
    const res = {
      dimension: dim.key,
      row: dim.row,
      kind: 'judged',
      verdict: 'n/a',
      why: spec.notApplicable.trim(),
      recordedAt: iso(Date.now()),
    };
    writeEvidence(dim.key, res);
    results.push(res);
    continue;
  }
  const verdict = spec && typeof spec.verdict === 'string' ? spec.verdict.trim().toLowerCase() : '';
  const artefact = spec && typeof spec.artefact === 'string' ? spec.artefact.trim() : '';
  if (verdict !== 'pass') {
    fail(
      `${dim.key} (${dim.label}): recorded verdict is ${JSON.stringify(spec && spec.verdict)}, which is not "pass"`,
    );
    continue;
  }
  if (artefact === '') {
    fail(
      `${dim.key}: a judged dimension must name the \`artefact\` it judged (a commit SHA, a diff hash, a file path). This is a human or model judgement and cannot be measured — binding it to a specific artefact is the only thing that stops it becoming a permanent tick that nobody re-earns.`,
    );
    continue;
  }
  const res = {
    dimension: dim.key,
    row: dim.row,
    kind: 'judged',
    verdict: 'pass',
    artefact,
    by: (spec && typeof spec.by === 'string' && spec.by) || 'unrecorded',
    note: (spec && typeof spec.note === 'string' && spec.note) || '',
    recordedAt: iso(Date.now()),
    // `why` is what the generated table renders. Judged rows had no `why`, so the table read
    // "| Independent code review | pass | undefined |" — and quality-gate.mjs ACCEPTED it,
    // because "undefined" is not one of the placeholder forms it recognises. An evidence cell
    // reading "undefined" is exactly the meaningless evidence this gate exists to refuse, and it
    // was produced by this gate itself on its first real run.
    why: `judged pass by ${(spec && spec.by) || 'an unrecorded reviewer'} against artefact ${artefact} — a judgement, not a measurement`,
    caveat: 'a judgement, not a measurement — this row was not produced by running anything',
  };
  writeEvidence(dim.key, res);
  results.push(res);
}

// ---- regenerate QUALITY-GATE.md from the evidence -----------------------------------------
// The table quality-gate.mjs verifies is now written from measured exit codes rather than
// composed by the agent being graded.
{
  const byKey = new Map(results.map((r) => [r.dimension, r]));
  const lines = [
    '# Quality gate',
    '',
    '<!-- GENERATED by hooks/dod.mjs from Dev-Memory/evidence/*.json. Do not edit by hand:',
    '     this file is overwritten on every run, deliberately, because a Definition of Done',
    '     that can be edited by the work it grades is not a Definition of Done. -->',
    '',
    `Generated: ${iso(Date.now())}`,
    '',
    // The RUN's own verdict, stated in the file it produces. Belt and braces over the row-level
    // fix above: this generator has now been shown once to write a green row for a dimension it
    // had refused, and the whole cost of that bug was that the table and the exit code could
    // disagree at all. A reader of this file — human or gate — should not have to have seen the
    // exit code. quality-gate.mjs refuses a table whose Result line says BLOCKED.
    problems.length > 0
      ? `Result: BLOCKED — this run recorded ${problems.length} problem(s); see the run's output. Do not treat this table as a pass.`
      : 'Result: clean',
    '',
    '| Item | Status | Evidence |',
    '| :-- | :-- | :-- |',
  ];
  for (const dim of [...EXECUTED, ...JUDGED]) {
    const r = byKey.get(dim.key);
    if (!r) {
      lines.push(`| ${dim.row} | BLOCKED | not declared in dod.json — no evidence exists |`);
      continue;
    }
    const status = r.verdict === 'pass' ? 'pass' : r.verdict === 'n/a' ? 'n/a' : 'BLOCKED';
    const cmd = r.command ? `\`${r.command.join(' ')}\` → ` : '';
    // Sanitised for a markdown table cell: a newline or a pipe from captured output would tear
    // the table apart, and a torn table is a table a reader — or a gate — misreads.
    // Defensive, after this generator emitted "undefined" for the judged rows on its first real
    // run: a row whose evidence is empty, or the literal stringification of nothing, says
    // nothing. It becomes a BLOCK rather than being written out as though it were evidence,
    // because a meaningless cell that a downstream gate accepts is worse than no cell at all.
    const rawEvidence = `${cmd}${r.why ?? ''}`.trim();
    if (rawEvidence === '' || /^(undefined|null|NaN)$/i.test(rawEvidence)) {
      fail(
        `${dim.key}: produced no usable evidence text (got ${JSON.stringify(rawEvidence)}). This gate will not write a row that says nothing — a downstream gate would read it as satisfied.`,
      );
      lines.push(
        `| ${dim.row} | BLOCKED | this gate produced no evidence text for this dimension |`,
      );
      continue;
    }
    // WHERE it ran, when that is not the project root. The directory was checked on the way in
    // and then omitted from the output, so a reader of the table could not tell a check of this
    // project from a check of somewhere else. Both halves were needed: confine it, and say so.
    const where = r.cwd && r.cwd !== rootAbs ? `[in ${path.relative(rootAbs, r.cwd) || '.'}] ` : '';
    const evidence = `${where}${rawEvidence}`
      .replace(/\r?\n/g, ' ')
      .replace(/\|/g, '¦')
      .slice(0, 300);
    lines.push(`| ${dim.row} | ${status} | ${evidence} |`);
  }
  lines.push('');
  try {
    fs.writeFileSync(path.join(devMemory, 'QUALITY-GATE.md'), `${lines.join('\n')}\n`, 'utf8');
  } catch (e) {
    fail(`could not write Dev-Memory/QUALITY-GATE.md — ${formatFsError(e)}`);
  }
}

// ---- report -------------------------------------------------------------------------------
const summary = {
  executed: results.filter((r) => r.kind === 'executed' && r.verdict !== 'n/a').length,
  passed: results.filter((r) => r.verdict === 'pass').length,
  notApplicable: results.filter((r) => r.verdict === 'n/a').length,
};

if (problems.length === 0) {
  console.log(
    JSON.stringify(
      {
        status: 'clean',
        reason: 'every required dimension was proven by execution, or marked n/a with a reason',
        ...summary,
        evidence: path.relative(root, evidenceDir),
        root,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
console.log(
  JSON.stringify(
    { status: 'BLOCKED', reason: 'Definition of Done not met', problems, ...summary, root },
    null,
    2,
  ),
);
process.exit(1);
