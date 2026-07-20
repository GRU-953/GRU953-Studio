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
  // `gh repo create|edit ... --public` / `--visibility public|internal`
  const repoVisibility = /(^|[^A-Za-z0-9_])['"]?gh['"]?[ \t]+['"]?repo['"]?[ \t]+['"]?(create|edit)['"]?/i.test(c) &&
    (new RegExp(`--public['"]?${LEXICAL_BOUNDARY}`, 'i').test(c) || /--visibility['"]?[ \t=]+['"]?(public|internal)['"]?/i.test(c));
  // 2026-07-21 audit fix: the same visibility change performed via `gh api` (the
  // raw REST interface) — e.g. `gh api -X PATCH repos/me/app -f visibility=public`,
  // `-F private=false`, or an inline JSON body `{"visibility":"public"}`.
  // isPushCapable() now treats a `gh api` write as push-capable, so such a command
  // reaches here; this makes a visibility-to-public write require the separate
  // GO-PUBLIC-APPROVED token, not merely the private-publish one.
  const isGhApi = /(^|[^A-Za-z0-9_])['"]?gh['"]?[ \t]+['"]?api['"]?([ \t]|$)/i.test(c);
  const apiExplicitPublic = /visibility['"]?[ \t=:]+['"]?(public|internal)/i.test(c) || /private['"]?[ \t=:]+['"]?(false|0|no)\b/i.test(c);
  const apiExplicitPrivate = /private['"]?[ \t=:]+['"]?(true|1|yes)\b/i.test(c) || /visibility['"]?[ \t=:]+['"]?private/i.test(c);
  // 2026-07-21 Round 2 fix: GitHub's REST default for repo creation is
  // `private:false` = PUBLIC, so a `gh api` write to a repo-creation endpoint
  // (/user/repos or orgs/<org>/repos) with visibility OMITTED still makes a public
  // repo — it must need the go-public token unless it explicitly asks for private.
  // (isPushCapable has already established this is a gh api WRITE before we get here.)
  // 2026-07-21 Round 3 fix: also match the THIRD repo-creation endpoint,
  // POST /repos/<owner>/<template>/generate (create-from-template), whose `private`
  // default is also false = PUBLIC — the Round 2 fix covered only /user/repos and
  // orgs/<org>/repos.
  const apiRepoCreate = /\/?(user\/repos|orgs\/[^ \t/'"]+\/repos|repos\/[^ \t/'"]+\/[^ \t/'"]+\/generate)\b/i.test(c);
  const apiVisibility = isGhApi && (apiExplicitPublic || (apiRepoCreate && !apiExplicitPrivate));
  return repoVisibility || apiVisibility;
}
function goPublicToken(studioRoot) {
  return crypto.createHash('sha256').update(`studio-go-public:${studioRoot}`).digest('hex');
}

// 2026-07-19 (Phase 3 — per-phase checkpoint commits, see the
// `checkpoint-commit` skill). A checkpoint token authorises an ORDINARY
// (private) push only — a per-phase backup of the app's code to a private work
// branch. It is deliberately a DIFFERENT, project-bound token from the publish
// one, and it is checked ONLY in the ordinary-push branch below, AFTER the
// go-public gate. So a checkpoint token can never satisfy the go-public check
// (that still needs its own GO-PUBLIC-APPROVED token, checked first), i.e. a
// checkpoint can never make a repository public — the one guarantee that
// matters most stays intact. scan.mjs still runs on every push regardless, so
// a checkpoint can never ship a secret or the private Dev-Memory folder either.
function checkpointToken(studioRoot) {
  return crypto.createHash('sha256').update(`studio-checkpoint:${studioRoot}`).digest('hex');
}
function checkpointConfirmed(studioRoot) {
  const record = path.join(studioRoot, 'Dev-Memory', 'CHECKPOINT-APPROVED');
  let text;
  try {
    fs.accessSync(record, fs.constants.R_OK);
    text = fs.readFileSync(record, 'utf8');
  } catch {
    return false;
  }
  const expected = `STUDIO-CHECKPOINT-CONFIRMED:${checkpointToken(studioRoot)}`;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === expected) return issuedWithinTtl(text);
  }
  return false;
}

// 2026-07-19 (Phase 4 — opt-in cloud memory persistence). Same shape and same
// confinement as the checkpoint token: it authorises an ORDINARY (private) push
// only, is checked AFTER the go-public gate below, and never satisfies it — so
// persisted memory can never go to a PUBLIC repository. scan.mjs separately
// still runs the full secret scan on the pushed Dev-Memory files.
function memoryPersistToken(studioRoot) {
  return crypto.createHash('sha256').update(`studio-memory-persist:${studioRoot}`).digest('hex');
}
function memoryPersistConfirmed(studioRoot) {
  const record = path.join(studioRoot, 'Dev-Memory', 'MEMORY-PERSIST-APPROVED');
  let text;
  try {
    fs.accessSync(record, fs.constants.R_OK);
    text = fs.readFileSync(record, 'utf8');
  } catch {
    return false;
  }
  const expected = `STUDIO-MEMORY-PERSIST-CONFIRMED:${memoryPersistToken(studioRoot)}`;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === expected) return issuedWithinTtl(text);
  }
  return false;
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

  // An ordinary (private) push is allowed by a publish confirmation, a per-phase
  // checkpoint confirmation, OR an opt-in memory-persistence confirmation. All
  // three are private-only: the go-public gate above has already run and is
  // unaffected by any of them.
  if (publishConfirmed(STUDIO_ROOT) || checkpointConfirmed(STUDIO_ROOT) || memoryPersistConfirmed(STUDIO_ROOT)) {
    allow();
  }
  deny(`studio gate: refusing to push — this is a studio project but no push authorisation (publish or per-phase checkpoint) has been recorded. Pushing happens only after it is confirmed; record a publish by running "node \\"${PLUGIN_ROOT}/hooks/confirm-publish.mjs\\"" (reach the Publish stage or run /studio-publish first), or a per-phase backup checkpoint by running "node \\"${PLUGIN_ROOT}/hooks/confirm-checkpoint.mjs\\"" once the phase's quality gate is clean. Both write a project-bound record and authorise a PRIVATE push only.`);
}

main();
