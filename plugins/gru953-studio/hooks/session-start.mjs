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
import process from 'node:process';
import { readStdin, extractCwd, findStudioRoot } from './lib.mjs';

// Best-effort, honest detection of an ephemeral/cloud environment. Only ever
// used to ADD a persistence reminder inside a studio project — never to change
// a safety decision — so a false positive is harmless and a false negative just
// omits a hint. Checks documented signals for common hosted/CI environments and
// a couple of container markers; deliberately conservative, never asserted as
// certain.
// Found 2026-07-19: a plain `||` truthy check treats ANY non-empty string as
// true, including the literal text "false" — so explicitly disabling one of
// these vars with a falsy-LOOKING string value still tripped this. Harmless
// in practice (see the comment above — never used for a safety decision),
// but a genuine logic bug relative to how env-var flags are normally read.
function isTruthyEnv(v) {
  return ['1', 'true', 'yes'].includes(String(v ?? '').trim().toLowerCase());
}
function isLikelyEphemeral() {
  const env = process.env;
  if (isTruthyEnv(env.CLAUDE_CODE_WEB) || isTruthyEnv(env.CLAUDE_CODE_CLOUD) || isTruthyEnv(env.CLAUDE_CODE_REMOTE)) return true;
  // CODESPACES / GITPOD_WORKSPACE_ID are identifier-style presence flags (any
  // non-empty value legitimately means "set"), so a presence check is correct.
  // CI is a boolean-style flag, so it uses isTruthyEnv too — 2026-07-21 fix:
  // `CI=false` previously tripped this branch, the exact class the CLAUDE_CODE_*
  // fix above closed, applied inconsistently one line down.
  if (env.CODESPACES || env.GITPOD_WORKSPACE_ID || isTruthyEnv(env.CI)) return true;
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
  // 2026-07-26 audit findings 24 and 25 (MAJOR). This used to spawn
  // auto-update.mjs DETACHED on every single session start, which ran
  // `git remote update` and then `git pull --rebase --autostash` — rewriting
  // history and stashing the user's uncommitted work, with no confirmation, in
  // whatever directory the plugin happened to resolve to. That directory is
  // three levels above hooks/, which is the repo root in a git checkout but an
  // arbitrary folder in a marketplace install. It was the only code path in the
  // product that modified files the user had not asked it to touch, and it was
  // entirely untested.
  //
  // It also never ran on Windows at all: the old path used
  // `new URL(import.meta.url).pathname`, which yields "/C:/..." there, so
  // existsSync was false and the whole branch was skipped — the bug was
  // masking its own blast radius on one platform.
  //
  // Replaced with notify-only. Nothing is fetched, nothing is written, no child
  // process is spawned. The user is told an update may be available and pointed
  // at the explicit `/studio-update` command, which still performs the real
  // update after they ask for it. Deliberately a REDUCTION in automation: a
  // silent rebase is not a feature worth keeping. Asserted by test — the hook
  // must spawn no child process.
  lines.push(
    '',
    'If the user asks about updating GRU953-Studio, tell them to run',
    '`/studio-update`. Never fetch, pull, rebase or stash on their behalf',
    'without them asking for it first.',
  );

  const additionalContext = lines.join('\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
  }));
  process.exit(0);
}

main();
