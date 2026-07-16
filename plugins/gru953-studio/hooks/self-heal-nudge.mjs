#!/usr/bin/env node
// self-heal-nudge.mjs — a PostToolUseFailure hook that makes the "hand a
// build-time failure to fixer" step in self-healing/SKILL.md structural
// rather than relying on builder/tester remembering to do it every time
// (2026-07-17, the "make failure hand-offs automatic" gap-research fix).
//
// Deliberately a COMMAND hook, not the newer "agent" hook type — Anthropic's
// own docs mark agent-type hooks "experimental... For production workflows,
// prefer command hooks" (hooks.md), and this project's own established
// pattern is command hooks throughout (scan.mjs, gate.mjs). A hook cannot
// itself dispatch the fixer subagent; it can only add context reminding
// Claude to do so, the same indirect mechanism every other hook in this
// project already uses to shape behaviour rather than force it directly.
import { readStdin, extractCwd, findStudioRoot } from './lib.mjs';

function output(additionalContext) {
  if (additionalContext) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext },
      }) + '\n'
    );
  }
  process.exit(0);
}

const raw = readStdin();
let input;
try {
  input = JSON.parse(raw);
} catch {
  output(); // unparseable input: say nothing rather than guess
}
if (!input || typeof input !== 'object') output();

// A user-initiated interruption (Ctrl+C) is not a bug to self-heal.
if (input.is_interrupt) output();

// Only relevant inside an active GRU953-Studio project (a Dev-Memory
// folder somewhere up the tree) — stand down everywhere else, same
// scoping rule scan.mjs/gate.mjs already use, so this stays silent for
// any other Bash failure in any other project.
const cwd = extractCwd(raw) || process.cwd();
if (!findStudioRoot(cwd)) output();

output(
  'A Bash command just failed inside an active GRU953-Studio project. ' +
    'Follow the self-healing skill: hand this to the fixer role for up to ' +
    '2 quiet attempts (reproduce, find the root cause, apply the smallest ' +
    'fix, re-verify) before invoking the Project Lead\'s full Stuck Protocol. ' +
    'This never applies to Publish or any push-capable action.'
);
