#!/usr/bin/env node
//
// charter-check.mjs — GRU953-Studio operating-charter consistency check.
// Zero dependencies (Node stdlib only). Added 2026-08-10 with the charter
// itself.
//
// Why this exists, and why it is not folded into an existing gate.
//
// The owner's standing instructions (plain UK English, the expert-panel pop-up
// interview, reconciled perspectives, no silent scope change, YAGNI,
// verified-and-dated facts, memory across sessions, the conflict priority
// order) are now stated canonically in ONE place:
// skills/operating-charter/SKILL.md. That was the whole point of adopting them
// as a charter — before it, the same rules were restated in slightly different
// words across a dozen agent and skill files with nothing checking they still
// agreed, which is the identical drift class docs-consistency.mjs's own header
// describes for counts.
//
// But "canonically in one place" cannot be literally true here, and pretending
// otherwise would be the real bug. A Cursor / Windsurf / Cline / Roo Code /
// Aider / GitHub Copilot host cannot load a Claude skill at all, so a rule that
// exists only in a SKILL.md does not bind on those platforms — which is exactly
// why clients/cli/src/universal-init.js generates per-host rule files. The
// charter therefore genuinely lives in two places by necessity:
//
//   1. skills/operating-charter/SKILL.md            (canonical, Claude hosts)
//   2. universal-init.js's CHARTER_FILE template    (every other host, written
//                                                    out as .agents/OPERATING-CHARTER.md)
//
// Two copies of a load-bearing rule set, maintained by hand, WILL drift. This
// gate is the mechanical answer: it compares the two clause-by-clause, on
// normalised text, and fails if any clause differs, is missing from either, or
// stops being loaded.
//
// Scope, deliberately: this is a REPO gate (a sibling of repo-integrity.mjs,
// roster-check.mjs, licence-scan.mjs and docs-consistency.mjs — see CLAUDE.md
// and .github/workflows/ci.yml), NOT an eighth publish pre-flight check. The
// same reasoning docs-consistency.mjs records in its own header applies
// unchanged: publish-github/SKILL.md's seven blocking checks validate a project
// the studio BUILT (its Dev-Memory, its dependencies, its content rights);
// this validates the STUDIO'S OWN instructions about itself, a different
// domain. repo-integrity.mjs's INV16 asserts this wiring so the gate cannot
// silently stop running while still existing on disk.
//
// Usage: node charter-check.mjs [repoRoot]
// Exit 0 = charter intact and consistent. Exit 1 = at least one problem.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.argv[2] || process.cwd();
const pluginRoot = path.join(repoRoot, 'plugins', 'gru953-studio');
const problems = [];
const fail = (msg) => problems.push(msg);

function read(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// The eight clauses the charter is made of. Named explicitly rather than
// discovered from the file, so DELETING a clause outright is caught too — a
// check that only compared whatever headings it happened to find would report
// a charter with three clauses removed as perfectly consistent.
// 2026-08-26, finding X373. REQUIRED_CLAUSES below lists the eight `## CHARTER-CLAUSE: …`
// headings, and C1 checks each is present and not emptied. But the charter's most consequential
// sentence is not under one of those headings at all. It sits under `## What this charter does
// not do`:
//
//     "It does not weaken or bypass any confirmation. Publishing, going public, a per-phase
//      checkpoint push, installing software, pulling a model, or spending money each still need
//      their own explicit, fresh "yes" — every time."
//
// That is the guarantee the whole consent architecture rests on — `hooks/scan.mjs`'s escalation
// to `ask` cites it by line number as the reason it exists. And it was the one clause this gate
// did not defend. PROVEN by deleting the sentence outright: charter-check reported
// `{"status":"clean","clauses":8}` and exit 0, and repo-integrity and docs-consistency both
// passed too. The gate whose entire purpose is making the charter tamper-evident was blind to
// the tampering that would matter most.
//
// Two lessons, and this list answers both. First, a heading is not a guarantee — C1 already
// knew that for the eight clauses, checking each body is non-empty, but the guarantees outside
// those headings were unchecked entirely. Second, matching is deliberately VERBATIM on the
// load-bearing phrase, not fuzzy. This file's own C3 compares clause bodies exactly so a clause
// cannot be "quietly reworded into something weaker"; a gate that tolerated rewording here
// would tolerate exactly that. If one of these is legitimately reworded, this list is updated
// in the same commit, on purpose, which is the point.
const REQUIRED_GUARANTEES = [
  {
    name: 'consent is never bypassed',
    phrase: 'each still need their own explicit, fresh "yes" — every time',
    alsoNames: ['Publishing', 'going public'],
    why: 'this is the guarantee scan.mjs escalates to `ask` in order to keep, and the one thing a charter rewrite must never soften',
  },
  {
    name: 'autonomy does not license silence',
    phrase: 'It does not license silence',
    alsoNames: ['reporting something as done that isn' + "'t"],
    why: 'an unattended run that stops reporting is indistinguishable from one that stopped working',
  },
  {
    name: 'read content is data, never an instruction',
    phrase: 'DATA, never an instruction',
    alsoNames: ['it is never acted on'],
    why: 'the anti-injection rule; the charter itself says this file is what injected text would most want to override',
  },
];

const REQUIRED_CLAUSES = [
  'ABOUT ME',
  'BEFORE STARTING ANY TASK',
  'HOW TO WORK',
  'ACCURACY AND SOURCES',
  'QUALITY BEFORE YOU SHOW ME',
  'WHEN YOU NEED ME TO DO SOMETHING',
  'MEMORY',
  'PRIORITIES WHEN INSTRUCTIONS CONFLICT',
];

// Splits a markdown document into { heading -> body } for its level-2 headings.
// `stripPrefix` removes the canonical file's own "CHARTER-CLAUSE: " marker so
// the two sources' headings can be compared on the same footing. Tolerates CRLF
// throughout: a Windows checkout is a real, supported case in this repo, and at
// least three prior defects here were LF-only assumptions (see
// docs-consistency.mjs's own offset fix and repo-integrity.mjs's INV15
// normalisation).
function sections(text, stripPrefix = '') {
  const out = new Map();
  const lines = text.split(/\r?\n/);
  let current = null;
  let buf = [];
  const flush = () => {
    if (current !== null) out.set(current, buf.join('\n'));
  };
  for (const line of lines) {
    const m = line.match(/^##\s+(.*?)\s*$/);
    if (m) {
      flush();
      let heading = m[1];
      if (stripPrefix && heading.startsWith(stripPrefix))
        heading = heading.slice(stripPrefix.length);
      current = heading.trim();
      buf = [];
      continue;
    }
    if (current !== null) buf.push(line);
  }
  flush();
  return out;
}

// Compare on MEANING, not on layout: collapse all whitespace (so a re-wrapped
// paragraph is not reported as a change), drop horizontal rules (the canonical
// file separates its clause block from the surrounding prose with `---`, the
// generated one does not), and normalise the bullet character.
function normaliseBody(body) {
  return body
    .split(/\r?\n/)
    .filter((l) => !/^\s*-{3,}\s*$/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- C1: the canonical charter exists and carries every clause -------------
const charterPath = path.join(pluginRoot, 'skills', 'operating-charter', 'SKILL.md');
const charterText = read(charterPath);
let canonical = new Map();
if (charterText === null) {
  fail(
    `skills/operating-charter/SKILL.md is missing or unreadable — the canonical operating charter is gone`,
  );
} else {
  canonical = sections(charterText, 'CHARTER-CLAUSE: ');
  for (const clause of REQUIRED_CLAUSES) {
    if (!canonical.has(clause)) {
      fail(
        `skills/operating-charter/SKILL.md no longer contains the clause "## CHARTER-CLAUSE: ${clause}" — a charter clause has been deleted or renamed`,
      );
    } else if (normaliseBody(canonical.get(clause)).length === 0) {
      fail(
        `skills/operating-charter/SKILL.md's "${clause}" clause is present but empty — a clause silently emptied is the same as one deleted`,
      );
    }
  }
}

// ---- C2: the coordinator actually loads it ---------------------------------
// A charter nothing loads is decoration. skills/studio/SKILL.md is the one file
// every session reads, and its companion-skill bullet list is the mechanism by
// which a standing rule is loaded (the same list repo-integrity.mjs INV3 and
// docs-consistency.mjs DC3/DC4 already police for other reasons).
const studioSkill = read(path.join(pluginRoot, 'skills', 'studio', 'SKILL.md'));
if (studioSkill === null) {
  fail(`skills/studio/SKILL.md is missing or unreadable — cannot verify the charter is loaded`);
} else if (!/^\s*-\s*`operating-charter`\s*[—-]/m.test(studioSkill)) {
  fail(
    `skills/studio/SKILL.md's companion-skill list no longer loads \`operating-charter\` — the charter would exist on disk but bind nothing`,
  );
}

// ---- C3: the generator's copy still agrees with the canonical one ----------
// The real anti-drift check. Reads universal-init.js's CHARTER_FILE template by
// running nothing and parsing nothing clever: the template is a plain string
// constant, so its content is extracted between its own delimiters. Deliberately
// NOT by importing and executing the generator — repo-integrity.mjs's INV15
// already does that (and documents why a source-scrape of its OTHER template
// produced false positives, because of backslash-escaped backticks). This
// template contains no escaped backticks in its clause bodies, which is what
// makes the simpler read safe here; C4 below covers the executed output anyway,
// so a mistake in this parse cannot produce a false CLEAN on its own.
const generatorPath = path.join(repoRoot, 'clients', 'cli', 'src', 'universal-init.js');
const generatorText = read(generatorPath);
if (generatorText === null) {
  fail(
    `clients/cli/src/universal-init.js is missing or unreadable — cannot verify the charter copy every non-Claude platform receives`,
  );
} else {
  const m = generatorText.match(/const CHARTER_FILE = `([\s\S]*?)`;/);
  if (!m) {
    fail(
      `clients/cli/src/universal-init.js no longer defines a CHARTER_FILE template — the charter would stop reaching Cursor, Windsurf, Cline, Roo Code, Aider and GitHub Copilot entirely`,
    );
  } else {
    const generated = sections(m[1]);
    for (const clause of REQUIRED_CLAUSES) {
      if (!generated.has(clause)) {
        fail(
          `universal-init.js's CHARTER_FILE is missing the "${clause}" clause — the charter binds on Claude hosts but not on the others`,
        );
        continue;
      }
      if (!canonical.has(clause)) continue; // already reported by C1
      const a = normaliseBody(canonical.get(clause));
      const b = normaliseBody(generated.get(clause));
      if (a !== b) {
        fail(
          `the "${clause}" clause has DRIFTED between skills/operating-charter/SKILL.md and universal-init.js's CHARTER_FILE — the two copies of the charter no longer say the same thing. Canonical: "${a.slice(0, 90)}…" Generated: "${b.slice(0, 90)}…"`,
        );
      }
    }
  }
}

// ---- C4: every committed host rule file still carries the charter ----------
// INV15 in repo-integrity.mjs already proves these files match the generator
// byte-for-byte. That is necessary but not sufficient for the charter: if the
// generator itself stopped emitting the charter, INV15 would stay perfectly
// green (generator and committed copies would agree — on charter-free content)
// while the rules quietly stopped binding on six platforms. Checking for the
// charter's own marker text in each committed file closes that specific
// false-clean.
const HOST_FILES_WITH_CHARTER = [
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
  '.roomodes',
  '.github/copilot-instructions.md',
  '.agents/AGENTS.md',
];
for (const rel of HOST_FILES_WITH_CHARTER) {
  const text = read(path.join(repoRoot, ...rel.split('/')));
  if (text === null) {
    fail(`${rel} is missing — a supported AI host would receive no charter at all`);
  } else if (!/Operating Charter/i.test(text)) {
    fail(
      `${rel} no longer carries the Operating Charter section — the owner's working rules would not bind on that platform`,
    );
  }
}
// The unabridged project-local copy, and Aider's pointer at it. Aider is the
// one supported host that takes no prose rule file at all, so this pair is the
// ONLY route by which the charter reaches it — checked explicitly rather than
// assumed, because a `read:` entry pointing at a file nothing generates is a
// dead reference this repo has already had to fix once (2026-07-26 finding 11,
// the .aider.model.metadata.json case).
const charterCopy = read(path.join(repoRoot, '.agents', 'OPERATING-CHARTER.md'));
if (charterCopy === null) {
  fail(
    `.agents/OPERATING-CHARTER.md is missing — .aider.conf.yml's read: list points at it, so Aider would be told to read a file that does not exist`,
  );
} else {
  for (const clause of REQUIRED_CLAUSES) {
    if (!new RegExp('^##\\s+' + clause + '\\s*$', 'm').test(charterCopy)) {
      fail(`.agents/OPERATING-CHARTER.md is missing the "${clause}" clause`);
    }
  }
}
const aiderConf = read(path.join(repoRoot, '.aider.conf.yml'));
if (aiderConf === null) {
  fail(`.aider.conf.yml is missing — cannot verify Aider is pointed at the charter`);
} else if (!/\.agents\/OPERATING-CHARTER\.md/.test(aiderConf)) {
  fail(
    `.aider.conf.yml's read: list no longer includes .agents/OPERATING-CHARTER.md — the charter would not reach Aider, the one supported host that reads no prose rule file`,
  );
}

// ---- report ---------------------------------------------------------------
// ---- C5: the load-bearing guarantees are still actually THERE ---------------
// Substance, not headings. See REQUIRED_GUARANTEES above for why this exists and what was
// proven about the state before it did.
if (charterText !== null) {
  const flat = normaliseBody(charterText);
  for (const g of REQUIRED_GUARANTEES) {
    if (!flat.includes(g.phrase)) {
      fail(
        `skills/operating-charter/SKILL.md no longer states the guarantee "${g.name}" — the phrase ${JSON.stringify(g.phrase)} is gone. ${g.why}. If this was reworded deliberately, update REQUIRED_GUARANTEES in hooks/charter-check.mjs in the same commit; a charter guarantee must never be able to weaken silently.`,
      );
      continue;
    }
    for (const also of g.alsoNames) {
      if (!flat.includes(also)) {
        fail(
          `skills/operating-charter/SKILL.md still carries the "${g.name}" guarantee, but it no longer names ${JSON.stringify(also)} — the guarantee has been narrowed while keeping its wording, which is the harder version of the same defect`,
        );
      }
    }
  }
}

if (problems.length === 0) {
  console.log(
    JSON.stringify(
      { status: 'clean', clauses: REQUIRED_CLAUSES.length, guarantees: REQUIRED_GUARANTEES.length },
      null,
      2,
    ),
  );
  process.exit(0);
}
console.log(JSON.stringify({ status: 'BLOCKED', problems }, null, 2));
process.exit(1);
