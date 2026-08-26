#!/usr/bin/env node
//
// task-ledger.mjs — the task list as DATA, and the answer to "can this run continue?"
//
// TWO PROBLEMS THIS SOLVES, both of which stop an unattended build.
//
// 1. ONE FAILURE ENDS THE RUN. `commands/studio-start.md:29` states the rule as it stands: "A
//    task marked 'blocked' is never picked as next until a human unblocks it." With somebody at
//    the keyboard that is correct and kind — it stops the studio thrashing. With nobody there,
//    the first hard failure ends the build permanently, however much independent work remains.
//    `self-healing/SKILL.md` allows two quiet fix attempts and then invokes the Stuck Protocol,
//    which is terminal. So the product has no middle: it either retries twice or stops forever.
//
//    The fix is to stop treating "blocked" as one state. A task blocked on a DEFECT is parked —
//    the run carries on with anything whose dependencies are satisfied, and comes back to it. A
//    task blocked on a HUMAN DECISION genuinely cannot proceed, and the run reports that. Only
//    when nothing at all is runnable does the run stop, and then it says which of the two
//    reasons applies. That distinction is the whole difference between an unattended build that
//    finishes what it can and one that dies on task three of forty.
//
// 2. THE LEDGER WAS PROSE. Task state lived in a markdown table in `PROGRESS.md`, and this
//    repository carries eight separate reproductions for failures of reading it — a torn table
//    (X142), a pipe-less table (X141), a row judged as a whole (X144), a mistyped table (X122),
//    miskeyed evidence (X146), a path with a space in it (X147), ragged headers (X192/X193), a
//    shared-reader drift (X138). Every one of those is the same underlying mistake: using a
//    human presentation format as a data structure, then discovering that humans write it
//    eleven different ways. So in v7 the authoritative ledger is `Dev-Memory/tasks.json`, and
//    `PROGRESS.md` is RENDERED from it — the same direction of travel as `hooks/dod.mjs` and
//    `QUALITY-GATE.md`. A rendered file cannot be torn, because nothing parses it back.
//
// The schema is checked from this first release, for the reason dod.mjs records: a 7.0.0 gate
// meeting a 6.1.0 project must be able to tell "older format" from "damaged".
//
// Usage: node task-ledger.mjs [projectRoot]
// Exit 0 = the ledger is valid AND the run can continue (or everything is done).
// Exit 1 = the ledger is invalid, or a `done` task is not backed by evidence.
// Exit 2 = the ledger is valid but NOTHING is runnable while work remains — the run needs a
//          person. Distinct from 1 on purpose: 1 means "this file is wrong", 2 means "this file
//          is right and it says I am stuck", and an unattended caller must be able to tell those
//          apart without reading prose. (The same convention as a watchdog's attention signal.)

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  classifyStudioRoot,
  readOrBlock,
  MISSING,
  CONTRADICTION_RE,
  formatFsError,
} from './lib.mjs';

const root = process.argv[2] || process.cwd();
const problems = [];
const fail = (msg) => problems.push(msg);

const SCHEMA_VERSION = 1;
const STATES = new Set(['todo', 'in-progress', 'done', 'blocked-on-defect', 'blocked-on-human']);
const BLOCKED = new Set(['blocked-on-defect', 'blocked-on-human']);

function out(obj, code) {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(code);
}

// ---- the root ------------------------------------------------------------------------------
const kind = classifyStudioRoot(root);
if (kind.kind === 'unreadable') out({ status: 'BLOCKED', problems: [kind.why], root }, 1);
if (kind.kind === 'not-studio') {
  out(
    {
      status: 'not a studio project',
      reason: 'no Dev-Memory/ directory — no task ledger to read',
      root,
    },
    0,
  );
}
const devMemory = kind.devMemory;

// ---- the ledger ----------------------------------------------------------------------------
const ledgerPath = path.join(devMemory, 'tasks.json');
const raw = readOrBlock(ledgerPath);
if (raw === MISSING) {
  out(
    {
      status: 'BLOCKED',
      problems: [
        'Dev-Memory/tasks.json is missing. In v7 the task ledger is data, not a markdown table — PROGRESS.md is rendered from it. Without the ledger there is no way to say which task is next, which are parked on a defect, and which need a person, so an unattended run cannot decide anything.',
      ],
      root,
    },
    1,
  );
}

let ledger;
try {
  ledger = JSON.parse(raw);
} catch (e) {
  out(
    {
      status: 'BLOCKED',
      problems: [`Dev-Memory/tasks.json is not valid JSON (${e.message})`],
      root,
    },
    1,
  );
}

if (ledger.schemaVersion !== SCHEMA_VERSION) {
  out(
    {
      status: 'BLOCKED',
      problems: [
        `Dev-Memory/tasks.json declares schemaVersion ${JSON.stringify(ledger.schemaVersion)}, and this gate understands ${SCHEMA_VERSION}. It refuses rather than guessing: a ledger in an unknown shape might mean every task is done or that none was ever started.`,
      ],
      root,
    },
    1,
  );
}

const tasks = Array.isArray(ledger.tasks) ? ledger.tasks : null;
if (!tasks) {
  out({ status: 'BLOCKED', problems: ['Dev-Memory/tasks.json has no `tasks` array'], root }, 1);
}

// ---- validate --------------------------------------------------------------------------------
const byId = new Map();
for (const [i, t] of tasks.entries()) {
  const where = `tasks[${i}]`;
  if (!t || typeof t !== 'object' || Array.isArray(t)) {
    fail(`${where} is not an object`);
    continue;
  }
  const id = typeof t.id === 'string' ? t.id.trim() : '';
  if (id === '') {
    fail(`${where} has no id — a task that cannot be named cannot be depended on or resumed`);
    continue;
  }
  if (byId.has(id)) {
    fail(
      `duplicate task id ${JSON.stringify(id)} — two rows claiming one identity means a dependency on it is ambiguous`,
    );
    continue;
  }
  if (typeof t.title !== 'string' || t.title.trim() === '') {
    fail(`${id}: no title`);
  }
  const state = typeof t.state === 'string' ? t.state.trim() : '';
  if (!STATES.has(state)) {
    fail(
      `${id}: state ${JSON.stringify(t.state)} is not one of ${[...STATES].join(', ')}. Note there is no bare "blocked": a run has to know whether it may carry on without this task (blocked-on-defect) or genuinely cannot proceed (blocked-on-human), and one word cannot say both.`,
    );
  }
  if (
    BLOCKED.has(state) &&
    (typeof t.blockedReason !== 'string' || t.blockedReason.trim() === '')
  ) {
    fail(
      `${id}: state is ${state} but no blockedReason is recorded. A block with no stated reason cannot be reviewed, escalated, or cleared`,
    );
  }
  if (t.dependsOn !== undefined && !Array.isArray(t.dependsOn)) {
    fail(`${id}: dependsOn must be an array of task ids`);
  }

  // `done` must be backed by a real recorded execution — the same rule dod.mjs applies to a
  // dimension, applied to a task. An exit code and a command, not a sentence.
  if (state === 'done') {
    const ev = t.evidence;
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
      fail(
        `${id}: marked done with no evidence object. A task is done when something was run and passed, not when it is described as finished`,
      );
    } else {
      if (typeof ev.command !== 'string' || ev.command.trim() === '') {
        fail(`${id}: evidence has no command — there is nothing to re-run to check this claim`);
      }
      if (ev.exitCode !== 0) {
        fail(
          `${id}: marked done but its evidence records exitCode ${JSON.stringify(ev.exitCode)}. Only exit 0 is a pass`,
        );
      }
      if (typeof ev.at !== 'string' || ev.at.trim() === '') {
        fail(
          `${id}: evidence has no timestamp, so it cannot be told from an older run of the same command`,
        );
      }
    }
    // The same contradiction rule the Definition of Done uses: a row cannot be marked passing
    // while its own note says it is failing.
    const note = typeof t.note === 'string' ? t.note : '';
    if (note && CONTRADICTION_RE.test(note)) {
      fail(
        `${id}: marked done but its own note says otherwise → ${JSON.stringify(note.slice(0, 120))}`,
      );
    }
  }

  byId.set(id, { ...t, id, state });
}

// Dependencies must exist, and must not form a cycle. A cycle is not a stall to report at run
// time — it is a ledger that can never complete, so it is an invalid ledger.
for (const [id, t] of byId) {
  for (const dep of t.dependsOn || []) {
    if (!byId.has(dep)) {
      fail(`${id}: depends on ${JSON.stringify(dep)}, which is not a task in this ledger`);
    }
  }
}
{
  const WHITE = 0,
    GREY = 1,
    BLACK = 2;
  const colour = new Map([...byId.keys()].map((k) => [k, WHITE]));
  const stack = [];
  let cycle = null;
  const visit = (id) => {
    if (cycle) return;
    colour.set(id, GREY);
    stack.push(id);
    for (const dep of byId.get(id).dependsOn || []) {
      if (!byId.has(dep)) continue;
      if (colour.get(dep) === GREY) {
        cycle = [...stack.slice(stack.indexOf(dep)), dep];
        return;
      }
      if (colour.get(dep) === WHITE) visit(dep);
      if (cycle) return;
    }
    stack.pop();
    colour.set(id, BLACK);
  };
  for (const id of byId.keys()) if (colour.get(id) === WHITE) visit(id);
  if (cycle) {
    fail(
      `dependency cycle: ${cycle.join(' -> ')}. No task in that loop can ever become runnable, so this ledger can never complete`,
    );
  }
}

if (problems.length > 0) {
  out({ status: 'BLOCKED', reason: 'the task ledger is not valid', problems, root }, 1);
}

// ---- what can the run do next? ---------------------------------------------------------------
const depsSatisfied = (t) =>
  (t.dependsOn || []).every((d) => byId.get(d) && byId.get(d).state === 'done');
const all = [...byId.values()];
const done = all.filter((t) => t.state === 'done');
const blockedHuman = all.filter((t) => t.state === 'blocked-on-human');
const blockedDefect = all.filter((t) => t.state === 'blocked-on-defect');
const runnable = all.filter(
  (t) => (t.state === 'todo' || t.state === 'in-progress') && depsSatisfied(t),
);
const waiting = all.filter(
  (t) => (t.state === 'todo' || t.state === 'in-progress') && !depsSatisfied(t),
);

// ---- render PROGRESS.md from the ledger ------------------------------------------------------
{
  const next = runnable[0] || null;
  const lines = [
    `# Progress${ledger.project ? ` — ${ledger.project}` : ''}`,
    '',
    '<!-- GENERATED by hooks/task-ledger.mjs from Dev-Memory/tasks.json. Do not edit by hand:',
    '     the ledger is the data, this file is a view of it, and hand edits are overwritten.',
    '     Editing this file was how eight separate table-parsing defects arrived (X122, X138,',
    '     X141, X142, X144, X146, X147, X192/X193). -->',
    '',
    `Done ${done.length} of ${all.length}. ${runnable.length} runnable, ${waiting.length} waiting on a dependency, ${blockedDefect.length} parked on a defect, ${blockedHuman.length} needing a person.`,
    '',
    '| ID | Task | Status | Notes |',
    '| :-- | :-- | :-- | :-- |',
  ];
  for (const t of all) {
    const notes = [];
    if (t.state === 'done' && t.evidence) {
      notes.push(
        `verified: \`${t.evidence.command}\` -> exit ${t.evidence.exitCode} (${t.evidence.at})`,
      );
    }
    if (BLOCKED.has(t.state)) notes.push(t.blockedReason);
    if (t.note) notes.push(t.note);
    if (next && t.id === next.id) notes.push('▶ RESUME HERE');
    if ((t.dependsOn || []).length) notes.push(`depends on ${t.dependsOn.join(', ')}`);
    const cell = (notes.join(' · ') || '—').replace(/\r?\n/g, ' ').replace(/\|/g, '¦');
    lines.push(`| ${t.id} | ${String(t.title).replace(/\|/g, '¦')} | ${t.state} | ${cell} |`);
  }
  lines.push('');
  try {
    fs.writeFileSync(path.join(devMemory, 'PROGRESS.md'), `${lines.join('\n')}\n`, 'utf8');
  } catch (e) {
    out(
      {
        status: 'BLOCKED',
        problems: [`could not render Dev-Memory/PROGRESS.md — ${formatFsError(e)}`],
        root,
      },
      1,
    );
  }
}

// ---- the verdict an unattended run acts on ----------------------------------------------------
const summary = {
  total: all.length,
  done: done.length,
  runnable: runnable.map((t) => t.id),
  waitingOnDependency: waiting.map((t) => t.id),
  parkedOnDefect: blockedDefect.map((t) => t.id),
  needingAPerson: blockedHuman.map((t) => t.id),
};

if (all.length === done.length) {
  out(
    {
      status: 'clean',
      reason: 'every task is done and backed by recorded evidence',
      canContinue: false,
      ...summary,
      root,
    },
    0,
  );
}

if (runnable.length > 0) {
  out(
    {
      status: 'clean',
      reason: `the run can continue — ${runnable.length} task(s) are runnable now`,
      canContinue: true,
      next: runnable[0].id,
      ...summary,
      root,
    },
    0,
  );
}

// Nothing runnable, and work remains. Say WHICH kind of stuck this is, because the two need
// different things: a defect needs another attempt or a different approach, a human decision
// needs a person. A run that cannot tell them apart can only ever stop.
const why = [];
if (blockedHuman.length > 0) {
  why.push(
    `${blockedHuman.length} task(s) need a person: ${blockedHuman.map((t) => `${t.id} (${t.blockedReason})`).join('; ')}`,
  );
}
if (blockedDefect.length > 0) {
  why.push(
    `${blockedDefect.length} task(s) are parked on a defect with nothing else runnable, so the defect now has to be faced rather than worked around: ${blockedDefect.map((t) => `${t.id} (${t.blockedReason})`).join('; ')}`,
  );
}
if (waiting.length > 0) {
  why.push(
    `${waiting.length} task(s) are waiting on a dependency that is neither done nor runnable: ${waiting.map((t) => `${t.id} (needs ${(t.dependsOn || []).filter((d) => byId.get(d).state !== 'done').join(', ')})`).join('; ')}`,
  );
}
out(
  {
    status: 'needs attention',
    reason: 'nothing is runnable while work remains',
    canContinue: false,
    why,
    ...summary,
    root,
  },
  2,
);
