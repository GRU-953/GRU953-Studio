#!/usr/bin/env node
// subagent-statusline.mjs — a plugin-shipped subagentStatusLine (2026-07-17
// gap-research fix: "give subagent progress a clearer line, matching what
// studio/SKILL.md already promises — no jargon, no walls of text").
//
// Only overrides rows for GRU953-Studio's own 23 specialist roles; every
// other subagent (another plugin's, or a built-in one) is left with the
// platform's own default `name · description · token count` rendering by
// simply not including its id in the output, exactly as documented.
import { readStdin } from './lib.mjs';

const ROLES = new Set([
  'project-lead', 'interviewer', 'architect', 'scope-guardian', 'builder',
  'reviewer', 'tester', 'security-compliance-auditor', 'brand-guardian',
  'ai-developer', 'fixer', 'cost-monitor', 'publisher', 'memory-keeper',
  'maintenance-agent', 'devops-engineer', 'responsible-ai-reviewer',
  'accessibility-specialist', 'ux-designer', 'technical-writer',
  'data-engineer', 'localisation-specialist', 'researcher',
]);

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
