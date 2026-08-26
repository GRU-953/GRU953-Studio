// aider-config-safety.test.mjs — 2026-08-22, finding X244.
//
// `gru953-studio init` writes configuration into the user's own project. For free-form prose files
// the marked-region mechanism in universal-init.js is sound, and the guarantee its comment makes —
// "any of the user's own content outside the markers is left untouched" — is true of the BYTES.
//
// It was not true of the MEANING for a structured file. `.aider.conf.yml` is YAML. Appending a
// second `read:` key to a file that already has one produces a document with a duplicate top-level
// mapping key, which is invalid YAML: a parser either rejects the file outright or takes the last
// occurrence, and the last occurrence is ours, because we append. Either way the user's own `read:`
// list stops being used — while every byte of it is still visibly sitting in the file, and the code
// promised it had been left alone.
//
// Reproduced before the fix: a project whose `.aider.conf.yml` listed MY-NOTES.md and
// docs/architecture.md came back with two `read:` keys.
//
// NOT VERIFIED, and stated rather than glossed: which of the two parser behaviours Aider actually
// exhibits. PyYAML was not available on the machine where this was found, so "rejects the file" vs
// "silently uses ours" is untested. The direction is certain either way — the user's list stops
// being honoured — which is why this was fixed rather than left as a lead.
//
// The fix refuses instead of merging. Silently merging somebody's editor configuration is the same
// class of act as silently replacing it, and only they can decide what their own config should say,
// so the file is left byte-identical and the exact lines they would need are printed for them.
//
// The three controls matter as much as the case. Refusing is easy to overdo: a fix that made `init`
// stop writing this file at all would pass a naive check, and so would one that treated our OWN
// previous block as a conflict with itself and refused for ever from the second run onward.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mod = require('../src/universal-init.js');
const init = mod.initializeUniversalRules || mod.default;

const RM = { recursive: true, force: true, maxRetries: 3 };
const mkTmp = (p) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const AIDER = '.aider.conf.yml';

// `init` prints to stdout; capture it so the tests can assert what the user is told, and so the
// suite's own output stays readable.
function runInit(dir) {
  const lines = [];
  const original = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    init(dir);
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}
const topLevelReadKeys = (text) =>
  text.split('\n').filter((l) => /^read:/.test(l)).length;

test("init leaves an existing .aider.conf.yml byte-identical when it already sets read:", () => {
  const dir = mkTmp('gru-aider-clash-');
  const theirs = ['model: gpt-4o', 'read:', '  - MY-NOTES.md', '  - docs/architecture.md', 'auto-commits: false', ''].join('\n');
  fs.writeFileSync(path.join(dir, AIDER), theirs, 'utf8');

  const out = runInit(dir);
  const after = fs.readFileSync(path.join(dir, AIDER), 'utf8');

  assert.equal(after, theirs, "the user's own config must be byte-identical");
  assert.equal(topLevelReadKeys(after), 1, 'a second top-level read: key would invalidate the file');
  assert.match(out, /UNCHANGED/, 'the user must be told the file was not touched');
  assert.match(out, /already sets/i, 'and why');
  assert.match(
    out,
    /OPERATING-CHARTER\.md/,
    'and be given the exact lines to add, or the refusal just loses them the feature',
  );
  fs.rmSync(dir, RM);
});

test('control: with no .aider.conf.yml at all, one is still created', () => {
  const dir = mkTmp('gru-aider-fresh-');
  const out = runInit(dir);
  assert.match(out, /\[CREATED\] \.aider\.conf\.yml/);
  const written = fs.readFileSync(path.join(dir, AIDER), 'utf8');
  assert.equal(topLevelReadKeys(written), 1);
  assert.match(written, /OPERATING-CHARTER\.md/);
  fs.rmSync(dir, RM);
});

test('control: our own previous block is not a conflict with itself, however many times init runs', () => {
  const dir = mkTmp('gru-aider-idem-');
  runInit(dir);
  const second = runInit(dir);
  const third = runInit(dir);
  const after = fs.readFileSync(path.join(dir, AIDER), 'utf8');

  assert.doesNotMatch(second, /UNCHANGED/, 'run 2 must not refuse because it found its own block');
  assert.doesNotMatch(third, /UNCHANGED/, 'nor run 3');
  assert.equal(topLevelReadKeys(after), 1, 'still exactly one read: key');
  assert.equal(
    (after.match(/GRU953-STUDIO:BEGIN/g) || []).length,
    1,
    'and exactly one managed block — the 2026-07-26 duplicate-copy defect must not return',
  );
  fs.rmSync(dir, RM);
});

test('control: a user file with only UNRELATED keys still gets the block appended', () => {
  const dir = mkTmp('gru-aider-norelate-');
  fs.writeFileSync(path.join(dir, AIDER), 'model: gpt-4o\nauto-commits: false\n', 'utf8');
  const out = runInit(dir);
  const after = fs.readFileSync(path.join(dir, AIDER), 'utf8');

  assert.match(out, /\[APPENDED\] \.aider\.conf\.yml/, 'no clash means no refusal');
  assert.equal(topLevelReadKeys(after), 1);
  assert.match(after, /^model: gpt-4o$/m, "the user's own keys must survive");
  assert.match(after, /^auto-commits: false$/m);
  fs.rmSync(dir, RM);
});
