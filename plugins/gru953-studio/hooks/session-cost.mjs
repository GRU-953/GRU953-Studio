#!/usr/bin/env node
//
// session-cost.mjs — what this unattended run has actually spent, and whether to stop.
//
// THE GAP. `skills/cost-guard/SKILL.md` sets the spending default as "pause to check with the
// user before any noticeably expensive step, even if that means more interruptions", and
// `skills/model-router/SKILL.md` concedes in writing that "there is no numeric per-task
// threshold in this codebase". So the product's stated cost control is an unmeasured judgement
// call whose remedy is to ask a person. An unattended run cannot ask, and — more to the point —
// could not answer even if it wanted to, because nothing measured anything. `agents/cost-monitor.md`
// documents a role enforcing a rule with no mechanism behind it.
//
// This measures it, and gives a run a number it can stop on.
//
// TOKENS, NOT MONEY — a deliberate departure from the peer implementation this idea came from.
// Converting tokens to currency needs a per-model price list, and a price list inside an LTS
// release stops being a snapshot and becomes a promise: wrong the first time a price changes,
// and wrong silently, in the direction of under-reporting. Tokens are what the transcript
// actually records, they never go stale, and a token ceiling is just as actionable as a money
// one. If you want a cost in pounds, multiply the reported totals by today's published rate
// yourself, once, at the moment you care.
//
// KEYED BY message.id, AND WHY THAT IS NOT A STYLE PREFERENCE. The harness writes one
// transcript line per content block, and every line of a multi-block message repeats that
// message's usage in full. Measured on a real session on this machine before building this:
// 424 usage-bearing rows carrying only 162 distinct message ids, 136 of them repeated, the
// repeated usages byte-identical. Summing rows inflated output tokens by 2.84x. A budget built
// on the naive sum would halt a run at a third of its real allowance and report a number
// nobody could reconcile.
//
// IT NEVER GUESSES WHERE THE TRANSCRIPT IS. Given no `--transcript`, it looks in Claude Code's
// conventional location and, if it finds nothing, says so and BLOCKS. It does not report a
// spend of zero. "I could not find the transcript" and "this run has cost nothing" are the same
// output in a careless implementation, and the first silently disables the control.
//
// Usage:
//   node session-cost.mjs [projectRoot] [--transcript <path>]
// (There is no --json flag and there never was one: the output is JSON already. The usage line
//  advertised one until 2026-08-27, and a role had been told to pass it.)
// Exit 0 = measured, and within budget (or no budget declared).
// Exit 1 = could not measure, or the budget is exceeded.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

import { classifyStudioRoot, readOrBlock, MISSING } from './lib.mjs';

const argv = process.argv.slice(2);
const flagIndex = argv.indexOf('--transcript');
const explicitTranscript = flagIndex !== -1 ? argv[flagIndex + 1] : null;
const root = argv.find((a) => !a.startsWith('--') && a !== explicitTranscript) || process.cwd();

const SCHEMA_VERSION = 1;

function out(obj, code) {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(code);
}

// ---- locate the transcript ------------------------------------------------------------------
function findTranscript() {
  if (explicitTranscript) {
    if (!fs.existsSync(explicitTranscript)) {
      return { error: `--transcript ${explicitTranscript} does not exist` };
    }
    return { file: explicitTranscript, how: 'given with --transcript' };
  }
  // Claude Code keeps per-project transcripts under ~/.claude/projects/<encoded-cwd>/. The
  // encoding is not a documented contract, so this is a BEST EFFORT that reports failure loudly
  // rather than a derivation this gate depends on being right.
  const base = path.join(os.homedir(), '.claude', 'projects');
  let dirs;
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return { error: `no transcript directory at ${base}` };
  }
  const wanted = path.resolve(root).replace(/[/\\.]/g, '-');
  const hit = dirs.find((d) => d.name === wanted) || dirs.find((d) => wanted.endsWith(d.name));
  if (!hit) {
    return {
      error: `could not identify a transcript directory under ${base} for ${path.resolve(root)}. Pass --transcript <path> explicitly rather than letting this gate guess`,
    };
  }
  const dir = path.join(base, hit.name);
  let files;
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
  } catch {
    return { error: `could not read ${dir}` };
  }
  if (files.length === 0) return { error: `no .jsonl transcript found in ${dir}` };
  return { file: path.join(dir, files[0].f), how: `newest transcript in ${dir}` };
}

const located = findTranscript();
if (located.error) {
  out(
    {
      status: 'BLOCKED',
      problems: [
        `${located.error}. This gate will not report a spend it did not measure: "I could not find the transcript" and "this run has cost nothing" must never be the same answer, because the first silently switches the control off.`,
      ],
      root,
    },
    1,
  );
}

// ---- read and total, keyed by message.id ----------------------------------------------------
let lines;
try {
  lines = fs.readFileSync(located.file, 'utf8').split('\n');
} catch (e) {
  out({ status: 'BLOCKED', problems: [`could not read ${located.file} — ${e.message}`], root }, 1);
}

const seen = new Map(); // message.id -> usage
const perModel = new Map();
let malformed = 0;
for (const line of lines) {
  const t = line.trim();
  if (t === '') continue;
  let rec;
  try {
    rec = JSON.parse(t);
  } catch {
    malformed++;
    continue;
  }
  const m = rec && rec.message;
  if (!m || !m.usage || typeof m.id !== 'string') continue;
  if (seen.has(m.id)) continue; // the duplicate-content-block case, measured at 2.84x
  seen.set(m.id, true);
  const u = m.usage;
  const model = typeof m.model === 'string' ? m.model : 'unrecorded';
  const acc = perModel.get(model) || {
    model,
    messages: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
  };
  acc.messages += 1;
  acc.input += Number(u.input_tokens) || 0;
  acc.output += Number(u.output_tokens) || 0;
  acc.cacheRead += Number(u.cache_read_input_tokens) || 0;
  acc.cacheCreation += Number(u.cache_creation_input_tokens) || 0;
  perModel.set(model, acc);
}

const byModel = [...perModel.values()].sort((a, b) => b.output - a.output);
const total = byModel.reduce(
  (a, m) => ({
    messages: a.messages + m.messages,
    input: a.input + m.input,
    output: a.output + m.output,
    cacheRead: a.cacheRead + m.cacheRead,
    cacheCreation: a.cacheCreation + m.cacheCreation,
  }),
  { messages: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
);
// The number a budget is set against. Cache reads are excluded deliberately: they are the
// cheapest tokens by a wide margin and including them would make a ceiling meaningless on a long
// session, where cache reads dominate the count while costing least.
total.billableish = total.input + total.output + total.cacheCreation;

// A transcript this gate could open but not parse at all is not a measurement of zero.
if (seen.size === 0) {
  out(
    {
      status: 'BLOCKED',
      problems: [
        `read ${located.file} (${lines.length} lines, ${malformed} unparseable) and found no usage records at all. That is not a run which cost nothing — it is a transcript this gate could not interpret, and reporting zero would switch the control off silently.`,
      ],
      transcript: located.file,
      root,
    },
    1,
  );
}

// ---- the budget, if this project declares one -----------------------------------------------
const kind = classifyStudioRoot(root);
let budget = null;
let budgetSource = 'none declared';
if (kind.kind === 'studio') {
  const raw = readOrBlock(path.join(kind.devMemory, 'run.json'));
  if (raw !== MISSING) {
    let cfg;
    try {
      cfg = JSON.parse(raw);
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
    if (cfg.schemaVersion !== SCHEMA_VERSION) {
      out(
        {
          status: 'BLOCKED',
          problems: [
            `Dev-Memory/run.json declares schemaVersion ${JSON.stringify(cfg.schemaVersion)}, and this gate understands ${SCHEMA_VERSION}`,
          ],
          root,
        },
        1,
      );
    }
    if (cfg.tokenBudget !== undefined) {
      if (!Number.isFinite(cfg.tokenBudget) || cfg.tokenBudget <= 0) {
        out(
          {
            status: 'BLOCKED',
            problems: [
              `Dev-Memory/run.json declares tokenBudget ${JSON.stringify(cfg.tokenBudget)}, which is not a positive number. A ceiling that cannot be compared against is not a ceiling.`,
            ],
            root,
          },
          1,
        );
      }
      budget = cfg.tokenBudget;
      budgetSource = 'Dev-Memory/run.json';
    }
  }
}

const report = {
  transcript: located.file,
  locatedBy: located.how,
  distinctMessages: seen.size,
  rowsRead: lines.length,
  unparseableRows: malformed,
  tokens: total,
  byModel,
  budget,
  budgetSource,
  note: "Tokens, not money: a price table inside an LTS release becomes a promise that goes stale silently. Multiply by today's published rate yourself if you need a currency figure.",
  root,
};

if (budget === null) {
  out(
    { status: 'clean', reason: 'measured; no token budget declared for this project', ...report },
    0,
  );
}
if (total.billableish > budget) {
  out(
    {
      status: 'BLOCKED',
      reason: `this run has used ${total.billableish} tokens against a declared budget of ${budget} — over by ${total.billableish - budget}`,
      ...report,
    },
    1,
  );
}
out(
  {
    status: 'clean',
    reason: `within budget: ${total.billableish} of ${budget} tokens used (${Math.round((total.billableish / budget) * 100)}%)`,
    ...report,
  },
  0,
);
