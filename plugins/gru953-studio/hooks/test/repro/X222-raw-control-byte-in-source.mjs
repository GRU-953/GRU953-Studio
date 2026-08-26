#!/usr/bin/env node
//
// Reproduction for X222 (the systemic half of X204) — nothing detects a raw control byte in a source
// file, so a source file can be invisible to every text tool while every gate reports clean.
//
// X204 recorded that `traceability-check.mjs` contains one raw NUL byte, which makes `file` call it
// "binary data" and makes a default `grep` return NOTHING AT ALL. It was rated Low, as hygiene.
//
// It is not hygiene. On 2026-08-18 it silently blinded two greps of that exact file while I was
// auditing it, and I only noticed because a second empty result was implausible; `grep -a` then
// returned the lines immediately. Any auditor — human or agent — who greps that file without `-a` sees
// an empty file and has no way to know the difference between "no matches" and "cannot read this".
// That is L13 at the level of the toolchain: an instrument that cannot distinguish a broken read from
// a negative result reports the broken read as a negative result. The file it happens in is the one
// carrying the most open findings against it.
//
// The byte is at offset 20169, line 330, inside `join(...)` — the separator introduced by the X193
// fix, written as a LITERAL control byte instead of the escape sequence. The runtime value is
// identical either way; only the source encoding differs. So the repair costs nothing and the check
// below is what stops it returning.
//
//   case                                                        required
//   A  a .mjs carrying a raw NUL byte                            BLOCKED         <- X222
//   B  the same value written as an ESCAPE sequence              quiet (control: the check must ban
//                                                                the raw BYTE, never the value — the
//                                                                separator is legitimate and needed)
//   C  a file with tabs and CRLF line endings                    quiet (control: ordinary whitespace,
//                                                                and this repo has a CRLF CI leg)
//   D  a Markdown record carrying a raw control byte             BLOCKED (control: a record may name a
//                                                                deleted file (X215), but nothing is
//                                                                served by a record grep cannot read)
//   E  the real repository at this commit                        quiet (control: proves the one real
//                                                                occurrence is actually repaired)
//
// Control B is the one that shapes the check. Banning the VALUE would break the X193 separator this
// programme deliberately chose, so the check must distinguish a raw 0x00 in the bytes on disk from the
// six characters backslash-u-0-0-0-0. That is the same distinction X219 needed between a live
// reference and a record of one: same subject, different form, opposite verdicts.
//
// NOTE ON THIS FILE ITSELF: every fixture byte below is produced with String.fromCharCode, never typed
// literally, so this reproduction does not trip the check it installs. A test that cannot survive its
// own subject is not a test.
//
// Usage:
//   node X222-raw-control-byte-in-source.mjs                # asserts the FIXED state
//   node X222-raw-control-byte-in-source.mjs --expect-bug   # asserts the DEFECT is present

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readGate, refuseCrash } from './_verdict.mjs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const REPO_ROOT = join(HOOKS, '..', '..', '..');
const NODE = process.execPath;

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const MATCH = /control (byte|character)/i;

/** A minimal plugin skeleton INV20 can walk, plus whatever `extra` adds. */
function verdict(extra) {
  const dir = mkdtempSync(join(tmpdir(), 'x222-'));
  try {
    const plugin = join(dir, 'plugins', 'gru953-studio');
    mkdirSync(join(plugin, 'hooks'), { recursive: true });
    mkdirSync(join(plugin, 'skills'), { recursive: true });
    mkdirSync(join(plugin, 'agents'), { recursive: true });
    mkdirSync(join(plugin, 'commands'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), '# Fixture\n');
    writeFileSync(join(plugin, 'ROSTER.md'), '# Roster\n');
    writeFileSync(join(plugin, 'plugin.json'), '{"name":"fixture"}\n');
    writeFileSync(join(plugin, 'hooks', 'real-hook.mjs'), '// a hook that exists\n');
    if (extra) extra(dir, plugin);
    const v = refuseCrash(readGate(NODE, join(HOOKS, 'repo-integrity.mjs'), [dir]), 'X222', die);
    return v.problems.filter((p) => MATCH.test(String(p)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- A: the defect ---------------------------------------------------------------
const A = verdict((dir, plugin) =>
  writeFileSync(join(plugin, 'hooks', 'sep.mjs'), `export const SEP = '${NUL}';\n`),
);
const aSeen = A.length > 0;
console.log(
  `  A  a .mjs carrying a raw NUL byte ............... ${aSeen ? 'BLOCKED' : 'silent   <- X222'}`,
);

// ---- B: the escape form must be left alone --------------------------------------
{
  const B = verdict((dir, plugin) =>
    writeFileSync(join(plugin, 'hooks', 'sep.mjs'), "export const SEP = '\\u0000';\n"),
  );
  if (B.length > 0) {
    die(
      'control B failed: the ESCAPE form was reported. The check must ban the raw byte, not the value — ' +
        'the NUL separator is a deliberate choice from the X193 fix and banning it would force that fix ' +
        `to be undone to satisfy a check about encoding. Problems: ${B.join(' | ')}`,
    );
  }
  console.log('  B  the same value as an escape sequence ........ quiet (control)');
}

// ---- C: ordinary whitespace must be left alone ----------------------------------
{
  const C = verdict((dir, plugin) =>
    writeFileSync(join(plugin, 'hooks', 'ws.mjs'), '// a\ttab\r\n// and CRLF endings\r\n'),
  );
  if (C.length > 0) {
    die(
      'control C failed: tabs and CRLF were reported as control bytes. This repository has a CRLF CI ' +
        `leg, so a check that fails on it fails everywhere that matters. Problems: ${C.join(' | ')}`,
    );
  }
  console.log('  C  tabs and CRLF line endings ................. quiet (control)');
}

// ---- D: a record is not exempt from being readable -------------------------------
//
// Asserted only in the FIXED state. In the defect state no such check exists, so a record cannot be
// reported either and demanding BLOCKED here would fail for the very reason the run is asserting —
// which is a control that cannot distinguish "the fix is absent" from "the fix is wrong". The first
// draft of this file got that wrong and control D duly failed on the --expect-bug run.
const D = verdict((dir) => writeFileSync(join(dir, 'CHANGELOG.md'), `# Changelog\n\n- a${BEL}b\n`));
const dSeen = D.length > 0;
if (!expectBug && !dSeen) {
  die(
    'control D failed: a Markdown record carrying a raw control byte was not reported. A record may ' +
      'legitimately NAME a deleted file (X215) — but nothing is served by a record no text tool can ' +
      'read, and the register is the most-grepped file in this project.',
  );
}
console.log(
  `  D  a record carrying a raw control byte ........ ${dSeen ? 'BLOCKED (control)' : 'silent (consistent with the defect)'}`,
);

// ---- E: the real tree ------------------------------------------------------------
{
  const v = refuseCrash(
    readGate(NODE, join(HOOKS, 'repo-integrity.mjs'), [REPO_ROOT]),
    'X222',
    die,
  );
  const E = v.problems.filter((p) => MATCH.test(String(p)));
  if (E.length > 0) {
    die(
      "control E failed: the REAL repository still carries a raw control byte. That is X204's one real " +
        `occurrence, in traceability-check.mjs at line 330 — repair it to the escape form. Problems: ${E.join(' | ')}`,
    );
  }
  console.log('  E  the real repository at this commit .......... quiet (control)');
}

if (expectBug) {
  if (aSeen) {
    die(
      'expected the X222 defect and did not find it. If it was fixed, remove this --expect-bug branch deliberately.',
    );
  }
  console.log(
    '\nX222 REPRODUCED: a source file carrying a raw control byte passes every gate, so a file that no ' +
      'text tool can read looks perfectly healthy.',
  );
  process.exit(0);
}

if (aSeen) {
  console.log(
    '\nPASS: a raw control byte in source is blocked, while the escape form, ordinary tabs and CRLF, and ' +
      'the real tree are all left alone.',
  );
  process.exit(0);
}

die(
  'X222 is OPEN: nothing detects a raw control byte in a source file. One exists — traceability-check.mjs ' +
    'line 330 — and it makes `file` report binary data and a default `grep` return nothing, which blinded ' +
    'two greps of that file during an audit of that very file.',
);
