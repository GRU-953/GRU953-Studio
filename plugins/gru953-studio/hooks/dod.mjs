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
  const cwd = path.resolve(root, typeof spec.cwd === 'string' ? spec.cwd : '.');
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
function checkCoverageFloor(spec, res) {
  const floor = spec.minPercent;
  if (typeof floor !== 'number' || !(floor >= 0 && floor <= 100)) {
    fail(
      'coverage: `minPercent` must be a number between 0 and 100. Without a stated floor this dimension measures nothing — a run at 3% would pass',
    );
    return res;
  }
  if (typeof spec.reportPath !== 'string' || spec.reportPath === '') {
    fail(
      "coverage: `reportPath` must name the coverage tool's machine-readable report. The percentage is never scraped from stdout — prose is not a measurement",
    );
    return res;
  }
  const rp = path.resolve(root, spec.reportPath);
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
    const res = {
      dimension: dim.key,
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
    const evidence = rawEvidence.replace(/\r?\n/g, ' ').replace(/\|/g, '¦').slice(0, 300);
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
