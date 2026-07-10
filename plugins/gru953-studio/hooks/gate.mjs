#!/usr/bin/env node
//
// gate.mjs — GRU953-Studio publish-phase gate (PreToolUse, matcher "Bash").
// Zero dependencies (Node stdlib only). Self-contained: no external state store.
//
// This is the second of the studio's two Bash hooks. scan.mjs proves the
// would-ship set is free of secrets; gate.mjs proves the studio is actually
// meant to be pushing right now. A push-capable command is allowed only when
// the user's publish confirmation has been recorded for this project — the
// studio writes a `Dev-Memory/PUBLISH-APPROVED` file right after the user
// picks "publish", and removes it once the push is done. With no such
// record a push is blocked, so a push-capable command cannot fire outside
// the publish phase even if the secret scan happens to pass on a clean tree.
//
// The record is checked against a token DERIVED from this project, not a
// fixed string: sha256("studio-publish:" + <studio root path>). Deriving the
// expected token from the project's own path means a write only unlocks a
// push if it reproduces the exact hash for THIS studio root — copying a
// generic "confirmed" string, or a token computed for a different project,
// does not match.
//
// Like scan.mjs, this gate governs ONLY studio-initiated pushes: it stands
// down (allows) when no studio project (no Dev-Memory folder) exists
// anywhere up the tree. It FAILS CLOSED: inside a studio run, if the
// confirmation record is missing, unreadable or does not contain the exact
// derived token, the push is denied.
//
// stdout is reserved for the decision JSON.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { allow, deny, readStdin, extractCommand, extractCwd, findStudioRoot, isPushCapable } from './lib.mjs';

function publishToken(studioRoot) {
  return crypto.createHash('sha256').update(`studio-publish:${studioRoot}`).digest('hex');
}
function publishConfirmed(studioRoot) {
  const record = path.join(studioRoot, 'Dev-Memory', 'PUBLISH-APPROVED');
  let text;
  try {
    fs.accessSync(record, fs.constants.R_OK);
    text = fs.readFileSync(record, 'utf8');
  } catch {
    return false;
  }
  const expected = `STUDIO-PUBLISH-CONFIRMED:${publishToken(studioRoot)}`;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === expected) return true;
  }
  return false;
}

// 2026-07-10 audit fix (MAJOR): "private first, then a separate explicit
// step to go public" was previously prose-only — nothing stopped
// `gh repo create ... --public` or `gh repo edit ... --visibility public`
// from running as soon as the (private-scoped) publish token existed. A
// second, differently-derived token now specifically gates any
// public-visibility command.
function isGoPublicCommand(c) {
  return /(^|[^A-Za-z0-9_])gh[ \t]+repo[ \t]+(create|edit)/.test(c) &&
    (/--public([ \t]|$)/.test(c) || /--visibility[ \t=]+(public|internal)/.test(c));
}
function goPublicToken(studioRoot) {
  return crypto.createHash('sha256').update(`studio-go-public:${studioRoot}`).digest('hex');
}
function goPublicConfirmed(studioRoot) {
  const record = path.join(studioRoot, 'Dev-Memory', 'GO-PUBLIC-APPROVED');
  let text;
  try {
    fs.accessSync(record, fs.constants.R_OK);
    text = fs.readFileSync(record, 'utf8');
  } catch {
    return false;
  }
  const expected = `STUDIO-GO-PUBLIC-CONFIRMED:${goPublicToken(studioRoot)}`;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === expected) return true;
  }
  return false;
}

function main() {
  const INPUT = readStdin();
  const CMD = extractCommand(INPUT);

  if (!isPushCapable(CMD)) {
    allow();
  }

  const SESSION_DIR = extractCwd(INPUT) || process.cwd();
  const STUDIO_ROOT = findStudioRoot(SESSION_DIR);
  if (STUDIO_ROOT === null) {
    allow();
  }

  // A command asking for PUBLIC (or internal) visibility needs its own,
  // separately-recorded confirmation — the ordinary publish token only ever
  // proves a PRIVATE publish was confirmed.
  if (isGoPublicCommand(CMD)) {
    if (goPublicConfirmed(STUDIO_ROOT)) {
      allow();
    }
    deny('studio gate: refusing to change visibility to public — going public is a separate, explicit step from the private publish. Record it by running "node \\"${CLAUDE_PLUGIN_ROOT}/hooks/confirm-go-public.mjs\\"" from the project root, only after the user has explicitly confirmed via its own pop-up (distinct from the private-publish confirmation).');
  }

  if (publishConfirmed(STUDIO_ROOT)) {
    allow();
  }
  deny('studio gate: refusing to push — this is a studio project but the user\'s publish confirmation has not been recorded. Pushing happens only after the user confirms; record that by running "node \\"${CLAUDE_PLUGIN_ROOT}/hooks/confirm-publish.mjs\\"" from the project root, which writes the project-bound line Dev-Memory/PUBLISH-APPROVED expects. Reach the Publish stage (or run /studio-publish) and confirm publishing first.');
}

main();
