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
    fs.readdirSync(path.join(HERE, '..', 'agents'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, '')),
  );
} catch {
  ROLES = new Set();
}

function shortRoleName(name) {
  // Agent tool names a plugin-shipped subagent "<plugin>:<role>" — match on
  // the part after the colon, if present, so this works whether the caller
  // passed the qualified or bare form.
  const bare = String(name || '').split(':').pop();
  return ROLES.has(bare) ? bare : null;
}

const raw = readStdin();
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
  const status = t.status === 'completed' ? 'done' : t.status === 'running' ? 'working' : String(t.status || '');
  let line = `GRU953-Studio — ${label} (${status})`;
  if (line.length > columns) line = line.slice(0, Math.max(0, columns - 1)) + '…';
  process.stdout.write(JSON.stringify({ id: t.id, content: line }) + '\n');
}
process.exit(0);
