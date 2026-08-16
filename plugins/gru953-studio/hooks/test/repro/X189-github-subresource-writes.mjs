#!/usr/bin/env node
//
// Reproduction for X189 (High, P6 convergence round 2) — ordinary GitHub REST writes are
// hard-denied as though they were a change of repository visibility.
//
// THE DEFECT. gate.mjs fails closed on a `gh api` write whose body it cannot read (`--input
// FILE`), because such a body could carry `visibility: public`. That rule is right, and it is
// deliberately scoped: its own comment at gate.mjs:226-231 says
//
//     "A sub-resource — `repos/o/r/issues`, `.../dispatches`, `.../releases` — cannot change
//      visibility whatever its body says, so an uninspectable body sent there is not swept up
//      and is never asked for a go-public token it has no business needing."
//
// The scoping does not work. The endpoint test is
//
//     new RegExp(`\\/?repos\\/[^ \\t/'"]+\\/[^ \\t/'"]+['"]?${LEXICAL_BOUNDARY}`, 'i')
//
// and LEXICAL_BOUNDARY is `(?![A-Za-z0-9_])` — a lookahead that a following `/` SATISFIES. So
// `repos/me/app/issues` matches the "repository root" test, and filing an issue is refused with
// a message about going public. The comment, and CHANGELOG.md's account of the same fix, both
// state something measurably untrue.
//
// WHY THE PROJECT'S OWN TEST DID NOT CATCH IT. hooks.test.mjs carries a test named "does not
// over-block writes that cannot change visibility". Its only sub-resource `--input` case is
//
//     gh api -X POST repos/me/app/dispatches --input payload.json -f private=true
//
// and `-f private=true` sets apiExplicitPrivate, which clears the command through an entirely
// different branch. Strip that one flag and the identical command is denied. The test passes
// green without ever reaching the predicate it exists to protect. Case B below is that command
// with the flag removed, so the gap cannot reopen.
//
// WHAT THIS FIX DELIBERATELY DOES NOT RELAX. Three endpoint families really can make things
// public, and all three must stay denied on a private-publish token alone:
//   * the repository ROOT, `repos/o/r` — the only path whose PATCH body carries `visibility`;
//   * repository CREATION — `user/repos`, `orgs/X/repos`, `repos/o/tmpl/generate` — where
//     GitHub's own default is `private:false`, i.e. public;
//   * GitHub PAGES, `repos/o/r/pages` — which publishes the repository's content on the web.
//     Pages is a sub-resource, so the narrow reading of this finding would have un-denied it.
//     It is named explicitly instead, and control F pins that.
//
//   case                                                    required
//   A  POST repos/o/r/issues     --input f.json              ask   <- X189
//   B  POST repos/o/r/dispatches --input f.json              ask   <- X189 (the test's blind spot)
//   C  POST repos/o/r/releases   --input f.json              ask   <- X189
//   D  PATCH repos/o/r           --input f.json              deny  (control: the root is the point)
//   E  POST user/repos           --input f.json              deny  (control: creation defaults public)
//   F  POST repos/o/r/pages      --input f.json              deny  (control: Pages publishes)
//   G  PATCH repos/o/r -f visibility=public                  deny  (control: the plain case)
//   H  a plain READ of a sub-resource                        ask   (control: still a gh write path)
//   I  case D again, after GO-PUBLIC is recorded             ask   (control: it gates, not forbids)
//
// Controls D to G are the whole safety argument: without them, "case A asks" could be produced
// by a gate that has stopped objecting to anything.
//
// Usage:
//   node X189-github-subresource-writes.mjs                # asserts the FIXED state
//   node X189-github-subresource-writes.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readDecision, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** A project carrying an ordinary PRIVATE publish approval — never a go-public one. */
function decide(cmd, alsoGoPublic) {
  const root = mkdtempSync(join(tmpdir(), 'x189-'));
  try {
    mkdirSync(join(root, 'Dev-Memory'), { recursive: true });
    const p = spawnSync(NODE, [join(HOOKS, 'confirm-publish.mjs'), root], { encoding: 'utf8' });
    if (p.status !== 0) die(`confirm-publish.mjs exited ${p.status}: ${p.stderr}`);
    if (alsoGoPublic) {
      const g = spawnSync(NODE, [join(HOOKS, 'confirm-go-public.mjs'), root], { encoding: 'utf8' });
      if (g.status !== 0) die(`confirm-go-public.mjs exited ${g.status}: ${g.stderr}`);
    }
    const v = refuseCrash(
      readDecision(NODE, join(HOOKS, 'gate.mjs'), { tool_name: 'Bash', tool_input: { command: cmd }, cwd: root }),
      'X189-github-subresource-writes.mjs',
      die,
    );
    return v.kind === 'silent'
      ? { decision: 'no decision', reason: '' }
      : { decision: v.decision, reason: v.reason };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The sentence the visibility branch emits, and no other branch does. Asserting on it stops a
// case from "passing" because some unrelated rule happened to deny the same command.
const VIS_MARKER = 'refusing to change visibility to public';

const CASES = [
  { id: 'A', cmd: 'gh api --method POST repos/me/app/issues --input issue.json', want: 'ask', target: true,
    role: 'file an issue' },
  { id: 'B', cmd: 'gh api --method POST repos/me/app/dispatches --input payload.json', want: 'ask', target: true,
    role: "trigger a workflow — the suite's blind spot, minus `-f private=true`" },
  { id: 'C', cmd: 'gh api --method POST repos/me/app/releases --input rel.json', want: 'ask', target: true,
    role: 'cut a release' },
  { id: 'D', cmd: 'gh api --method PATCH repos/me/app --input body.json', want: 'deny', target: false,
    role: 'control: the repository ROOT can carry visibility' },
  { id: 'E', cmd: 'gh api --method POST user/repos --input body.json', want: 'deny', target: false,
    role: "control: creation's GitHub default is public" },
  { id: 'F', cmd: 'gh api --method POST repos/me/app/pages --input body.json', want: 'deny', target: false,
    role: 'control: Pages publishes the repository on the web' },
  { id: 'G', cmd: 'gh api --method PATCH repos/me/app -f visibility=public', want: 'deny', target: false,
    role: 'control: the plain, readable visibility change' },
];

let controlsOk = true;
let visMarkerSeen = false;
const stillDenied = [];

for (const c of CASES) {
  const { decision, reason } = decide(c.cmd, false);
  const sawVis = reason.includes(VIS_MARKER);
  if (sawVis) visMarkerSeen = true;
  const ok = decision === c.want;
  console.log(
    `  ${ok ? 'ok  ' : 'BAD '} ${c.id}  want=${c.want.padEnd(4)} got=${String(decision).padEnd(11)} ${c.role}`,
  );
  if (ok) continue;
  // The X189 defect looks exactly like this: an ordinary sub-resource write denied, and denied
  // specifically by the VISIBILITY branch rather than by some unrelated rule.
  if (c.target && decision === 'deny' && sawVis) stillDenied.push(c.id);
  else controlsOk = false;
}

// ---- H: a read must not be swept up either ----------------------------------
const H = decide('gh api repos/me/app/issues', false);
if (H.reason.includes(VIS_MARKER)) {
  controlsOk = false;
  console.log(`  BAD  H  a plain READ was called a visibility change: ${H.decision}`);
} else {
  console.log(`  ok   H  a plain read is not called a visibility change (got ${H.decision})`);
}

// ---- I: the rule gates rather than forbids ----------------------------------
const I = decide('gh api --method PATCH repos/me/app --input body.json', true);
if (I.decision !== 'ask') {
  controlsOk = false;
  console.log(`  BAD  I  with GO-PUBLIC recorded, the root write must reach the user: got ${I.decision}`);
} else {
  console.log('  ok   I  with GO-PUBLIC recorded, the root write reaches the user (gates, not forbids)');
}

if (!visMarkerSeen) {
  die(
    `no case produced the visibility message ("${VIS_MARKER}"). Either that branch was removed or ` +
      'its wording changed, in which case every result above is meaningless — a gate that never ' +
      'mentions visibility would make the X189 cases pass for entirely the wrong reason.',
  );
}

if (!controlsOk) {
  die(
    'a CONTROL is wrong, so nothing this script says about X189 can be trusted. In particular a ' +
      'gate that has stopped denying visibility changes would make cases A to C pass while being ' +
      'far more dangerous than the defect they describe. Fix the control first.',
  );
}

if (expectBug) {
  if (stillDenied.length === 0) {
    die('expected the X189 defect and did not find it. If it was fixed, delete this --expect-bug branch deliberately.');
  }
  console.log(`\nX189 REPRODUCED: ${stillDenied.length} ordinary sub-resource write(s) denied as a visibility change — ${stillDenied.join(', ')}.`);
  process.exit(0);
}

if (stillDenied.length === 0) {
  console.log('\nPASS: a write that cannot change visibility is no longer refused as though it could, and every endpoint that CAN still is.');
  process.exit(0);
}

die(
  `X189 is OPEN: case(s) ${stillDenied.join(', ')} were denied by the visibility branch. The ` +
    'repository-root test ends in LEXICAL_BOUNDARY `(?![A-Za-z0-9_])`, which a following `/` ' +
    'satisfies, so every sub-resource matches the root. Fix: require that no further path segment ' +
    'follows, and name GitHub Pages explicitly as the one sub-resource that really does publish.',
);
