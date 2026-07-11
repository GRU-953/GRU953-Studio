#!/usr/bin/env node
//
// repo-integrity.mjs — GRU953-Studio repository self-consistency check.
// Zero dependencies (Node stdlib only). Added in the v2.0.0 gold-standard
// audit as the systemic fix for a whole class of bug: files referencing
// skills, hooks, commands or role counts that don't actually exist or no
// longer match. The original CI validated JSON and hook syntax but never
// checked that a `dev-memory` skill referenced in five files actually
// existed — so it didn't. This closes that gap mechanically.
//
// It is a maintainer/CI check (like licence-scan.mjs, verify-progress.mjs
// and roster-check.mjs), NOT a PreToolUse runtime hook — there is no single
// Bash command that naturally triggers "is the repo internally consistent".
// Run it in CI and before any release.
//
// Usage: node repo-integrity.mjs [repoRoot]
// Exit 0 = every invariant holds. Exit 1 = at least one is violated (listed).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.argv[2] || process.cwd();
const pluginRoot = path.join(repoRoot, 'plugins', 'gru953-studio');
const problems = [];
const fail = (msg) => problems.push(msg);

function read(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function listDir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; }
}
function frontmatterField(text, field) {
  if (!text) return null;
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const line = m[1].split('\n').find((l) => new RegExp('^' + field + ':').test(l.trim()));
  return line ? line.slice(line.indexOf(':') + 1).trim() : null;
}

// ---- gather ground truth -----------------------------------------------------
const agentsDir = path.join(pluginRoot, 'agents');
const skillsDir = path.join(pluginRoot, 'skills');
const hooksDir = path.join(pluginRoot, 'hooks');
const commandsDir = path.join(pluginRoot, 'commands');

const agentFiles = listDir(agentsDir).filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name);
const skillDirs = listDir(skillsDir).filter((d) => d.isDirectory()).map((d) => d.name);
const hookFiles = listDir(hooksDir).filter((d) => d.isFile() && d.name.endsWith('.mjs')).map((d) => d.name);
const commandFiles = listDir(commandsDir).filter((d) => d.isFile() && d.name.endsWith('.md')).map((d) => d.name);

const agentCount = agentFiles.length;
const skillCount = skillDirs.length;

// Every markdown file in the whole repo, for reference scanning.
function walk(dir, acc = []) {
  for (const d of listDir(dir)) {
    if (d.name === '.git' || d.name === 'node_modules') continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}
const allFiles = walk(repoRoot);
const allMd = allFiles.filter((f) => f.endsWith('.md'));

// ---- INV 1: agent frontmatter present & name matches filename ----------------
for (const f of agentFiles) {
  const text = read(path.join(agentsDir, f));
  const name = frontmatterField(text, 'name');
  const desc = frontmatterField(text, 'description');
  const expected = f.replace(/\.md$/, '');
  if (!name) fail(`agent ${f}: missing 'name:' frontmatter`);
  else if (name !== expected) fail(`agent ${f}: name '${name}' does not match filename '${expected}'`);
  if (!desc) fail(`agent ${f}: missing 'description:' frontmatter`);
}

// ---- INV 2: skill frontmatter present & name matches directory ---------------
for (const s of skillDirs) {
  const skillFile = path.join(skillsDir, s, 'SKILL.md');
  if (!fs.existsSync(skillFile)) { fail(`skill '${s}': directory has no SKILL.md`); continue; }
  const name = frontmatterField(read(skillFile), 'name');
  if (!name) fail(`skill '${s}': SKILL.md missing 'name:' frontmatter`);
  else if (name !== s) fail(`skill '${s}': name '${name}' does not match directory '${s}'`);
}

// ---- INV 3: every skill referenced with backtick `x` skill exists ------------
// Match phrases like: `dev-memory` skill / the `studio` skill / skills named in the studio companion list.
const knownSkillWords = new Set(skillDirs);
const referencedSkills = new Set();
for (const f of allMd) {
  const text = read(f) || '';
  const re = /`([a-z0-9-]+)`\s+skill/gi;
  let m;
  while ((m = re.exec(text))) referencedSkills.add(m[1]);
}
for (const s of referencedSkills) {
  if (!knownSkillWords.has(s)) fail(`referenced skill '${s}' (as \`${s}\` skill) has no skills/${s}/SKILL.md`);
}

// ---- INV 4: every referenced hook file exists --------------------------------
const knownHooks = new Set(hookFiles);
const refHook = /hooks\/([a-z0-9-]+\.mjs)/gi;
for (const f of allFiles.filter((x) => x.endsWith('.md') || x.endsWith('.json') || x.endsWith('.yml') || x.endsWith('.mjs'))) {
  const text = read(f) || '';
  let m;
  while ((m = refHook.exec(text))) {
    if (!knownHooks.has(m[1])) fail(`file ${path.relative(repoRoot, f)} references hooks/${m[1]} which does not exist`);
  }
}

// ---- INV 5: README role count matches actual agent count ---------------------
const readme = read(path.join(repoRoot, 'README.md')) || '';
const roleCountMatch = readme.match(/(\d+)\s+(?:AI\s+)?(?:specialist\s+)?roles?/i);
if (roleCountMatch) {
  const stated = parseInt(roleCountMatch[1], 10);
  if (stated !== agentCount) fail(`README states ${stated} roles but agents/ has ${agentCount}`);
} else {
  fail(`README does not state a role count in a recognisable "<n> roles" form`);
}

// ---- INV 6: README skill count matches actual skill count --------------------
const skillCountMatch = readme.match(/(\d+)\s+skills?/i);
if (skillCountMatch) {
  const stated = parseInt(skillCountMatch[1], 10);
  if (stated !== skillCount) fail(`README states ${stated} skills but skills/ has ${skillCount}`);
} else {
  fail(`README does not state a skill count in a recognisable "<n> skills" form`);
}

// ---- INV 7: plugin.json and marketplace.json versions agree ------------------
// 2026-07-11 v2.0.0 follow-up audit fix (MAJOR, false-clean): the previous
// version compared `pv !== mv` only. When either file is missing, `read()`
// returns null, `JSON.parse(null || '{}')` silently parses to `{}`, and both
// pv and mv become `undefined` — `undefined !== undefined` is false, so this
// invariant reported CLEAN when both version files were entirely absent.
// A false-clean is worse than a false-positive here: nobody double-checks a
// green result. Now fails explicitly if either file is unreadable or either
// version is missing, in addition to a real mismatch.
const pluginJsonRaw = read(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
const marketJsonRaw = read(path.join(repoRoot, '.claude-plugin', 'marketplace.json'));
if (pluginJsonRaw === null) fail(`plugins/gru953-studio/.claude-plugin/plugin.json is missing or unreadable`);
if (marketJsonRaw === null) fail(`.claude-plugin/marketplace.json is missing or unreadable`);
const pluginJson = JSON.parse(pluginJsonRaw || '{}');
const marketJson = JSON.parse(marketJsonRaw || '{}');
const pv = pluginJson.version;
const mv = marketJson.metadata && marketJson.metadata.version;
if (pv === undefined) fail(`plugin.json has no "version" field`);
if (mv === undefined) fail(`marketplace.json has no metadata.version field`);
if (pv !== undefined && mv !== undefined && pv !== mv) fail(`version mismatch: plugin.json=${pv} marketplace.json=${mv}`);

// ---- INV 9: marketplace.json's own plugin description role-count agrees -----
// 2026-07-11 addition: this is the systemic fix for the exact bug the
// consistency audit found — marketplace.json's plugins[0].description said
// "up to 16 specialised roles" for a full day after the roster grew to 31,
// because nothing checked description TEXT, only the version field (INV7).
const marketPluginDesc = marketJson.plugins && marketJson.plugins[0] && marketJson.plugins[0].description;
if (marketPluginDesc) {
  const dm = marketPluginDesc.match(/up to (\d+) specialised roles/i);
  if (dm && parseInt(dm[1], 10) !== agentCount) {
    fail(`marketplace.json plugin description says "up to ${dm[1]} specialised roles" but agents/ has ${agentCount}`);
  }
}

// ---- INV 8: committed roster baseline matches agent count --------------------
const rosterBaselineFile = path.join(pluginRoot, 'ROSTER.md');
const rosterText = read(rosterBaselineFile);
if (rosterText === null) {
  fail(`no committed roster baseline at plugins/gru953-studio/ROSTER.md (needed so the product's own roster can be verified)`);
} else {
  const rm = rosterText.match(/role count[^0-9]*(\d+)/i) || rosterText.match(/baseline[^0-9]*(\d+)/i);
  if (!rm) fail(`ROSTER.md does not state a numeric "role count: <n>"`);
  else if (parseInt(rm[1], 10) !== agentCount) fail(`ROSTER.md role count ${rm[1]} != actual agent count ${agentCount}`);
}

// ---- report ------------------------------------------------------------------
if (problems.length === 0) {
  console.log(JSON.stringify({ status: 'clean', agentCount, skillCount, hookCount: hookFiles.length, commandCount: commandFiles.length }, null, 2));
  process.exit(0);
}
console.log(JSON.stringify({ status: 'BLOCKED', problems, agentCount, skillCount }, null, 2));
process.exit(1);
