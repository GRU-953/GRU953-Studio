#!/usr/bin/env node
// subagent-statusline.mjs — a plugin-shipped subagentStatusLine (2026-07-17
// gap-research fix: "give subagent progress a clearer line, matching what
// studio/SKILL.md already promises — no jargon, no walls of text").
//
// Only overrides rows for GRU953-Studio's own specialist roles; every other
// subagent (another plugin's, or a built-in one) is left with the platform's
// own default `name · description · token count` rendering by simply not
// including its id in the output, exactly as documented.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStdin } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 2026-07-21 audit fix: this was a hardcoded 23-name Set that silently fell 15
// roles behind after v3.6.0/v4.1.0 grew the roster to 38 — the 10 language
// specialists and 5-strong content team got the platform default line instead of
// the promised one, with nothing (no test, no repo-integrity invariant) guarding
// it. Deriving the recognised roles from agents/ at runtime makes drift
// structurally impossible: a new agent is recognised the moment its file exists,
// and no list can go stale. If agents/ can't be read (run outside the plugin),
// fall back to no custom rows — every subagent then keeps the safe default
// rendering rather than erroring.
let ROLES;
try {
  ROLES = new Set(
    fs
      .readdirSync(path.join(HERE, '..', 'agents'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, '')),
  );
} catch {
  ROLES = new Set();
}

// 2026-08-22, X249: the plugin's OWN name, read rather than hardcoded, so a rename cannot silently
// turn the check below into a check for nothing. Falls back to the literal only if the manifest
// cannot be read, which is the same fallback ROLES uses.
let PLUGIN_NAME = 'gru953-studio';
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8'),
  );
  if (manifest && typeof manifest.name === 'string' && manifest.name) PLUGIN_NAME = manifest.name;
} catch {
  /* keep the default */
}

function shortRoleName(name) {
  // The Agent tool names a plugin-shipped subagent "<plugin>:<role>".
  //
  // 2026-08-22, X249: this used to `split(':').pop()` and match the bare tail against our own
  // agents/ filenames — so ANOTHER plugin's `theirplugin:reviewer` matched, and its row was
  // relabelled "GRU953-Studio — reviewer (working)". Eight of this plugin's 38 role names are
  // ordinary English words another plugin could plausibly use: architect, builder, fixer,
  // interviewer, publisher, researcher, reviewer, tester. The file's own header promised the
  // opposite in so many words — "every other subagent (another plugin's, or a built-in one) is left
  // with the platform's own default rendering" — so this both mislabelled other people's work and
  // contradicted its own documentation.
  //
  // A qualified name must now carry OUR plugin prefix. A bare name still matches, because the
  // header's other claim is also true: the caller may pass either form, and a bare `reviewer`
  // inside this plugin's own session is ours.
  const raw = String(name || '');
  const idx = raw.lastIndexOf(':');
  if (idx !== -1) {
    const owner = raw.slice(0, idx);
    const role = raw.slice(idx + 1);
    if (owner !== PLUGIN_NAME) return null; // somebody else's subagent — leave it alone
    return ROLES.has(role) ? role : null;
  }
  return ROLES.has(raw) ? raw : null;
}

// 2026-07-31 maintenance fix (F1): readStdin() now THROWS (StdinReadFailure)
// instead of returning '' when it could not reliably read stdin (see
// lib.mjs). This hook is not a security gate — the safe fallback here is
// exactly what a genuine empty read already did: emit nothing and leave
// every row on the platform's default rendering.
let raw;
try {
  raw = readStdin();
} catch {
  raw = '';
}
let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0); // unparseable input: emit nothing, every row stays default
}
const tasks = input && Array.isArray(input.tasks) ? input.tasks : [];
const columns = input && Number.isFinite(input.columns) ? input.columns : 80;

for (const t of tasks) {
  const role = shortRoleName(t && t.name);
  if (!role || !t.id) continue; // not one of ours — leave default rendering
  const label = role.replace(/-/g, ' ');
  // 2026-08-22, X249: `String(t.status || '')` meant a task whose status the host omitted rendered
  // as "GRU953-Studio — reviewer ()" — an empty bracket shown to a non-technical user, which is
  // exactly the "no jargon, no walls of text" promise this hook exists to keep, broken by an empty
  // pair of brackets. An unknown status now produces no bracket at all rather than an empty one.
  const status =
    t.status === 'completed' ? 'done' : t.status === 'running' ? 'working' : String(t.status || '');
  let line = status ? `GRU953-Studio — ${label} (${status})` : `GRU953-Studio — ${label}`;
  if (line.length > columns) line = line.slice(0, Math.max(0, columns - 1)) + '…';
  process.stdout.write(JSON.stringify({ id: t.id, content: line }) + '\n');
}
// 2026-08-22, X263: this ended `process.exit(0)`, which terminates immediately and DISCARDS anything
// still buffered in stdout. Node's own documentation warns about exactly that. On this machine, with
// this hook's small payload and a pipe, nothing was lost — which is why an adjudicator reasonably
// graded the claim not-a-defect. But that reasoning rests on the consumer draining a pipe promptly,
// which is the platform behaviour the very next finding in the same block was graded
// CANNOT-DETERMINE for want of; and the product ships Windows and Linux installers, where the
// buffering is not the same. Letting the process end naturally flushes, costs nothing, and removes
// the question rather than answering it from one platform. The earlier `process.exit(0)` for
// unparseable input is left alone: it has written nothing, so it has nothing to lose.
process.exitCode = 0;
