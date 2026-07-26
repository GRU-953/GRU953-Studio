// status.test.mjs — 2026-07-26 audit finding 17. Before this, the CLI package
// had zero tests at all ("test": "echo Error: no test specified && exit 1").
// Covers the real status.js behaviour: no Dev-Memory, no PROGRESS.md, and a
// real task table with mixed statuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { countTasksByStatus, isDirectory } from '../src/status.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'src', 'index.js');
const RM_OPTS = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };
function mkTmp(prefix) {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
function runCli(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('isDirectory: false for missing path, true for a real directory, false for a file', () => {
  const dir = mkTmp('gru-cli-status-isdir-');
  assert.equal(isDirectory(path.join(dir, 'nope')), false);
  assert.equal(isDirectory(dir), true);
  fs.writeFileSync(path.join(dir, 'a-file'), 'x');
  assert.equal(isDirectory(path.join(dir, 'a-file')), false);
  fs.rmSync(dir, RM_OPTS);
});

test('countTasksByStatus: counts a real PROGRESS.md task table by Status column', () => {
  const text = [
    '| ID | Task | Status | Notes |',
    '| :-- | :-- | :-- | :-- |',
    '| T1 | ship widget | Done | verified |',
    '| T2 | ship gadget | Doing | in progress |',
    '| T3 | ship gizmo | Todo | - |',
    '| T4 | ship thing | Done | verified |',
    '',
  ].join('\n');
  const { counts, total, hasStatusColumn } = countTasksByStatus(text);
  assert.equal(hasStatusColumn, true);
  assert.equal(total, 4);
  assert.equal(counts.done, 2);
  assert.equal(counts.doing, 1);
  assert.equal(counts.todo, 1);
});

test('countTasksByStatus: no Status column is reported honestly, not miscounted', () => {
  const text = [
    '| ID | Task | Notes |',
    '| :-- | :-- | :-- |',
    '| T1 | ship widget | verified |',
    '',
  ].join('\n');
  const { hasStatusColumn, total } = countTasksByStatus(text);
  assert.equal(hasStatusColumn, false);
  assert.equal(total, 0);
});

test('gru953-studio status: no Dev-Memory reports honestly, real task counts when it exists (2026-07-26 audit finding 17)', () => {
  const dir = mkTmp('gru-cli-status-e2e-');
  const noDevMemory = runCli(['status'], dir);
  assert.equal(noDevMemory.code, 0);
  assert.match(noDevMemory.stdout, /No GRU953-Studio project found/i);

  fs.mkdirSync(path.join(dir, 'Dev-Memory'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Dev-Memory', 'PROGRESS.md'),
    '| ID | Task | Status | Notes |\n| :-- | :-- | :-- | :-- |\n| T1 | ship widget | Done | verified |\n| T2 | ship gadget | Doing | in progress |\n',
  );
  const withTasks = runCli(['status'], dir);
  assert.equal(withTasks.code, 0);
  assert.match(withTasks.stdout, /Tasks: 2 total/);
  assert.match(withTasks.stdout, /done: 1/);
  assert.match(withTasks.stdout, /doing: 1/);

  // The point of the whole fix: this must be REAL information, not the old
  // stub's unconditional "Checking status..." with nothing else.
  assert.doesNotMatch(withTasks.stdout, /^Checking status\.\.\.$/m);
  fs.rmSync(dir, RM_OPTS);
});

test('gru953-studio: start/pause/resume no longer exist (2026-07-26 audit finding 17 — removed, not faked)', () => {
  const dir = mkTmp('gru-cli-removed-');
  for (const cmd of ['start', 'pause', 'resume']) {
    const r = runCli([cmd], dir);
    assert.doesNotMatch(r.stdout, new RegExp(`${cmd[0].toUpperCase()}${cmd.slice(1)}ing`), `${cmd} must not print a fake success message`);
    assert.match(r.stdout, /Usage: gru953-studio/i, `${cmd} must fall through to the help text, not run a fake command`);
  }
  fs.rmSync(dir, RM_OPTS);
});
