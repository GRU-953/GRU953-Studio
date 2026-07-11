#!/usr/bin/env node
//
// roster-check.mjs — mechanically checks the agent-role count against the
// baseline recorded in the most recent Dev-Memory/decisions/*roster*.md
// entry. Added 2026-07-10 Round 2 audit fix: `scope-guardian`'s "mechanical
// check" was, until this script existed, still just prose inside its own
// agent file — real progress over Round 1 (a falsifiable, human-checkable
// claim) but not yet an actual script. This is that script. Like
// licence-scan.mjs and verify-progress.mjs, it is intentionally NOT wired
// into hooks.json/PreToolUse (there is no natural trigger for "an agent
// file was added" the way there is for "a push happened") — run it
// manually via scope-guardian at any stage boundary, and as part of the
// Publish pre-flight.
//
// Usage: node roster-check.mjs [pluginRoot] [devMemoryRoot]
// pluginRoot defaults to the directory this script lives in, one level up
// from hooks/. devMemoryRoot defaults to the current working directory.
// Exit 0 = agent count matches (or is covered by) the most recent recorded
// baseline. Exit 1 = agent count exceeds the last recorded baseline with no
// newer decision file explaining the growth.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pluginRoot = process.argv[2] || path.resolve(here, '..');
  const devMemoryRoot = process.argv[3] || process.cwd();

  const agentsDir = path.join(pluginRoot, 'agents');
  let agentFiles = [];
  try {
    agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  } catch {
    console.log(JSON.stringify({ status: 'no agents/ directory found', agentsDir }));
    process.exit(1);
  }
  const currentCount = agentFiles.length;

  // 2026-07-11 v2.0.0 fix: fall back to the committed product baseline
  // (plugins/gru953-studio/ROSTER.md) when no per-project Dev-Memory baseline
  // exists. A project BUILT BY the studio records its baseline in
  // Dev-Memory/decisions/*roster*.md; the PRODUCT repo itself has no
  // Dev-Memory, so before this fallback existed this check could never pass
  // on GRU953-Studio's own repository (and CI therefore couldn't run it).
  const decisionsDir = path.join(devMemoryRoot, 'Dev-Memory', 'decisions');
  let decisionFiles = [];
  try {
    decisionFiles = fs.readdirSync(decisionsDir).filter((f) => /roster/i.test(f));
  } catch {
    decisionFiles = [];
  }

  if (decisionFiles.length === 0) {
    // No per-project baseline — try the committed product baseline.
    const rosterFile = path.join(pluginRoot, 'ROSTER.md');
    let rosterText = null;
    try { rosterText = fs.readFileSync(rosterFile, 'utf8'); } catch { rosterText = null; }
    if (rosterText === null) {
      console.log(JSON.stringify({ status: 'BLOCKED', reason: `agents/ has ${currentCount} roles but no Dev-Memory/decisions/*roster*.md baseline and no committed ROSTER.md to check against`, currentCount }, null, 2));
      process.exit(1);
    }
    const rm = /role count[^0-9]*(\d+)/i.exec(rosterText) || /baseline[^0-9]*(\d+)/i.exec(rosterText);
    if (!rm) {
      console.log(JSON.stringify({ status: 'BLOCKED', reason: `ROSTER.md exists but states no numeric "role count: <n>"`, currentCount }, null, 2));
      process.exit(1);
    }
    const recordedBaseline = parseInt(rm[1], 10);
    if (currentCount > recordedBaseline) {
      console.log(JSON.stringify({ status: 'BLOCKED', reason: `agents/ has ${currentCount} roles, exceeding the committed ROSTER.md baseline of ${recordedBaseline} — update ROSTER.md with a named reason before this count is acceptable`, currentCount, recordedBaseline, source: 'ROSTER.md' }, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify({ status: 'clean', currentCount, recordedBaseline, source: 'ROSTER.md' }, null, 2));
    process.exit(0);
  }

  // Most recent by filename (decision files are named YYYY-MM-DD-*.md, so
  // lexical sort on the date-prefixed name is chronological).
  decisionFiles.sort();
  const latest = decisionFiles[decisionFiles.length - 1];
  const text = fs.readFileSync(path.join(decisionsDir, latest), 'utf8');
  const m = /role count[^0-9]*(\d+)/i.exec(text) || /baseline[^0-9]*(\d+)/i.exec(text);
  if (!m) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: `latest roster decision file (${latest}) doesn't state a numeric baseline`, currentCount }, null, 2));
    process.exit(1);
  }
  const recordedBaseline = parseInt(m[1], 10);

  if (currentCount > recordedBaseline) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: `agents/ has ${currentCount} roles, exceeding the last recorded baseline of ${recordedBaseline} (${latest}) — add a new *roster* decision file naming the gap and reason before this count is acceptable`, currentCount, recordedBaseline, latestDecisionFile: latest }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: 'clean', currentCount, recordedBaseline, latestDecisionFile: latest }, null, 2));
  process.exit(0);
}

main();
