// universal-init.test.mjs — 2026-07-26 audit finding 11 (dropped from stage 4's
// finding list by oversight; swept up in stage 5). Before this fix, every
// target file was checked for one shared marker string, "GRU953-Studio
// Universal Context" — but AIDER_CONFIG never contained that phrase at all,
// so .aider.conf.yml specifically was re-appended on every single run: three
// runs produced three duplicate copies in the user's own config file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeUniversalRules, writeManagedBlock } from '../src/universal-init.js';

const RM_OPTS = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };
function mkTmp(prefix) {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

test('initializeUniversalRules: three runs in a row leave exactly one copy of the aider block (2026-07-26 audit finding 11)', () => {
  const dir = mkTmp('gru-uinit-triple-');
  initializeUniversalRules(dir);
  initializeUniversalRules(dir);
  initializeUniversalRules(dir);
  const aider = fs.readFileSync(path.join(dir, '.aider.conf.yml'), 'utf8');
  const copies = (aider.match(/GRU953-STUDIO:BEGIN/g) || []).length;
  assert.equal(copies, 1, `three runs must leave exactly one managed block, found ${copies}: ${aider}`);
  fs.rmSync(dir, RM_OPTS);
});

test('initializeUniversalRules: the user\'s own pre-existing content is appended around, never overwritten', () => {
  const dir = mkTmp('gru-uinit-preserve-');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.cursorrules'), 'MY OWN CUSTOM RULES\nDo not touch this.\n');
  initializeUniversalRules(dir);
  const text = fs.readFileSync(path.join(dir, '.cursorrules'), 'utf8');
  assert.match(text, /MY OWN CUSTOM RULES/, 'the user\'s own pre-existing content must survive');
  assert.match(text, /Do not touch this\./, 'the user\'s own pre-existing content must survive intact');
  assert.match(text, /GRU953-STUDIO:BEGIN/, 'the managed block must still be added');
  fs.rmSync(dir, RM_OPTS);
});

test('writeManagedBlock: a changed template replaces the managed region in place, leaving surrounding content untouched', () => {
  const dir = mkTmp('gru-uinit-replace-');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, '.cursorrules');
  fs.writeFileSync(target, 'USER CONTENT ABOVE\n');
  writeManagedBlock(target, 'ORIGINAL TEMPLATE', 'html');
  fs.appendFileSync(target, '\nUSER CONTENT BELOW\n');
  writeManagedBlock(target, 'CHANGED TEMPLATE', 'html');
  const text = fs.readFileSync(target, 'utf8');
  assert.match(text, /USER CONTENT ABOVE/);
  assert.match(text, /USER CONTENT BELOW/);
  assert.match(text, /CHANGED TEMPLATE/);
  assert.doesNotMatch(text, /ORIGINAL TEMPLATE/, 'the stale template content must be replaced, not left duplicated alongside the new one');
  const copies = (text.match(/GRU953-STUDIO:BEGIN/g) || []).length;
  assert.equal(copies, 1, 'replacing must never leave a second managed block');
  fs.rmSync(dir, RM_OPTS);
});

test('initializeUniversalRules: .aider.conf.yml no longer references .aider.model.metadata.json, a file this tool never creates (2026-07-26 finding 34)', () => {
  const dir = mkTmp('gru-uinit-aidermeta-');
  initializeUniversalRules(dir);
  const aider = fs.readFileSync(path.join(dir, '.aider.conf.yml'), 'utf8');
  assert.doesNotMatch(aider, /aider\.model\.metadata\.json/, 'must not reference a model-metadata file this tool never generates for the user');
  fs.rmSync(dir, RM_OPTS);
});
