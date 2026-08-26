#!/usr/bin/env node
//
// run-brief.mjs — is this brief complete enough to build from without asking anything else?
//
// THE DECISION THIS SERVES. The owner's choice for v7 is "one interview, then silent": the
// existing expert-panel pop-up interview runs once at kick-off, and the build then proceeds with
// no further human input. That only works if the interview's answers are written down in a form
// the build can actually consult — and if something checks, BEFORE the run starts, that nothing
// the build will need is missing. Otherwise "headless" means "runs until it hits the first
// question, then stops", which is what happens today.
//
// So this gate is the front door's contract. It is deliberately run BEFORE a build, when a
// person is still present and a gap costs one more question rather than an abandoned run.
//
// WHY JSON AND NOT `OBJECTIVE.md`. The interview's output today is "a confirmed one-page brief
// (Dev-Memory/OBJECTIVE.md)" — prose. `studio/SKILL.md` has already had to carve one machine
// -readable island out of it: the Tier "must be recorded as one exact, on-disk line", because a
// script needed to read it and prose could not be trusted to yield it. That is the shape of the
// whole problem. So in v7 the brief is data, and prose is rendered from it, exactly as
// `tasks.json` -> `PROGRESS.md` and `dod.json` -> `QUALITY-GATE.md`.
//
// THE CHECK THAT EARNS THIS FILE'S EXISTENCE. `studio/SKILL.md` documents the Tier as the result
// of three specific questions under a stated mapping — "Assigned once the brief is confirmed via
// a checkable rule, not a vibe", after a 2026-07-10 audit fix found almost any request rounding
// up to Standard by default. Because the rule is written down, the Tier can be RE-DERIVED from
// the three recorded answers and compared with the Tier actually assigned. A mis-tiered project
// is then a caught error rather than a silent one, and the audit fix that made the rule checkable
// finally has something doing the checking.
//
// Usage: node run-brief.mjs [projectRoot]
// Exit 0 = the brief is complete and internally consistent; a build can proceed unattended.
// Exit 1 = something a build would have to ask about is missing, or the brief contradicts itself.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
  classifyStudioRoot,
  readOrBlock,
  MISSING,
  isPlaceholderEvidence,
  deEmphasise,
  formatFsError,
} from './lib.mjs';

const root = process.argv[2] || process.cwd();
const problems = [];
const fail = (msg) => problems.push(msg);
const SCHEMA_VERSION = 1;

function out(obj, code) {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(code);
}

const kind = classifyStudioRoot(root);
if (kind.kind === 'unreadable') out({ status: 'BLOCKED', problems: [kind.why], root }, 1);
if (kind.kind === 'not-studio') {
  out(
    {
      status: 'not a studio project',
      reason: 'no Dev-Memory/ directory — no brief to check',
      root,
    },
    0,
  );
}
const devMemory = kind.devMemory;

const raw = readOrBlock(path.join(devMemory, 'run-brief.json'));
if (raw === MISSING) {
  out(
    {
      status: 'BLOCKED',
      problems: [
        "Dev-Memory/run-brief.json is missing. An unattended build needs the kick-off interview's answers written down where it can read them; without the brief the run would proceed on assumptions and then stop at the first question. Run the interview first.",
      ],
      root,
    },
    1,
  );
}

let brief;
try {
  brief = JSON.parse(raw);
} catch (e) {
  out(
    {
      status: 'BLOCKED',
      problems: [`Dev-Memory/run-brief.json is not valid JSON (${e.message})`],
      root,
    },
    1,
  );
}

if (brief.schemaVersion !== SCHEMA_VERSION) {
  out(
    {
      status: 'BLOCKED',
      problems: [
        `Dev-Memory/run-brief.json declares schemaVersion ${JSON.stringify(brief.schemaVersion)}, and this gate understands ${SCHEMA_VERSION}. It refuses rather than guessing which fields mean what.`,
      ],
      root,
    },
    1,
  );
}

// ---- the fields a build cannot proceed without ------------------------------------------------
const realText = (v) =>
  typeof v === 'string' && v.trim() !== '' && !isPlaceholderEvidence(deEmphasise(v).trim());

if (!realText(brief.idea)) {
  fail(
    '`idea` is missing, empty, or a placeholder. This is the one thing the whole run is derived from',
  );
}

// `nonGoals` must be PRESENT even when empty. The no-silent-omission rule the quality gate
// already applies to its dimensions: an absent field cannot be told from a considered "nothing
// is out of scope", and the second is a claim somebody should have to make on purpose. It is
// also what makes scope creep detectable later rather than arguable.
if (!Array.isArray(brief.nonGoals)) {
  fail(
    '`nonGoals` must be an array, present even if empty. An absent field cannot be distinguished from a deliberate "nothing is out of scope", and without it there is nothing to check scope creep against',
  );
}

if (!Array.isArray(brief.mustHave) || brief.mustHave.length === 0) {
  fail(
    '`mustHave` must be a non-empty array — a build with no stated requirement has no definition of finished',
  );
} else {
  for (const [i, m] of brief.mustHave.entries()) {
    if (!realText(m)) fail(`mustHave[${i}] is empty or a placeholder`);
  }
}

if (!realText(brief.targetPlatform)) {
  fail(
    '`targetPlatform` is missing. studio/SKILL.md requires the confirmed target platform to be recorded, and an unattended run cannot pick one for you without guessing at the whole shape of the software',
  );
}

// `stack` may be an explicit choice OR an explicit delegation. What it may not be is absent,
// because then the run has to decide silently and nobody knows a decision was made.
if (!realText(brief.stack)) {
  fail(
    '`stack` is missing. Record either a chosen technology or the exact string "studio-chooses" — an absent value means the run decides for you without recording that it did',
  );
}

// ---- the Tier, re-derived from its own recorded answers ---------------------------------------
// Mapping quoted from studio/SKILL.md: all No -> Tiny; any one Yes -> Standard; money/personal
// data Yes, or 2+ integrations -> Complex.
const TIERS = new Set(['Tiny', 'Standard', 'Complex']);
const t = brief.tier;
let derived = null;
if (!t || typeof t !== 'object' || Array.isArray(t)) {
  fail('`tier` must be an object carrying `assigned` plus the three answers it was derived from');
} else {
  if (!TIERS.has(t.assigned)) {
    fail(
      `tier.assigned is ${JSON.stringify(t.assigned)} — it must be exactly one of Tiny, Standard, Complex`,
    );
  }
  const a = t.answers;
  if (!a || typeof a !== 'object' || Array.isArray(a)) {
    fail(
      '`tier.answers` is missing. studio/SKILL.md requires the three answers to be recorded "so it\'s auditable later, not just asserted" — and without them the assigned Tier cannot be checked against the rule that is supposed to produce it',
    );
  } else {
    const bool = (k) => (typeof a[k] === 'boolean' ? a[k] : null);
    const remembersUsers = bool('remembersUsers');
    const handlesSensitiveData = bool('handlesSensitiveData');
    const integrations =
      Number.isInteger(a.integrations) && a.integrations >= 0 ? a.integrations : null;
    if (remembersUsers === null) fail('tier.answers.remembersUsers must be true or false (Q1)');
    if (handlesSensitiveData === null)
      fail('tier.answers.handlesSensitiveData must be true or false (Q2)');
    if (integrations === null)
      fail('tier.answers.integrations must be a whole number of 0 or more (Q3)');

    if (remembersUsers !== null && handlesSensitiveData !== null && integrations !== null) {
      if (handlesSensitiveData || integrations >= 2) derived = 'Complex';
      else if (remembersUsers || integrations === 1) derived = 'Standard';
      else derived = 'Tiny';

      if (TIERS.has(t.assigned) && derived !== t.assigned) {
        fail(
          `tier.assigned is ${t.assigned}, but the three recorded answers produce ${derived} under the mapping in studio/SKILL.md (remembersUsers=${remembersUsers}, handlesSensitiveData=${handlesSensitiveData}, integrations=${integrations}). That mapping exists because a 2026-07-10 audit found almost any request rounding up to Standard by default; a Tier that does not follow from its own answers is exactly what it was made checkable to prevent.`,
        );
      }
    }
  }
}

// ---- provenance ------------------------------------------------------------------------------
if (!realText(brief.answeredAt)) {
  fail(
    '`answeredAt` is missing — a brief with no date cannot be told from a stale one carried over from another project',
  );
}

if (problems.length > 0) {
  out(
    {
      status: 'BLOCKED',
      reason: 'this brief is not complete enough to build from unattended',
      problems,
      note: 'Every item above is something the run would otherwise have had to ask a person about, or a contradiction inside the brief itself. Fixing them now costs one more question; not fixing them costs an abandoned run.',
      root,
    },
    1,
  );
}

// ---- render the human-readable brief ---------------------------------------------------------
{
  const lines = [
    `# Objective${brief.project ? ` — ${brief.project}` : ''}`,
    '',
    '<!-- GENERATED by hooks/run-brief.mjs from Dev-Memory/run-brief.json. Do not edit by hand. -->',
    '',
    '## The idea',
    '',
    brief.idea.trim(),
    '',
    `**Tier:** ${brief.tier.assigned}`,
    '',
    `Derived from: remembers users between visits — ${brief.tier.answers.remembersUsers ? 'yes' : 'no'}; handles money, passwords or personal information — ${brief.tier.answers.handlesSensitiveData ? 'yes' : 'no'}; connects to other services — ${brief.tier.answers.integrations}.`,
    '',
    `**Target platform:** ${brief.targetPlatform}`,
    `**Stack:** ${brief.stack}`,
    '',
    '## Must have',
    '',
    ...brief.mustHave.map((m) => `- ${m}`),
    '',
    '## Not doing (agreed at kick-off)',
    '',
    ...(brief.nonGoals.length
      ? brief.nonGoals.map((m) => `- ${m}`)
      : ['- Nothing was ruled out at kick-off.']),
    '',
    `Brief confirmed ${brief.answeredAt}${brief.answeredBy ? ` by ${brief.answeredBy}` : ''}.`,
    '',
  ];
  try {
    fs.writeFileSync(path.join(devMemory, 'OBJECTIVE.md'), `${lines.join('\n')}\n`, 'utf8');
  } catch (e) {
    out(
      {
        status: 'BLOCKED',
        problems: [`could not render Dev-Memory/OBJECTIVE.md — ${formatFsError(e)}`],
        root,
      },
      1,
    );
  }
}

out(
  {
    status: 'clean',
    reason:
      'the brief is complete and its Tier follows from its own recorded answers — a build can proceed unattended',
    tier: brief.tier.assigned,
    tierDerivedIndependently: derived,
    mustHave: brief.mustHave.length,
    nonGoals: brief.nonGoals.length,
    rendered: 'Dev-Memory/OBJECTIVE.md',
    root,
  },
  0,
);
