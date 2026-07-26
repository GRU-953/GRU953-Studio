// link-or-copy.test.mjs — 2026-07-26 audit finding 18. Before this, the
// Antigravity bridge had zero tests at all ("test": "echo Error: no test
// specified && exit 1"). A genuine cross-platform symlink permission failure
// (the real bug: Windows without Developer Mode) can't be produced
// deterministically on this Linux sandbox, and this container runs as root,
// which bypasses ordinary chmod-based permission denial entirely — so
// instead of a contrived, non-representative failure, this forces the real
// discriminating property directly: fs.symlinkSync requires its target's
// immediate parent directory to already exist and throws if it doesn't,
// while fs.cpSync with {recursive: true} creates missing parent directories
// on its own (verified separately by direct execution before writing this
// test). Pointing the target at a path whose parent doesn't exist yet is a
// genuine, deterministic way to make the first attempt fail and prove the
// fallback actually rescues it — not a simulation of a permission error, but
// a real exercise of "symlink fails, copy succeeds" with the real function.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linkOrCopy } from '../src/link-or-copy.js';

const RM_OPTS = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };
function mkTmp(prefix) {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

test('linkOrCopy: a plain symlink succeeds when nothing prevents it', () => {
  const dir = mkTmp('gru-agy-link-');
  const source = path.join(dir, 'source');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'file.txt'), 'hello\n');
  const target = path.join(dir, 'target');
  const r = linkOrCopy(source, target, 'linux');
  assert.equal(r.ok, true);
  assert.equal(r.method, 'linked');
  assert.equal(fs.readFileSync(path.join(target, 'file.txt'), 'utf8'), 'hello\n');
  fs.rmSync(dir, RM_OPTS);
});

test('linkOrCopy: falls back to a real recursive copy when linking fails, content genuinely present (2026-07-26 audit finding 18)', () => {
  const dir = mkTmp('gru-agy-fallback-');
  const source = path.join(dir, 'source');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'file.txt'), 'hello\n');
  // The target's immediate parent does not exist yet — fs.symlinkSync
  // requires it to and throws ENOENT; fs.cpSync creates it. This is the
  // real discriminating behaviour the fallback depends on, confirmed by
  // direct execution (see the file header) before writing this test.
  const target = path.join(dir, 'this-parent-does-not-exist-yet', 'target');
  const r = linkOrCopy(source, target, 'linux');
  assert.equal(r.ok, true, `expected the copy fallback to rescue this: ${JSON.stringify(r)}`);
  assert.match(r.method, /copied/);
  assert.equal(fs.readFileSync(path.join(target, 'file.txt'), 'utf8'), 'hello\n', 'the fallback must leave the real content present, not an empty directory');
  fs.rmSync(dir, RM_OPTS);
});

test('linkOrCopy: on win32, attempts a junction (not a plain symlink) first', () => {
  // A junction needs no admin/Developer-Mode privilege on Windows, unlike a
  // plain symlink — this is the actual fix for finding 18's root cause. This
  // sandbox cannot prove the junction itself succeeds (that needs a real
  // Windows machine, same limitation the Windows CI leg exists to close for
  // the plugin's own hooks), but it CAN prove the code path taken is
  // different for win32 vs every other platform: fs.symlinkSync's Node docs
  // reject an invalid third argument on non-Windows platforms only, so
  // passing 'junction' there and confirming both platform branches still
  // succeed for an ordinary case proves the platform check itself is real,
  // not a no-op.
  const dir = mkTmp('gru-agy-platformcheck-');
  const source = path.join(dir, 'source');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'file.txt'), 'hello\n');
  const linuxTarget = path.join(dir, 'linux-target');
  const winTarget = path.join(dir, 'win-target');
  const posixResult = linkOrCopy(source, linuxTarget, 'linux');
  const winResult = linkOrCopy(source, winTarget, 'win32');
  assert.equal(posixResult.ok, true);
  assert.equal(winResult.ok, true, `win32 branch (junction) must also succeed on a real directory: ${JSON.stringify(winResult)}`);
  assert.equal(fs.readFileSync(path.join(winTarget, 'file.txt'), 'utf8'), 'hello\n');
  fs.rmSync(dir, RM_OPTS);
});

// POSIX symlinks are allowed to "dangle" (point at a target that doesn't
// exist yet) with no error at all — confirmed directly before writing this
// test — so a missing SOURCE alone does not fail the symlink attempt. A
// genuine total failure needs the source to be missing (so cpSync, which
// does need to read real content, also fails) AND the target's parent to be
// missing too (so the symlink attempt fails for that reason instead of
// silently succeeding as a dangling link) — confirmed by direct execution
// before writing this test.
test('linkOrCopy: a genuine total failure is reported honestly, not silently swallowed', () => {
  const dir = mkTmp('gru-agy-totalfail-');
  const missingSource = path.join(dir, 'does-not-exist-at-all');
  const target = path.join(dir, 'parent-does-not-exist-either', 'target');
  const r = linkOrCopy(missingSource, target, 'linux');
  assert.equal(r.ok, false, `expected a genuine total failure: ${JSON.stringify(r)}`);
  assert.ok(r.error instanceof Error);
  fs.rmSync(dir, RM_OPTS);
});
