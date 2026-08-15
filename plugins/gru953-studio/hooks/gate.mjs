#!/usr/bin/env node
//
// gate.mjs — GRU953-Studio publish-phase gate (PreToolUse, matcher "Bash").
// Zero dependencies (Node stdlib only). Self-contained: no external state store.
//
// This is the second of the studio's two Bash hooks. scan.mjs proves the
// would-ship set is free of secrets; gate.mjs proves the studio is actually
// meant to be pushing right now. An ordinary (private) push-capable command
// is allowed when ANY ONE of three project-bound confirmation records exists
// and is still within its TTL window: PUBLISH-APPROVED, CHECKPOINT-APPROVED,
// or MEMORY-PERSIST-APPROVED (a public visibility change additionally
// requires GO-PUBLIC-APPROVED — see the code below). The studio writes the
// relevant file right after the user confirms that action (2026-07-26
// correction: this comment previously said the record is "removed once the
// push is done" — that was never true of any of these tokens; see the
// TOCTOU note just below, which already correctly says so. The record
// instead expires on its own after a bounded TTL). With no valid record a
// push is blocked, so a push-capable command cannot fire outside an
// authorised moment even if the secret scan happens to pass on a clean tree.
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
import {
  stepAside,
  authorise,
  escalate,
  deny,
  readStdin,
  extractCommand,
  extractCwd,
  findStudioRoot,
  isPushCapable,
  normalizeForPushCheck,
  exceedsAssignmentBound,
  LEXICAL_BOUNDARY,
  tokenConfirmedWithinTtl,
} from './lib.mjs';

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
const PLUGIN_ROOT =
  process.env.CLAUDE_PLUGIN_ROOT ||
  process.env.ANTIGRAVITY_PLUGIN_ROOT ||
  process.env.PLUGIN_ROOT ||
  path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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
// 2026-07-26 further-pass audit fix: withinTtl/tokenConfirmedWithinTtl moved to
// lib.mjs (see there for the full finding-12 history) so scan.mjs's separate
// MEMORY-PERSIST-APPROVED consumer can share the exact same, already-fixed
// binding logic instead of carrying its own independent, un-fixed copy.
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
  return tokenConfirmedWithinTtl(text, expected);
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
  // 2026-08-07 audit fix, the sibling of the bound added to isPushCapable (see
  // lib.mjs for the full reasoning and the measured cost curve). Past
  // MAX_RESOLVED_ASSIGNMENTS the variable resolution is skipped, so a
  // `--visibility=$v` in this command is unresolved text and this function
  // cannot prove the command is NOT a visibility change. The guarantee this
  // gate exists for — going public is always separately confirmed — is only
  // safe if the unprovable case is treated as go-public. Such a command is
  // never legitimate, so requiring GO-PUBLIC-APPROVED for it costs nothing real.
  if (exceedsAssignmentBound(rawC)) return true;
  const c = normalizeForPushCheck(rawC);
  // `gh repo create|edit ... --public` / `--visibility public|internal`
  // 2026-07-21 Round 12 audit fix (HIGH): the standalone `--internal` flag was
  // NOT matched — only `--public` and `--visibility public|internal` were. But
  // `gh repo create` has no `--visibility` flag; its three standalone visibility
  // flags are `--public`/`--private`/`--internal`, and an internal repo is
  // visible to the whole org/enterprise, i.e. NOT private. The project already
  // treats internal as go-public (`--visibility internal` and the gh api
  // public|internal fields are in the go-public set), so a private-scope token
  // (including a routine checkpoint) must not authorise `gh repo create --internal`.
  // `--private` stays out (the studio's own publish uses `gh repo create --private`).
  const repoVisibility =
    /(^|[^A-Za-z0-9_])['"]?gh['"]?[ \t]+['"]?repo['"]?[ \t]+['"]?(create|edit)['"]?/i.test(c) &&
    (new RegExp(`--(public|internal)['"]?${LEXICAL_BOUNDARY}`, 'i').test(c) ||
      /--visibility['"]?[ \t=]+['"]?(public|internal)['"]?/i.test(c));
  // 2026-07-21 audit fix: the same visibility change performed via `gh api` (the
  // raw REST interface) — e.g. `gh api -X PATCH repos/me/app -f visibility=public`,
  // `-F private=false`, or an inline JSON body `{"visibility":"public"}`.
  // isPushCapable() now treats a `gh api` write as push-capable, so such a command
  // reaches here; this makes a visibility-to-public write require the separate
  // GO-PUBLIC-APPROVED token, not merely the private-publish one.
  const isGhApi = /(^|[^A-Za-z0-9_])['"]?gh['"]?[ \t]+['"]?api['"]?([ \t]|$)/i.test(c);
  // 2026-07-21 Round 4 fix: only honour a private/visibility signal when it is an
  // actual gh api FIELD flag (`-f private=true`, `-fprivate=true`,
  // `--field visibility=private`), NOT an incidental substring inside some other
  // field's VALUE (e.g. `-f description="toggle private=true"`), which previously
  // over-matched and let a public repo-create ride the private-publish token.
  // 2026-07-21 Round 8 fix: `[ \t=]*` (was `[ \t]*`) so the attached-equals long
  // form `--field=visibility=public` / `-f=...` is consumed too — pflag accepts it,
  // and it previously slipped past the go-public gate (a public change authorised on
  // the private-publish token). Mirrors isPushCapable's `[ \t=]` field-flag tolerance.
  const FIELD = `(?:-[fF]|--field|--raw-field)[ \\t=]*['"]?`;
  // 2026-08-07 audit fix (CRITICAL, found by execution through the real hook
  // interface, exactly like the Round 5 and Round 8 fixes above). The comment
  // block above has claimed since 2026-07-21 that this covers "an inline JSON
  // body `{"visibility":"public"}`" — it never did. Every pattern here
  // required a gh api FIELD FLAG (-f/-F/--field/--raw-field), but `gh api`
  // equally takes its whole body as JSON on stdin via `--input`, and the JSON
  // sits in the command text where a field flag never appears. Reproduced
  // live against a project with ONLY PUBLISH-APPROVED recorded (no
  // GO-PUBLIC-APPROVED): both
  //   gh api -X PATCH repos/me/app --input - <<< '{"visibility":"public"}'
  //   echo '{"visibility":"public"}' | gh api -X PATCH repos/me/app --input -
  // were ALLOWED, with no go-public confirmation at all — defeating the
  // "private first, then a separate explicit step to go public" guarantee
  // that this project treats as settled, and that the `--visibility=public`
  // flag form has been correctly gated on since Round 5. Matched as JSON
  // (`"key" : value`) rather than as a field flag, so the two body forms are
  // judged the same way the flag form already is.
  const JSON_BODY_PUBLIC =
    /"visibility"[ \t]*:[ \t]*['"](public|internal)['"]/i.test(c) ||
    /"private"[ \t]*:[ \t]*(false|0)\b/i.test(c);
  const JSON_BODY_PRIVATE =
    /"visibility"[ \t]*:[ \t]*['"]private['"]/i.test(c) ||
    /"private"[ \t]*:[ \t]*(true|1)\b/i.test(c);
  const apiExplicitPublic =
    new RegExp(`${FIELD}visibility['"]?[ \\t=:]+['"]?(public|internal)`, 'i').test(c) ||
    new RegExp(`${FIELD}private['"]?[ \\t=:]+['"]?(false|0|no)\\b`, 'i').test(c) ||
    JSON_BODY_PUBLIC;
  const apiExplicitPrivate =
    new RegExp(`${FIELD}private['"]?[ \\t=:]+['"]?(true|1|yes)\\b`, 'i').test(c) ||
    new RegExp(`${FIELD}visibility['"]?[ \\t=:]+['"]?private`, 'i').test(c) ||
    JSON_BODY_PRIVATE;
  // The residual the JSON patterns above cannot close: `gh api ... --input
  // body.json` reads its body from a FILE, whose contents are not in the
  // command text and cannot be inspected here at all. A body we cannot read
  // can never PROVE the write is private, so the same fail-closed rule the
  // repo-creation default already uses applies — but scoped to writes aimed
  // at the repository ROOT endpoint (`repos/<owner>/<repo>`, the only repo
  // path whose PATCH body can carry `visibility`/`private`) or a repo-creation
  // endpoint. A sub-resource — `repos/o/r/issues`, `.../dispatches`,
  // `.../releases` — cannot change visibility whatever its body says, so an
  // uninspectable body sent there is not swept up and is never asked for a
  // go-public token it has no business needing.
  const apiUninspectableBody = /--input[ \t=]+['"]?(?!-['"\s]|-$)[^ \t]/i.test(c);
  const apiRepoRootEndpoint = new RegExp(
    `\\/?repos\\/[^ \\t/'"]+\\/[^ \\t/'"]+['"]?${LEXICAL_BOUNDARY}`,
    'i',
  ).test(c);
  // 2026-07-21 Round 2 fix: GitHub's REST default for repo creation is
  // `private:false` = PUBLIC, so a `gh api` write to a repo-creation endpoint
  // (/user/repos or orgs/<org>/repos) with visibility OMITTED still makes a public
  // repo — it must need the go-public token unless it explicitly asks for private.
  // (isPushCapable has already established this is a gh api WRITE before we get here.)
  // 2026-07-21 Round 3 fix: also match the THIRD repo-creation endpoint,
  // POST /repos/<owner>/<template>/generate (create-from-template), whose `private`
  // default is also false = PUBLIC — the Round 2 fix covered only /user/repos and
  // orgs/<org>/repos.
  const apiRepoCreate =
    /\/?(user\/repos|orgs\/[^ \t/'"]+\/repos|repos\/[^ \t/'"]+\/[^ \t/'"]+\/generate)\b/i.test(c);
  const apiVisibility =
    isGhApi &&
    (apiExplicitPublic ||
      (apiRepoCreate && !apiExplicitPrivate) ||
      (apiUninspectableBody && (apiRepoCreate || apiRepoRootEndpoint) && !apiExplicitPrivate));
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
  return tokenConfirmedWithinTtl(text, expected);
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
  return tokenConfirmedWithinTtl(text, expected);
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
  return tokenConfirmedWithinTtl(text, expected);
}

// 2026-08-13, independent-review finding F4. An approval covers the WHOLE command
// string, so a token must never approve a push with extra segments welded on.
// Anything that could run a second command — a separator, a pipe, a background
// `&`, a newline, or a substitution — means this is not the single confirmed
// action, and the decision goes to the user instead of being granted silently.
//
// 2026-08-15, finding X107 (High, reproduced). This read `/[;&|\n]|\$\(|`/` and so
// caught `$( )` and backticks but NOT bash process substitution, `<( )` and `>( )`.
// Bash executes the inside of a process substitution as a genuine second command:
//
//     bash -c 'echo "outer saw: $1"' _ <(echo "INNER RAN" >&2)
//       INNER RAN
//       outer saw: /dev/fd/12
//
// So `git push origin main <(rm -rf …)` was judged a single confirmed action and
// granted `allow` — and `allow` does not mean "no objection", it SUPPRESSES the
// permission prompt the user would otherwise have seen, for the whole string. The
// comment above already named "a substitution" as disqualifying, so the intent was
// right and only the pattern was short; X107 is a gap, not a missing feature.
//
// Chained with X91/X100 (the approval token is self-issuable — sha256 of the
// project path, and confirm-publish.mjs issues one with stdin closed) this was the
// most serious item on the register: self-issue a token, hide anything inside
// `<(…)`, receive a silent allow. Fixing this closes the second half of that chain.
//
// NOT the gap disclosed at hooks.test.mjs:1914 — that is `isPushCapable` failing to
// SEE a hidden push, which fails safe to a normal prompt. This ran the other way.
//
// Deliberately NOT widened to bare `<` or `>`. A plain redirect writes a file but
// does not run a second command, which is what this guard is specified to catch;
// `git push … > log.txt` still receives `allow` today. Whether an approval should
// also cover redirection is a separate question, raised as X108 rather than settled
// silently here — widening it would add prompts to ordinary use, and a gate that
// cries wolf gets routed around (lesson L5).
//
// Reproduction: hooks/test/repro/X107-process-substitution.mjs — six cases, four of
// them controls, red at the parent commit and green here.
const MULTI_COMMAND_RE = /[;&|\n]|\$\(|<\(|>\(|`/;
function authoriseOnlyIfSingleCommand(cmd, what, reason) {
  if (MULTI_COMMAND_RE.test(String(cmd))) {
    escalate(
      `studio gate: ${what} was confirmed for this project, but this command does more than that one thing ` +
        `(it contains a separator, pipe, background "&", newline or substitution), and an authorisation covers the ` +
        `WHOLE command. Asking you to confirm this exact command rather than approving it silently. ` +
        `Running the ${what} on its own line will be authorised without this prompt.`,
    );
  }
  authorise(reason);
}

function main() {
  // 2026-07-31 maintenance fix (F1): readStdin() now throws StdinReadFailure
  // rather than returning '' when it could not reliably read the tool-call
  // payload (see lib.mjs). Losing the payload here means losing both the
  // command text AND the cwd, which can make the studio-run check below
  // stand down (allow) on a command this gate never actually inspected —
  // exactly the failure this gate exists to prevent. Deny, don't allow, when
  // the read itself could not be trusted.
  let INPUT;
  try {
    INPUT = readStdin();
  } catch (e) {
    deny(
      `studio gate: refusing to allow — could not reliably read the tool-call payload from ` +
        `stdin (${e && e.message ? e.message : 'read failure'}). This can happen under a ` +
        `transient timing race between this hook and the process invoking it. Retry the ` +
        `command; refusing to let an unread command through unauthorised.`,
    );
  }
  // 2026-07-31 further maintenance fix (R1 part 2, defence in depth): a
  // NON-EMPTY stdin payload that isn't valid JSON is not "no input" — it is
  // evidence of a read that produced something untrustworthy (truncated,
  // corrupted, or otherwise malformed), which extractCommand()/extractCwd()
  // both quietly turn into '' on a parse failure. Falling through on that ''
  // the same way genuinely-empty stdin does is exactly the bypass a lost or
  // truncated read created (see lib.mjs's readStdinCore fix above this same
  // maintenance pass): isPushCapable('') fails closed, but extractCwd('')
  // falling back to this process's own cwd can still resolve the WRONG
  // studio root and stand aside on a command this gate never actually inspected.
  // Denying here closes that residual regardless of how a future caller
  // might reintroduce a partial read. A genuinely empty string (real "no
  // data") is unaffected — only "got something, but it doesn't parse" denies.
  if (INPUT !== '') {
    try {
      JSON.parse(INPUT);
    } catch {
      deny(
        `studio gate: refusing to allow — the tool-call payload read from stdin is non-empty ` +
          `but is not valid JSON, so its command and working directory cannot be trusted. This ` +
          `can happen under a partial/corrupted read. Retry the command; refusing to let an ` +
          `unparsed payload fall through to an unchecked command.`,
      );
    }
  }
  const CMD = extractCommand(INPUT);

  if (!isPushCapable(CMD)) {
    // Not push-capable: this gate has no business here. Emit NO decision so the
    // command continues through Claude Code's normal permission flow (X1).
    stepAside();
  }

  const SESSION_DIR = extractCwd(INPUT) || process.cwd();
  const STUDIO_ROOT = findStudioRoot(SESSION_DIR);
  if (STUDIO_ROOT === null) {
    // Not a studio project: never interfere with someone else's repository.
    stepAside();
  }

  // A command asking for PUBLIC (or internal) visibility needs its own,
  // separately-recorded confirmation — the ordinary publish token only ever
  // proves a PRIVATE publish was confirmed.
  if (isGoPublicCommand(CMD)) {
    if (goPublicConfirmed(STUDIO_ROOT)) {
      authoriseOnlyIfSingleCommand(
        CMD,
        'going public',
        'studio gate: going public was explicitly confirmed for this project and the record is still within its time limit.',
      );
    }
    deny(
      `studio gate: refusing to change visibility to public — going public is a separate, explicit step from the private publish. Record it by running "node \\"${PLUGIN_ROOT}/hooks/confirm-go-public.mjs\\"" from the project root, only after the user has explicitly confirmed via its own pop-up (distinct from the private-publish confirmation).`,
    );
  }

  // An ordinary (private) push is allowed by a publish confirmation, a per-phase
  // checkpoint confirmation, OR an opt-in memory-persistence confirmation. All
  // three are private-only: the go-public gate above has already run and is
  // unaffected by any of them.
  if (
    publishConfirmed(STUDIO_ROOT) ||
    checkpointConfirmed(STUDIO_ROOT) ||
    memoryPersistConfirmed(STUDIO_ROOT)
  ) {
    authoriseOnlyIfSingleCommand(
      CMD,
      'the push',
      'studio gate: a push authorisation (publish, per-phase checkpoint, or opt-in memory persistence) was explicitly confirmed for this project and is still within its time limit. Private push only.',
    );
  }
  deny(
    `studio gate: refusing to push — this is a studio project but no push authorisation (publish or per-phase checkpoint) has been recorded. Pushing happens only after it is confirmed; record a publish by running "node \\"${PLUGIN_ROOT}/hooks/confirm-publish.mjs\\"" (reach the Publish stage or run /studio-publish first), or a per-phase backup checkpoint by running "node \\"${PLUGIN_ROOT}/hooks/confirm-checkpoint.mjs\\"" once the phase's quality gate is clean. Both write a project-bound record and authorise a PRIVATE push only.`,
  );
}

main();
