// install.test.mjs — 2026-08-10, with the Antigravity installer rewrite.
//
// The defect these tests exist to prevent is specific and was real: the previous
// installer wrote to a location Antigravity does not scan, with no plugin.json,
// linking one skill of the whole set — and then printed "initialized
// successfully". Every assertion below is about the layout Antigravity's own
// documentation describes, so a future change that drifts from it fails here
// rather than in a user's editor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { installForAntigravity, pluginTargetDir, buildRosterRule } = require('../src/install.js');

const RM = { recursive: true, force: true, maxRetries: 3 };

function mkTmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** A miniature stand-in for the real plugin directory. */
function fakePlugin(dir, { agents = ['architect', 'builder', 'tester'], charter = true } = {}) {
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'gru953-studio', version: '9.9.9' }),
  );
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  for (const a of agents) {
    fs.writeFileSync(
      path.join(dir, 'agents', `${a}.md`),
      `---\nname: ${a}\ndescription: Owns the ${a} job for the team.\n---\n\n# ${a}\n`,
    );
  }
  fs.mkdirSync(path.join(dir, 'skills', 'studio'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills', 'studio', 'SKILL.md'), '---\nname: studio\n---\n');
  fs.mkdirSync(path.join(dir, 'skills', 'yagni-rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills', 'yagni-rules', 'SKILL.md'), '---\nname: yagni-rules\n---\n');
  if (charter) {
    fs.mkdirSync(path.join(dir, 'skills', 'operating-charter'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'skills', 'operating-charter', 'SKILL.md'),
      '---\nname: operating-charter\n---\n\n## CHARTER-CLAUSE: ABOUT ME\nUse UK English.\n',
    );
  }
  return dir;
}

test('installs to the location Antigravity actually scans, globally', () => {
  const home = mkTmp('gru-ag-home-');
  const src = fakePlugin(mkTmp('gru-ag-src-'));
  const r = installForAntigravity({ pluginSourceDir: src, homeDir: home });
  assert.equal(r.ok, true, `expected success, got: ${r.errors.join('; ')}`);
  // The documented global location — NOT .agents/skills/, which the previous
  // version used and which Antigravity never reads.
  assert.equal(r.target, path.join(home, '.gemini', 'config', 'plugins', 'gru953-studio'));
  assert.ok(fs.existsSync(r.target), 'the plugin directory must exist');
  fs.rmSync(home, RM);
  fs.rmSync(src, RM);
});

test('installs to .agents/plugins (not .agents/skills) for a single workspace', () => {
  const ws = mkTmp('gru-ag-ws-');
  const src = fakePlugin(mkTmp('gru-ag-src2-'));
  const r = installForAntigravity({ pluginSourceDir: src, scope: 'workspace', workspaceDir: ws });
  assert.equal(r.ok, true, `expected success, got: ${r.errors.join('; ')}`);
  assert.equal(r.target, path.join(ws, '.agents', 'plugins', 'gru953-studio'));
  assert.ok(!fs.existsSync(path.join(ws, '.agents', 'skills')), 'the old, wrong location must not be created');
  fs.rmSync(ws, RM);
  fs.rmSync(src, RM);
});

test('writes plugin.json — without it, Antigravity does not treat the directory as a plugin at all', () => {
  const home = mkTmp('gru-ag-marker-');
  const src = fakePlugin(mkTmp('gru-ag-src3-'));
  const r = installForAntigravity({ pluginSourceDir: src, homeDir: home });
  const manifest = path.join(r.target, 'plugin.json');
  assert.ok(fs.existsSync(manifest), 'plugin.json is the required marker file');
  const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  assert.equal(parsed.name, 'gru953-studio');
  assert.equal(parsed.version, '9.9.9', "the version must come from the plugin's own manifest");
  fs.rmSync(home, RM);
  fs.rmSync(src, RM);
});

test('makes EVERY skill available, not just one (the exact defect being fixed)', () => {
  const home = mkTmp('gru-ag-allskills-');
  const src = fakePlugin(mkTmp('gru-ag-src4-'));
  const r = installForAntigravity({ pluginSourceDir: src, homeDir: home });
  const installed = fs.readdirSync(path.join(r.target, 'skills')).sort();
  assert.deepEqual(
    installed,
    ['operating-charter', 'studio', 'yagni-rules'],
    'all skills present — the previous version linked only `studio` and reported success',
  );
  fs.rmSync(home, RM);
  fs.rmSync(src, RM);
});

test('projects the whole roster into rules/, since Antigravity has no agents/ component', () => {
  const home = mkTmp('gru-ag-roster-');
  const src = fakePlugin(mkTmp('gru-ag-src5-'), { agents: ['architect', 'builder', 'tester', 'publisher'] });
  const r = installForAntigravity({ pluginSourceDir: src, homeDir: home });
  const roster = fs.readFileSync(path.join(r.target, 'rules', 'gru953-roster.md'), 'utf8');
  assert.match(roster, /\*\*4 specialists\.\*\*/, 'the count must be derived from the real agents/ directory');
  for (const a of ['architect', 'builder', 'tester', 'publisher']) {
    assert.match(roster, new RegExp('\\| `' + a + '` \\|'), `${a} must appear in the roster rule`);
  }
  assert.match(roster, /no `agents\/` component/, 'the limitation must be stated in the file itself');
  assert.ok(!fs.existsSync(path.join(r.target, 'agents')), 'no agents/ directory — Antigravity would ignore it');
  assert.ok(!fs.existsSync(path.join(r.target, 'commands')), 'no commands/ directory either');
  fs.rmSync(home, RM);
  fs.rmSync(src, RM);
});

test('the charter is installed as a rule, so it binds in Antigravity too', () => {
  const home = mkTmp('gru-ag-charter-');
  const src = fakePlugin(mkTmp('gru-ag-src6-'));
  const r = installForAntigravity({ pluginSourceDir: src, homeDir: home });
  const charter = fs.readFileSync(path.join(r.target, 'rules', 'gru953-operating-charter.md'), 'utf8');
  assert.match(charter, /ABOUT ME/);
  fs.rmSync(home, RM);
  fs.rmSync(src, RM);
});

test('a missing charter is reported as a failure, never silently skipped', () => {
  const home = mkTmp('gru-ag-nocharter-');
  const src = fakePlugin(mkTmp('gru-ag-src7-'), { charter: false });
  const r = installForAntigravity({ pluginSourceDir: src, homeDir: home });
  assert.equal(r.ok, false, 'success must not be reported when a piece is missing');
  assert.ok(r.errors.some((e) => /operating charter/i.test(e)), `expected an error naming the charter, got: ${r.errors.join('; ')}`);
  fs.rmSync(home, RM);
  fs.rmSync(src, RM);
});

test('a wrong source directory fails loudly instead of reporting success over an empty folder', () => {
  const home = mkTmp('gru-ag-badsrc-');
  const r = installForAntigravity({ pluginSourceDir: path.join(home, 'nope'), homeDir: home });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Could not find/.test(e)));
  fs.rmSync(home, RM);
});

test('running twice leaves one installation, not two, and does not fail', () => {
  const home = mkTmp('gru-ag-twice-');
  const src = fakePlugin(mkTmp('gru-ag-src8-'));
  const first = installForAntigravity({ pluginSourceDir: src, homeDir: home });
  const second = installForAntigravity({ pluginSourceDir: src, homeDir: home });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true, `a second run must succeed, got: ${second.errors.join('; ')}`);
  assert.equal(
    fs.readdirSync(path.join(home, '.gemini', 'config', 'plugins')).length,
    1,
    'exactly one plugin directory',
  );
  fs.rmSync(home, RM);
  fs.rmSync(src, RM);
});

test('pluginTargetDir never returns the pre-2026-08-10 wrong location', () => {
  const global = pluginTargetDir({ homeDir: '/home/someone' });
  const ws = pluginTargetDir({ scope: 'workspace', workspaceDir: '/proj' });
  for (const p of [global, ws]) {
    assert.ok(p.includes(`plugins${path.sep}gru953-studio`), `${p} must be under a plugins directory`);
    assert.ok(!p.includes(`.agents${path.sep}skills`), `${p} must not use the old .agents/skills location`);
  }
});

test('buildRosterRule returns null rather than throwing when agents/ cannot be read', () => {
  assert.equal(buildRosterRule('/definitely/not/a/real/path'), null);
});
