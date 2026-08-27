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
// Resolved separately: `root` is echoed back verbatim so a caller sees the path it passed, but a
// containment test has to be made on the absolute, normalised form. A prefix test against '.'
// admits every relative path there is.
const rootAbs = path.resolve(root);
const problems = [];
const fail = (msg) => problems.push(msg);

const SCHEMA_VERSION = 1;
const STATES = new Set([
  'todo',
  'in-progress',
  'done',
  'blocked-on-defect',
  'blocked-on-human',
  // 2026-08-27. The three CONTROL states the command-centre skill defines for /studio-pause,
  // /studio-skip and /studio-schedule. They were missing here, so this ledger would have refused
  // a project the shipped commands had legitimately put into one of them — the gate contradicting
  // the product. None can arise in a headless run, since each requires a person to ask for it;
  // they are accepted because the interactive commands still ship, and a gate that understands
  // only half the product is worse than one that understands all of it.
  //
  // Deliberately NOT blocked states. The command-centre's own words: these rows are "consciously
  // not-active, never `blocked`". So they need no blockedReason — nothing is wrong — and they are
  // not runnable either, because a person set them aside on purpose and a run that picked them up
  // again would be overriding that.
  'paused',
  'skipped',
  'scheduled',
]);
const BLOCKED = new Set(['blocked-on-defect', 'blocked-on-human']);
const SET_ASIDE = new Set(['paused', 'skipped', 'scheduled']);

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

// ---- the fix-loop attempt cap ----------------------------------------------------------------
// `self-healing/SKILL.md` allows two quiet fix attempts and then invokes the terminal Stuck
// Protocol. That is a cap, but it is enforced by an agent remembering to count — and an agent
// asked to keep trying is exactly the wrong party to hold the counter. Here the cap is data: a
// task records its `attempts`, and a task still marked runnable after spending them is a fix
// loop that did not terminate, which this gate refuses. Three is the default because it is
// where the two independent peer implementations of a bounded retry both landed; a project may
// state its own in `Dev-Memory/run.json`.
let maxAttempts = 3;
{
  const runRaw = readOrBlock(path.join(devMemory, 'run.json'));
  if (runRaw !== MISSING) {
    let cfg = null;
    try {
      cfg = JSON.parse(runRaw);
    } catch (e) {
      out(
        {
          status: 'BLOCKED',
          problems: [`Dev-Memory/run.json is not valid JSON (${e.message})`],
          root,
        },
        1,
      );
    }
    // `run.json` is documented as schema-versioned, and session-cost.mjs refuses a version it
    // does not understand. This reader ignored the field entirely, so the same file was strict
    // for one consumer and unchecked for the other — and a v2 run.json would have had its
    // maxAttemptsPerTask read under v1 assumptions by whichever gate did not care. Added
    // 2026-08-27; absent is still fine, because the file itself is optional.
    if (cfg && cfg.schemaVersion !== undefined && cfg.schemaVersion !== SCHEMA_VERSION) {
      out(
        {
          status: 'BLOCKED',
          problems: [
            `Dev-Memory/run.json declares schemaVersion ${JSON.stringify(cfg.schemaVersion)}, and this gate understands ${SCHEMA_VERSION}. It refuses rather than reading a run's limits under assumptions that may no longer hold.`,
          ],
          root,
        },
        1,
      );
    }
    if (cfg && cfg.maxAttemptsPerTask !== undefined) {
      if (!Number.isInteger(cfg.maxAttemptsPerTask) || cfg.maxAttemptsPerTask < 1) {
        out(
          {
            status: 'BLOCKED',
            problems: [
              `Dev-Memory/run.json declares maxAttemptsPerTask ${JSON.stringify(cfg.maxAttemptsPerTask)}, which is not a whole number of 1 or more. A cap that cannot be compared against is not a cap.`,
            ],
            root,
          },
          1,
        );
      }
      maxAttempts = cfg.maxAttemptsPerTask;
    }

    // `interactive` — whether a person is at the keyboard (added 2026-08-28). Eleven clauses in
    // the product say a thing happens "only when a person is present and has asked to be
    // consulted", and until now that predicate was asked nowhere, recorded nowhere and checkable
    // nowhere, so every one of them was decided by guess. Absent means FALSE, deliberately: an
    // absent field must never mean "wait for someone", because waiting is what ends an unattended
    // run. Validated rather than merely documented, so a typo is a caught error and not a silent
    // reversion to interactive behaviour.
    if (cfg && cfg.interactive !== undefined && typeof cfg.interactive !== 'boolean') {
      problems.push(
        `Dev-Memory/run.json declares interactive ${JSON.stringify(cfg.interactive)}, which is not true or false. Anything other than a boolean cannot be relied on to mean "nobody is here", and the whole point of the field is that its absence and its falsehood are both safe.`,
      );
    }
  }
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
  // THE ID MUST BE TRACEABLE, and that is a shape, not a preference.
  //
  // 2026-08-27 (pass 2). `hooks/traceability-check.mjs` finds task ids with
  // TASK_ID_RE = /\b[A-Za-z]{1,4}-?\d+.../ — letters then digits. This gate accepted ANY
  // non-empty string, and `skills/micro-task-planning/SKILL.md` gave the format only as an
  // example ("e.g. `T1`, `T2`"). So a perfectly sensible descriptive id like `add-expense-form`
  // was written happily here, and then traceability-check reported the requirement it satisfies
  // as "maps to no task and is not marked deferred" — a fabricated block on an honest project,
  // with a message pointing at the wrong thing entirely.
  //
  // Caught here instead, where the id is written, with the reason named. Three files stating three
  // different contracts for one field is the defect; this is the one that can say so early.
  if (!/^[A-Za-z]{1,4}-?\d+(?:[.-]\d+)?$/.test(id)) {
    fail(
      `${where}: id ${JSON.stringify(id)} is not a traceable task id. It must be a short letter prefix followed by a number — \`T1\`, \`T12\`, \`API-3\`, \`T2.1\` — because hooks/traceability-check.mjs matches requirements to tasks by exactly that shape. A descriptive id is written happily by this gate and then reported by that one as a requirement mapping to NO task, which reads as a dropped requirement rather than as a naming problem.`,
    );
    continue;
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

  // The attempt cap, enforced rather than trusted. A task that has spent its attempts and is
  // still marked runnable means the fix loop kept going past its own ceiling — the failure mode
  // where an unattended run burns a whole budget on one task. It must be parked as
  // blocked-on-defect (or finished), and saying so is what makes the loop terminate.
  const attempts = t.attempts === undefined ? 0 : t.attempts;
  if (!Number.isInteger(attempts) || attempts < 0) {
    fail(`${id}: attempts ${JSON.stringify(t.attempts)} must be a whole number of 0 or more`);
  } else if (attempts >= maxAttempts && (state === 'todo' || state === 'in-progress')) {
    fail(
      `${id}: has spent ${attempts} of ${maxAttempts} permitted attempts and is still marked ${state}. A fix loop past its cap has not terminated — park it as blocked-on-defect with what was tried, so the run moves on to work it can finish instead of spending the rest of the budget here.`,
    );
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
      // 2026-08-27. `command`, `exitCode` and `at` were three unvalidated values: any non-empty
      // string was a command, and any non-empty string was a date. So "ran the tests" and
      // "2019-13-45" both satisfied a claim that something had been run and had passed. The
      // whole point of this evidence is that a reader can RE-RUN it and get the same answer, and
      // none of that was checkable.
      //
      // An argv ARRAY, matching dod.mjs, for the same reason dod.mjs uses one: a string has to
      // reach a shell to run, and this record is data. It also removes the ambiguity that made
      // the old field useless — `npm test` and `npm "test"` and `npm test # in ../other` are all
      // valid strings and only one of them is a command.
      if (
        !Array.isArray(ev.command) ||
        ev.command.length === 0 ||
        !ev.command.every((a) => typeof a === 'string' && a.trim() !== '')
      ) {
        fail(
          `${id}: evidence.command must be a non-empty argv array of strings (e.g. ["npm","test"]), so this claim can actually be re-run. Got ${JSON.stringify(ev.command)}`,
        );
      }
      if (ev.exitCode !== 0) {
        fail(
          `${id}: marked done but its evidence records exitCode ${JSON.stringify(ev.exitCode)}. Only exit 0 is a pass`,
        );
      }
      // WHERE it ran. A command that passed in a different directory proves something about that
      // directory. Optional, defaulting to the project root, but if stated it must stay inside
      // it — the same containment dod.mjs applies to its own cwd.
      if (ev.cwd !== undefined) {
        if (typeof ev.cwd !== 'string' || ev.cwd.trim() === '') {
          fail(`${id}: evidence.cwd, when present, must be a path relative to the project root`);
        } else {
          const abs = path.resolve(rootAbs, ev.cwd);
          if (!(abs === rootAbs || abs.startsWith(rootAbs + path.sep))) {
            fail(
              `${id}: evidence.cwd resolves to ${abs}, outside the project root ${rootAbs}. A command that passed somewhere else did not pass here`,
            );
          }
        }
      }
      // A timestamp that is not a date cannot distinguish this run from an older one, which is
      // the only thing the field is for.
      if (typeof ev.at !== 'string' || ev.at.trim() === '') {
        fail(
          `${id}: evidence has no timestamp, so it cannot be told from an older run of the same command`,
        );
      } else if (!Number.isFinite(Date.parse(ev.at))) {
        fail(
          `${id}: evidence.at is ${JSON.stringify(ev.at)}, which is not a date this gate can read. Use an ISO 8601 timestamp (e.g. 2026-08-27T09:15:00Z) — an unreadable date is the same as none`,
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
const setAside = all.filter((t) => SET_ASIDE.has(t.state));

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
        `verified: \`${Array.isArray(t.evidence.command) ? t.evidence.command.join(' ') : t.evidence.command}\` -> exit ${t.evidence.exitCode} (${t.evidence.at})`,
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
  maxAttemptsPerTask: maxAttempts,
  atAttemptCap: all.filter((t) => (t.attempts || 0) >= maxAttempts).map((t) => t.id),
  runnable: runnable.map((t) => t.id),
  waitingOnDependency: waiting.map((t) => t.id),
  parkedOnDefect: blockedDefect.map((t) => t.id),
  needingAPerson: blockedHuman.map((t) => t.id),
  setAsideByAPerson: setAside.map((t) => `${t.id} (${t.state})`),
};

// AN EMPTY LEDGER IS NOT A FINISHED ONE. 2026-08-27 (pass 2): `{"schemaVersion":1,"tasks":[]}`
// reported `{"status":"clean","reason":"every task is done and backed by recorded evidence"}` and
// exit 0 — because zero tasks are trivially all done. The one file that is supposed to prove work
// happened certified that it had, over nothing. Vacuous truth is the commonest way a gate reports
// safety it never measured, and this is a textbook instance.
if (all.length === 0) {
  out(
    {
      status: 'BLOCKED',
      reason:
        'Dev-Memory/tasks.json declares no tasks at all. An empty ledger is not a finished one: zero tasks are trivially "all done", which is how this gate used to report a project complete having measured nothing. If the plan genuinely has no tasks, there is nothing for this run to have built.',
      next: null,
      canContinue: false,
      ...summary,
      root,
    },
    1,
  );
}

if (all.length === done.length) {
  out(
    {
      status: 'clean',
      reason: 'every task is done and backed by recorded evidence',
      // Stated explicitly rather than left absent. Four shipped commands were rewritten on
      // 2026-08-27 to read this gate's `next` field instead of re-deriving the next task from
      // the rendered table — and on the one run that matters most, the finished one, the field
      // simply was not there. "Absent" is not an answer a caller can act on; "null, because
      // everything is done" is.
      next: null,
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
if (setAside.length > 0) {
  why.push(
    `${setAside.length} task(s) were set aside by a person and are not picked up automatically: ${setAside.map((t) => `${t.id} (${t.state})`).join('; ')}`,
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
