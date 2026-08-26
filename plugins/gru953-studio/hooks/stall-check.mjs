#!/usr/bin/env node
//
// stall-check.mjs — is this unattended run still working, or has it silently wedged?
//
// THE GAP. Nothing in this product can answer that question. Every hook declares a 20-second
// timeout in `hooks.json`, which bounds a HOOK, not a RUN. A build left to itself for three
// hours either finished, or is thinking, or died forty minutes ago waiting on something that
// will never return — and there is no way to tell those apart without a person reading a
// transcript. That is the single thing which decides whether leaving a run unattended is
// reasonable at all.
//
// WHAT IT READS. Claude Code's own session transcript: newline-delimited JSON, one record per
// content block, each carrying a `timestamp`. Verified on this machine before building against
// it — 850 records with timestamps, and `tool_use` / `tool_result` blocks that pair cleanly
// (169 uses, 168 results, the single unmatched one being the call in flight at the time). So a
// tool call with no matching result is a real signal, not an artefact of the format.
//
// THE SUPPRESSION RULE, which is the whole difference between a watchdog people keep and one
// they switch off. A naive implementation flags any `tool_use` without a `tool_result` and
// therefore screams about the call currently executing, every single time it runs. Worse, it
// screams about a call that failed, was handled, and was moved past twenty minutes ago — the
// run is fine and the watchdog is crying wolf. So an unanswered call is only reported when
// there is NO later assistant activity after it: if the run went on to do more work, whatever
// happened to that call, it did not wedge the run. A watchdog that fires on healthy runs gets
// disabled, and a disabled watchdog is worse than none because its absence is invisible.
//
// It reports on the run's own recorded time, not on the wall clock, so a transcript examined
// later still reads correctly and the answer is reproducible.
//
// Usage:
//   node stall-check.mjs [projectRoot] [--transcript <path>] [--idle-minutes N]
// Exit 0 = the run looks healthy (or has finished cleanly).
// Exit 1 = could not determine — no transcript, or nothing in it this gate understands.
// Exit 2 = ATTENTION: the run appears wedged. Distinct from 1 for the same reason
//          task-ledger.mjs uses 2: "I cannot tell" and "I can tell, and it is stuck" must not
//          share an exit code, or a cron job cannot act on either.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

const argv = process.argv.slice(2);
const at = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
};
const explicitTranscript = at('--transcript');
const idleMinutes = Number(at('--idle-minutes') || 20);
const root =
  argv.find((a) => !a.startsWith('--') && a !== explicitTranscript && a !== at('--idle-minutes')) ||
  process.cwd();

function out(obj, code) {
  console.log(JSON.stringify(obj, null, 2));
  process.exit(code);
}

if (!Number.isFinite(idleMinutes) || idleMinutes <= 0) {
  out(
    {
      status: 'BLOCKED',
      problems: [`--idle-minutes ${JSON.stringify(at('--idle-minutes'))} is not a positive number`],
    },
    1,
  );
}

// ---- locate the transcript (never guessed silently; see session-cost.mjs for the same rule) --
function findTranscript() {
  if (explicitTranscript) {
    return fs.existsSync(explicitTranscript)
      ? { file: explicitTranscript }
      : { error: `--transcript ${explicitTranscript} does not exist` };
  }
  const base = path.join(os.homedir(), '.claude', 'projects');
  let dirs;
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return { error: `no transcript directory at ${base}` };
  }
  const wanted = path.resolve(root).replace(/[/\\.]/g, '-');
  const hit = dirs.find((d) => d.name === wanted) || dirs.find((d) => wanted.endsWith(d.name));
  if (!hit)
    return {
      error: `no transcript directory under ${base} for ${path.resolve(root)} — pass --transcript`,
    };
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
  return files.length
    ? { file: path.join(dir, files[0].f) }
    : { error: `no .jsonl transcript in ${dir}` };
}

const located = findTranscript();
if (located.error) {
  out(
    {
      status: 'BLOCKED',
      problems: [
        `${located.error}. Reporting "healthy" for a run this gate never looked at would be the worst of the three possible answers.`,
      ],
      root,
    },
    1,
  );
}

let lines;
try {
  lines = fs.readFileSync(located.file, 'utf8').split('\n');
} catch (e) {
  out({ status: 'BLOCKED', problems: [`could not read ${located.file} — ${e.message}`], root }, 1);
}

// ---- walk the transcript in order ------------------------------------------------------------
const pending = new Map(); // tool_use id -> { at, name, index }
const resolved = new Set();
let lastTimestamp = null;
let lastAssistantIndex = -1;
let records = 0;
let index = 0;

for (const line of lines) {
  const t = line.trim();
  if (t === '') continue;
  let rec;
  try {
    rec = JSON.parse(t);
  } catch {
    continue;
  }
  records++;
  index++;
  if (typeof rec.timestamp === 'string') lastTimestamp = rec.timestamp;
  if (rec.type === 'assistant') lastAssistantIndex = index;

  const content = rec.message && rec.message.content;
  if (!Array.isArray(content)) continue;
  for (const b of content) {
    if (b && b.type === 'tool_use' && typeof b.id === 'string') {
      if (!pending.has(b.id)) {
        pending.set(b.id, { at: rec.timestamp || lastTimestamp, name: b.name || 'unknown', index });
      }
    }
    if (b && b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
      resolved.add(b.tool_use_id);
    }
  }
}

if (records === 0) {
  out(
    {
      status: 'BLOCKED',
      problems: [
        `${located.file} contained no parseable records — this gate cannot say anything about the run`,
      ],
      root,
    },
    1,
  );
}

// ---- the suppression rule --------------------------------------------------------------------
// An unanswered call matters only if the run did nothing afterwards. If later assistant activity
// exists, the run moved on regardless of what became of that call, and reporting it would be the
// false positive that gets watchdogs switched off.
const unanswered = [...pending.entries()]
  .filter(([id]) => !resolved.has(id))
  .map(([id, v]) => ({ id, ...v }))
  .filter((c) => c.index >= lastAssistantIndex);

const lastMs = lastTimestamp ? Date.parse(lastTimestamp) : NaN;
const idleMs = Number.isFinite(lastMs) ? Date.now() - lastMs : NaN;
const idleMin = Number.isFinite(idleMs) ? Math.round(idleMs / 60000) : null;

const report = {
  transcript: located.file,
  records,
  lastActivity: lastTimestamp,
  idleMinutes: idleMin,
  threshold: idleMinutes,
  unansweredToolCalls: unanswered.map((c) => ({ tool: c.name, id: c.id, at: c.at })),
  root,
};

if (!Number.isFinite(lastMs)) {
  out(
    {
      status: 'BLOCKED',
      problems: [
        'no usable timestamp anywhere in the transcript, so how long the run has been idle cannot be established',
      ],
      ...report,
    },
    1,
  );
}

if (unanswered.length > 0 && idleMin >= idleMinutes) {
  out(
    {
      status: 'needs attention',
      reason: `the run has been idle for ${idleMin} minute(s) with ${unanswered.length} tool call(s) still unanswered and no activity after them — it appears wedged rather than working`,
      ...report,
    },
    2,
  );
}

if (idleMin >= idleMinutes) {
  out(
    {
      status: 'needs attention',
      reason: `no activity for ${idleMin} minute(s) (threshold ${idleMinutes}). No tool call is outstanding, so this is more likely a finished or abandoned run than a wedged one — but it is not working.`,
      ...report,
    },
    2,
  );
}

out(
  {
    status: 'clean',
    reason:
      unanswered.length > 0
        ? `active — last activity ${idleMin} minute(s) ago; ${unanswered.length} tool call(s) outstanding, which is normal for a call in flight`
        : `active — last activity ${idleMin} minute(s) ago, nothing outstanding`,
    ...report,
  },
  0,
);
