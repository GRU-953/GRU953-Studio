#!/usr/bin/env node
//
// session-start.mjs — GRU953-Studio SessionStart hook. Zero dependencies.
//
// Added 2026-07-19 (Phase 4 — Claude Code on the web / cloud support). Its job
// is to make a resumed project pick itself back up automatically, on any
// surface: when a session starts inside a studio project (a Dev-Memory folder
// exists up the tree), it injects a reminder to run the `focus-guard`
// re-orientation ritual before acting, and — when the environment looks
// ephemeral (a cloud/web container that is reclaimed between sessions) — a note
// that project memory needs persistence to survive, per the `dev-memory` skill.
//
// Like the studio's other hooks it STANDS DOWN cleanly (emits nothing) when
// there is no studio project, so it never adds noise to unrelated sessions.
//
// SessionStart hooks add their stdout to the session context. This emits the
// documented structured form ({hookSpecificOutput:{hookEventName, additionalContext}})
// so the reminder is injected as context, not shown as a raw tool result.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { readStdin, extractCwd, findStudioRoot } from './lib.mjs';

// Best-effort, honest detection of an ephemeral/cloud environment. Only ever
// used to ADD a persistence reminder inside a studio project — never to change
// a safety decision — so a false positive is harmless and a false negative just
// omits a hint. Checks documented signals for common hosted/CI environments and
// a couple of container markers; deliberately conservative, never asserted as
// certain.
function isLikelyEphemeral() {
  const env = process.env;
  if (env.CLAUDE_CODE_WEB || env.CLAUDE_CODE_CLOUD || env.CLAUDE_CODE_REMOTE) return true;
  if (env.CODESPACES || env.GITPOD_WORKSPACE_ID || env.CI) return true;
  try {
    if (fs.existsSync('/.dockerenv')) return true; // common container marker
  } catch { /* ignore */ }
  return false;
}

function main() {
  let input = '';
  try { input = readStdin(); } catch { input = ''; }
  const cwd = extractCwd(input) || process.cwd();
  const studioRoot = findStudioRoot(cwd);
  if (studioRoot === null) {
    // Not a studio project — stand down silently.
    process.exit(0);
  }
  const lines = [
    'A GRU953-Studio project is present here (a Dev-Memory folder exists).',
    'Before doing anything else, run the focus-guard re-orientation ritual:',
    'read FOCUS.md, then OBJECTIVE.md, PROGRESS.md, the tail of SESSION-LOG.md',
    'and INDEX.md, and restate the single active goal in one plain line — then',
    'report the resume point to the user. Recall the least you need via the',
    'memory-graph protocol (read INDEX.md, expand only the GRAPH.md nodes the',
    'active task touches).',
  ];
  if (isLikelyEphemeral()) {
    lines.push(
      '',
      'This looks like a cloud/ephemeral session (the container may be reclaimed',
      'between sessions). Dev-Memory lives only here unless persistence is enabled',
      'for this project — follow the dev-memory skill\'s cloud-persistence rule so',
      'resume survives, and remember Ollama-based local features are unavailable',
      'here (they self-disable). Prefer the GitHub tools available in this session',
      'over a local `gh` CLI if one is not present.',
    );
  }
  const additionalContext = lines.join('\n');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
  }));
  process.exit(0);
}

main();
