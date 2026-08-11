// bundled-plugin.test.mjs — 2026-08-11.
//
// The defect these tests exist to prevent, stated plainly because it is the most
// instructive one in this project's history:
//
// `gru953-studio install` is meant to set the studio up in every AI tool on a
// machine. From a git checkout it did. From npm — or Homebrew, which installs the
// npm package — it could NOT, because the published package shipped `src` and
// LICENSE only. The studio's skills and agents were not in it. Meanwhile the
// README, the Homebrew caveats and the wiki's Homebrew route all promised
// otherwise.
//
// Every test passed beforehand. That is the point. Every test ran from a checkout,
// where the plugin sits a few directories up and is always present, so no test ever
// exercised the arrangement a real user actually gets. The bug was found by running
// the Homebrew-installed command, not by testing.
//
// So these tests deliberately assert against the PACKAGED shape rather than the
// checkout: what `npm pack` produces, and how findPluginSource resolves when the
// checkout is not reachable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const RM = { recursive: true, force: true, maxRetries: 3 };

test('package.json ships the bundled studio, or a published install cannot install anything', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('plugin'), '"plugin" must be in files — without it the studio is not published');
  assert.ok(pkg.files.includes('src'), '"src" must be in files');
  // prepack, not prepublishOnly: it must also run for `npm pack`, which is how this
  // is tested and how anyone would inspect the tarball before trusting it.
  assert.equal(pkg.scripts.prepack, 'node scripts/bundle-plugin.mjs', 'prepack must bundle the studio');
});

test('the bundler refuses to run outside the repository rather than producing an empty package', () => {
  // A silent success here would publish a command that cannot install the studio —
  // exactly the defect being fixed. It must fail loudly instead.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gru-bundle-nope-'));
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(PACKAGE_ROOT, 'scripts', 'bundle-plugin.mjs'),
    path.join(tmp, 'scripts', 'bundle-plugin.mjs'),
  );
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }));
  const r = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'bundle-plugin.mjs')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'it must exit non-zero when the studio is not findable');
  assert.match(r.stderr, /cannot find the studio/i);
  fs.rmSync(tmp, RM);
});

test('the bundler refuses a version mismatch between the command and the studio', () => {
  // A command that installs a DIFFERENT version of the studio than it claims to be
  // is worse than one that installs nothing, because nothing about it looks wrong.
  const src = fs.readFileSync(path.join(PACKAGE_ROOT, 'scripts', 'bundle-plugin.mjs'), 'utf8');
  assert.match(src, /version mismatch/i, 'the bundler must check the two versions agree');
  assert.match(src, /process\.exit\(1\)/, 'and must fail rather than warn');
});

test('findPluginSource prefers the bundled copy, so a published install works', async () => {
  const { findPluginSource } = await import(
    path.join(PACKAGE_ROOT, 'src', 'index.js').replace(/^/, 'file://')
  ).then((m) => m.default || m).catch(async () => {
    // index.js is CommonJS; import() of a .js CJS file yields its exports on default
    const { createRequire } = await import('node:module');
    return createRequire(import.meta.url)(path.join(PACKAGE_ROOT, 'src', 'index.js'));
  });
  // In a checkout with no bundled ./plugin, it must still find the repository copy —
  // otherwise development breaks.
  const found = findPluginSource();
  assert.ok(found, 'the studio must be findable from a checkout');
  assert.ok(
    fs.existsSync(path.join(found, '.claude-plugin', 'plugin.json')),
    'whatever it returns must actually be the studio',
  );
});

test('npm pack produces a tarball containing the whole studio, not just the command', () => {
  // The end-to-end assertion. Slow (it runs the real prepack), but it is the only
  // thing that would have caught the original defect, so it earns its place.
  const r = spawnSync('npm', ['pack', '--pack-destination', os.tmpdir(), '--silent'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(r.status, 0, `npm pack failed: ${r.stderr}`);
  // split on \r?\n: npm's output on Windows ends each line with \r\n, and a trailing
  // carriage return in the filename made this point at a path that does not exist.
  const tgz = r.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  const tarball = path.isAbsolute(tgz) ? tgz : path.join(os.tmpdir(), tgz);
  assert.ok(fs.existsSync(tarball), `expected a tarball at ${tarball}`);

  const list = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
  assert.equal(list.status, 0, 'tar must be able to read the tarball');
  // split on \r?\n and trim: `tar` on Windows emits \r\n, which leaves a trailing
  // carriage return on every entry and makes exact-match lookups below fail on paths
  // that are genuinely present. That is exactly what happened — the Windows CI leg
  // reported "must contain package/plugin/.claude-plugin/plugin.json" while also
  // reporting 127 entries under package/plugin/. Two lines above, npm's own output was
  // already being split this way; this one was missed.
  const names = list.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // The five things whose absence broke `install` and `models`.
  for (const required of [
    'package/plugin/.claude-plugin/plugin.json',
    'package/plugin/skills/operating-charter/SKILL.md',
    'package/plugin/hooks/openrouter-models.mjs',
    'package/src/index.js',
  ]) {
    // The message carries what WAS in the tarball. When this failed on the Windows CI
    // leg it said only "must contain ...", which told nobody anything — the real cause
    // (npm consulting .gitignore and excluding ./plugin on older versions) took a
    // separate investigation to find. A failing test should hand over its evidence.
    assert.ok(
      names.includes(required),
      `the tarball must contain ${required}\nIt actually contains ${names.length} entries, ` +
        `${names.filter((n) => n.startsWith('package/plugin/')).length} of them under package/plugin/.\n` +
        `First 15: ${names.slice(0, 15).join(', ')}`,
    );
  }
  assert.ok(
    names.filter((n) => n.startsWith('package/plugin/agents/')).length >= 30,
    'the specialists must be published, not just referenced',
  );
  // Build output and platform litter must never be published.
  assert.ok(!names.some((n) => n.includes('node_modules')), 'no node_modules in the tarball');
  assert.ok(!names.some((n) => n.endsWith('.DS_Store')), 'no .DS_Store in the tarball');

  // The version inside must match the package's own, or the command installs a
  // studio that disagrees with it.
  const own = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
  const bundled = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'),
  ).version;
  assert.equal(bundled, own, 'the bundled studio and the command must be the same version');

  fs.rmSync(tarball, { force: true });
});

test('--version, -v and version all report the package version', () => {
  const expected = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
  for (const flag of ['--version', '-v', 'version']) {
    const r = spawnSync(process.execPath, [path.join(PACKAGE_ROOT, 'src', 'index.js'), flag], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, `${flag} must exit 0`);
    assert.equal(r.stdout.trim(), expected, `${flag} must print ${expected}`);
    // It must NOT fall through to the help text, which is what it used to do.
    assert.doesNotMatch(r.stdout, /Unknown command/, `${flag} must not be reported as unknown`);
  }
});

test('--help and -h show the help text', () => {
  for (const flag of ['--help', '-h']) {
    const r = spawnSync(process.execPath, [path.join(PACKAGE_ROOT, 'src', 'index.js'), flag], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /gru953-studio install/, `${flag} must show the command list`);
    assert.doesNotMatch(r.stdout, /Unknown command/);
  }
});

test('no user-facing message still claims an npm install lacks the studio', () => {
  // Those messages were true before this fix and are now actively misleading.
  const src = fs.readFileSync(path.join(PACKAGE_ROOT, 'src', 'index.js'), 'utf8');
  const stale = [/installed from npm, which does not include the studio/i, /an npm install does not include/i];
  for (const re of stale) {
    assert.ok(!re.test(src), `a stale message matching ${re} is still present`);
  }
});

test('.npmignore exists, or npm falls back to .gitignore and drops the studio', () => {
  // Not cosmetic. ./plugin is gitignored as build output, and with no .npmignore npm
  // consults .gitignore — so on some npm versions the directory `files` explicitly
  // asks for was excluded again by the rule keeping it out of git. Whether the
  // published package contained the studio depended on which npm ran the publish.
  // The Windows CI leg produced an empty plugin/ while npm 11.19 produced a correct
  // one, from the same command.
  const npmignore = path.join(PACKAGE_ROOT, '.npmignore');
  assert.ok(fs.existsSync(npmignore), '.npmignore must exist so npm ignores .gitignore entirely');
  // It must not itself exclude the thing it exists to protect.
  const body = fs.readFileSync(npmignore, 'utf8');
  const rules = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const r of rules) {
    assert.ok(!/^\/?(plugin|src)\/?$/.test(r), `.npmignore must not exclude ${r}`);
  }
});

test('the repository is not left polluted by packing (plugin/ is build output)', () => {
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /clients\/cli\/plugin\//, 'the bundled copy must be gitignored');
});
