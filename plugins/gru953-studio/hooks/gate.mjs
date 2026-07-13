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
import { fileURLToPath } from 'node:url';
import { allow, deny, readStdin, extractCommand, extractCwd, findStudioRoot, isPushCapable, normalizeForPushCheck, LEXICAL_BOUNDARY } from './lib.mjs';

// 2026-07-12 Claude-Topics compliance fix: the deny() messages below used to
// embed the literal, un-substituted text "${CLAUDE_PLUGIN_ROOT}" — Claude
// Code only substitutes that placeholder in a hook's OWN command/args
// fields before running it, not in text the hook writes back out. If Claude
// copies the remediation command verbatim into a fresh Bash call, that
// call's shell has no such variable set (hooks.md: it's exported onto the
// spawned hook process itself, not into "Claude Code's own environment"),
// so the placeholder expands to empty and the path breaks. gate.mjs's own
// process DOES have it set (same export), so resolve it once here and
// interpolate the real value, with a fallback computed from this file's own
// location in case the env var is ever unset for some other invocation path.
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// 2026-07-12 Round 7 audit fix (real TOCTOU gap, found by direct code
// reading, not a text-obfuscation bypass — a different bug class): neither
// confirmation record was ever deleted by any code path (confirm-
// publish.mjs's deletion was prose-only, in the publish skill's own
// instructions to the agent; GO-PUBLIC-APPROVED had no deletion path
// anywhere at all), and the derived token has no session or command
// nonce — so a legitimately-written record authorised an UNBOUNDED number
// of later commands, in later sessions, not just the one push/visibility
// change the user actually confirmed. A bounded validity window (this
// generous but finite, since the real multi-step publish sequence — push,
// tag, release create, release upload — normally completes in minutes)
// closes the "valid forever" failure mode as defense in depth alongside
// the still-recommended explicit delete, without needing to plumb a
// session/command identity through the hook (which the PreToolUse stdin
// payload does not reliably expose across tool types).
const CONFIRMATION_TTL_MS = 60 * 60 * 1000; // 60 minutes
function issuedWithinTtl(text) {
  const m = /^ISSUED:(\d+)$/m.exec(text);
  if (!m) return false; // no timestamp recorded -> fails closed, not open
  const issuedAt = parseInt(m[1], 10);
  return Number.isFinite(issuedAt) && Date.now() - issuedAt <= CONFIRMATION_TTL_MS && Date.now() - issuedAt >= 0;
}
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
    if (line.trim() === expected) return issuedWithinTtl(text);
  }
  return false;
}

// 2026-07-10 audit fix (MAJOR): "private first, then a separate explicit
// step to go public" was previously prose-only — nothing stopped
// `gh repo create ... --public` or `gh repo edit ... --visibility public`
// from running as soon as the (private-scoped) publish token existed. A
// second, differently-derived token now specifically gates any
// public-visibility command.
// 2026-07-11 Round 5 audit fix (CRITICAL, found live via the real hook
// interface, not just read): this matched RAW, un-normalized command text,
// so every obfuscation technique isPushCapable() spent four rounds closing
// — IFS-splicing (`gh${IFS}repo${IFS}edit`), quote-tolerance around the
// `gh`/`repo`/`edit` tokens (`gh "repo" "edit"`), and a quoted flag VALUE
// (`--visibility="public"`) — was never ported here. Reproduced live: with
// only the private-publish token recorded, `gh repo edit me/app
// --visibility="public"` was ALLOWED with no go-public confirmation at
// all, defeating the "private-then-public, separately confirmed" guarantee
// that is one of this project's settled gold-standard decisions. Fixed by
// normalizing the command the same way isPushCapable() does, and adding
// the same quote-tolerance around every token and the flag value.
// 2026-07-11 Round 8 audit fix (CRITICAL, same root cause as the
// isPushCapable fix in lib.mjs): this matched `gh`/`repo`/`create`/`edit`/
// `--public`/`--visibility` as literal case-sensitive text, but on the
// case-insensitive filesystems this plugin targets, `GH repo edit me/app
// --visibility public` is not obfuscation — bash resolves `GH` to the same
// real `gh` binary as lowercase `gh`, unchanged, so the command executes
// exactly as typed. Added `/i` throughout to match.
// 2026-07-12 audit fix (CRITICAL, found by execution): the bare `--public`
// alternative required a trailing space/tab or true end-of-string, so
// `--public;`, `--public|cat`, `--public)` etc. all failed to match —
// isGoPublicCommand() returned false and the command fell through to the
// ordinary PRIVATE-publish check instead, so `gh repo edit me/app --public;`
// was allowed on the private-publish token alone, with no go-public
// confirmation at all. Reproduced live: with only PUBLISH-APPROVED recorded
// (no GO-PUBLIC-APPROVED), that exact command was `allow`ed. Uses the same
// LEXICAL_BOUNDARY fix as lib.mjs's isPushCapable — see that file for the
// full explanation of why `([ \t]|$)` was too narrow a boundary.
function isGoPublicCommand(rawC) {
  const c = normalizeForPushCheck(rawC);
  return /(^|[^A-Za-z0-9_])['"]?gh['"]?[ \t]+['"]?repo['"]?[ \t]+['"]?(create|edit)['"]?/i.test(c) &&
    (new RegExp(`--public['"]?${LEXICAL_BOUNDARY}`, 'i').test(c) || /--visibility['"]?[ \t=]+['"]?(public|internal)['"]?/i.test(c));
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
    if (line.trim() === expected) return issuedWithinTtl(text);
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
    deny(`studio gate: refusing to change visibility to public — going public is a separate, explicit step from the private publish. Record it by running "node \\"${PLUGIN_ROOT}/hooks/confirm-go-public.mjs\\"" from the project root, only after the user has explicitly confirmed via its own pop-up (distinct from the private-publish confirmation).`);
  }

  if (publishConfirmed(STUDIO_ROOT)) {
    allow();
  }
  deny(`studio gate: refusing to push — this is a studio project but the user's publish confirmation has not been recorded. Pushing happens only after the user confirms; record that by running "node \\"${PLUGIN_ROOT}/hooks/confirm-publish.mjs\\"" from the project root, which writes the project-bound line Dev-Memory/PUBLISH-APPROVED expects. Reach the Publish stage (or run /studio-publish) and confirm publishing first.`);
}

main();
