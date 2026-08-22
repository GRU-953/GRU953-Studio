// escaping-safety.test.mjs — 2026-08-22, finding X246.
//
// Two places where a value was interpolated into a language that has metacharacters, without
// escaping them. Both were graded NOT-A-DEFECT by an adjudicator whose categorical claim was
// correct — the plist it generates for an ordinary path IS valid and launchd-loadable — and both
// contained a real narrower defect inside that correct refutation. Worth recording, because
// "the sweeping version of this claim is false" and "there is nothing here" are different findings.
//
//   A  launchAgentPlist interpolated LABEL, nodePath, cliPath and the log path straight into XML.
//      A path containing `&` produced a file Apple's own validator rejects:
//        plutil -lint  ->  "Encountered unknown ampersand-escape sequence at line 9", exit 1
//      launchd then has nothing loadable, while enable() reports "A daily update check is now
//      scheduled". A macOS short username cannot contain `&`, which is why this is narrow — but a
//      path can be anywhere, and the log path is built from os.homedir().
//
//   B  installVscodeFamily passes the .vsix path to spawnSync with `shell: true` on Windows, which
//      is necessary because those hosts ship a `.cmd` launcher — and Node's own documentation warns
//      that it does NOT escape arguments in that mode. The path reached cmd.exe raw, so `&` would
//      end the command and begin another.
//
// The fix for B refuses rather than quotes. cmd.exe quoting is a well-known source of its own bugs,
// and a command we cannot build correctly should not be built: the user is given the exact command
// to run by hand instead. The control below is what stops that refusal spreading to ordinary paths,
// including the very common case of a path containing spaces.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const autoupdate = require('../src/autoupdate.js');
const targets = require('../src/install-targets.js');

const mkTmpFile = (name) => path.join(fs.realpathSync(os.tmpdir()), name);

// ---- A: the plist must stay valid XML whatever the path contains -------------------
test('launchAgentPlist survives XML metacharacters in the paths', () => {
  const nasty = '/Users/ben & co/<tools>/"cli"/index.js';
  const plist = autoupdate.launchAgentPlist('/usr/local/bin/node', nasty);

  assert.doesNotMatch(plist, /<string>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/, 'a bare & must not survive');
  assert.match(plist, /&amp;/, 'the ampersand must be escaped');

  // Apple's own validator is the authority here, not a regex. Skipped rather than faked off macOS.
  if (process.platform === 'darwin') {
    const f = mkTmpFile('gru-escaping-nasty.plist');
    fs.writeFileSync(f, plist, 'utf8');
    const lint = spawnSync('plutil', ['-lint', f], { encoding: 'utf8' });
    assert.equal(lint.status, 0, `plutil rejected the generated plist: ${lint.stdout}${lint.stderr}`);

    // Escaped is not enough — it has to come back out as the path we put in, or launchd would run
    // the wrong thing rather than nothing, which is worse.
    const back = spawnSync('plutil', ['-extract', 'ProgramArguments.1', 'raw', f], {
      encoding: 'utf8',
    });
    assert.equal(back.stdout.trim(), nasty, 'the path must round-trip exactly');
    fs.rmSync(f, { force: true });
  }
});

test('control: an ordinary path still produces a valid, unchanged plist', () => {
  const plain = '/usr/local/lib/node_modules/@gru953/studio-cli/src/index.js';
  const plist = autoupdate.launchAgentPlist('/usr/local/bin/node', plain);
  assert.match(plist, new RegExp(`<string>${plain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</string>`));
  assert.doesNotMatch(plist, /&amp;|&lt;|&gt;/, 'nothing to escape means nothing escaped');
  if (process.platform === 'darwin') {
    const f = mkTmpFile('gru-escaping-plain.plist');
    fs.writeFileSync(f, plist, 'utf8');
    assert.equal(spawnSync('plutil', ['-lint', f], { encoding: 'utf8' }).status, 0);
    fs.rmSync(f, { force: true });
  }
});

// ---- B: a path cmd.exe cannot be given safely is not given to it -------------------
//
// installVscodeFamily IS exported (install-targets.js:229), so it is called directly. What matters
// is which BRANCH is taken: the refusal must happen before anything is spawned, and must name the
// manual command. The `hasFn` guard below stays anyway — if a future change stops exporting it, this
// test should say so plainly rather than silently testing nothing.
const hasFn = typeof targets.installVscodeFamily === 'function';

test('a .vsix path containing a cmd.exe metacharacter is refused, with the manual command given', {
  skip: hasFn ? false : 'installVscodeFamily is not exported; asserted through the source instead',
}, () => {
  // The file has to really exist: installVscodeFamily checks existence FIRST, so a made-up path
  // would return on that branch and this test would pass without exercising the guard at all.
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gru-vsix-'));
  const nastyDir = path.join(dir, 'ben & co');
  fs.mkdirSync(nastyDir, { recursive: true });
  const vsixPath = path.join(nastyDir, 'gru953-studio.vsix');
  fs.writeFileSync(vsixPath, 'not really a vsix', 'utf8');

  const r = targets.installVscodeFamily(
    { name: 'VS Code', command: 'code' },
    { vsixPath, platform: 'win32' },
  );
  assert.equal(r.ok, false);
  assert.equal(r.changed, false, 'nothing may have been changed');
  assert.match(r.message, /--install-extension/, 'the user needs the command they can run themselves');
  assert.match(r.message, /specially|by hand|move the file/i, 'and to be told why');

  // Control: the SAME file on a non-Windows platform must not hit the guard, because there is no
  // cmd.exe involved. It will fail for a different reason (no `code` binary here) and that is fine —
  // what matters is that the refusal message is not the Windows one.
  const posix = targets.installVscodeFamily(
    { name: 'VS Code', command: 'definitely-not-a-real-binary-gru953' },
    { vsixPath, platform: 'darwin' },
  );
  assert.doesNotMatch(
    posix.message || '',
    /treats specially/,
    'the Windows-only guard must not fire on macOS or Linux',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the source refuses unsafe Windows paths before spawning', () => {
  // A source-level assertion, so this holds whether or not the function is exported. It checks the
  // ORDER that matters: the guard has to sit above the spawnSync call, not below it.
  const src = fs.readFileSync(
    new URL('../src/install-targets.js', import.meta.url),
    'utf8',
  );
  const guard = src.indexOf('UNSAFE_FOR_CMD');
  const spawn = src.indexOf("spawnSync(host.command, ['--install-extension'");
  assert.ok(guard > -1, 'there must be a guard on characters cmd.exe treats specially');
  assert.ok(spawn > -1, 'the spawn call must still exist');
  assert.ok(guard < spawn, 'the guard must come BEFORE the spawn, or it guards nothing');
  // Control: the guard must not catch a space. Paths with spaces are the common case on Windows
  // ("C:\\Program Files\\..."), and refusing those would break the ordinary install.
  const m = /const UNSAFE_FOR_CMD = (\/[^/]+\/)/.exec(src);
  assert.ok(m, 'the guard should be a readable literal');
  const re = new RegExp(m[1].slice(1, -1));
  assert.equal(re.test('C:\\Program Files\\gru953 studio.vsix'), false, 'a space must be allowed');
  assert.equal(re.test('C:\\Users\\ben & co\\x.vsix'), true, 'an ampersand must not be');
});
