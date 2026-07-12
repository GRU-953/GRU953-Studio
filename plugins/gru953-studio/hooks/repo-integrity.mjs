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
  if (!line) return null;
  let value = line.slice(line.indexOf(':') + 1).trim();
  // 2026-07-11 Round 7 audit fix (dormant, not yet triggered by any
  // committed file, closed anyway): a YAML value quoted as `"architect"` or
  // `'architect'` was returned verbatim WITH the quotes, so a syntactically
  // valid `name: "architect"` in architect.md would falsely fail INV1's
  // name-matches-filename check (`'"architect"' !== 'architect'`). Strip one
  // layer of matching surrounding quotes, same as any real YAML parser would.
  const quoted = value.match(/^"([^"]*)"$|^'([^']*)'$/);
  if (quoted) value = quoted[1] !== undefined ? quoted[1] : quoted[2];
  return value;
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
// 2026-07-12 audit fix (SEVERE false-clean, found by execution): the check
// above only matches the phrase shape "`name` skill". The single most
// load-bearing file in the whole product — skills/studio/SKILL.md's own
// "companion skills" bullet list, which every session reads and follows —
// uses a completely different shape (`- \`name\` — description`), which the
// old regex never matched at all, so a stale/renamed entry there (the exact
// coordinator instructions every session loads) went completely
// undetected. Reproduced live: renaming `first-run` to a non-existent
// `first-run-renamed-stale` in that bullet list still reported "clean".
// Scoped specifically to this one bullet-list shape in this one file
// (confirmed by repo-wide grep to be the only place this shape currently
// appears) rather than generalising to every backticked token repo-wide,
// which would risk new false positives on an unrelated hook/agent bullet
// list that happens to share the same visual format for something else.
const studioSkillFile = path.join(skillsDir, 'studio', 'SKILL.md');
if (fs.existsSync(studioSkillFile)) {
  const studioText = read(studioSkillFile) || '';
  const bulletRe = /^\s*-\s*`([a-z0-9-]+)`\s*[—-]/gm;
  let bm;
  while ((bm = bulletRe.exec(studioText))) {
    if (!knownSkillWords.has(bm[1])) {
      fail(`skills/studio/SKILL.md's companion-skill list references \`${bm[1]}\`, which has no skills/${bm[1]}/SKILL.md`);
    }
  }
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
// 2026-07-11 Round 7 audit fix (2 real bugs, found by execution): the
// previous regex had no `/g` and matched the FIRST "<n> roles"-shaped text
// ANYWHERE in the whole README, with "specialist" merely optional. Two
// failure modes, both reproduced live: (a) FALSE-CLEAN — an early, correct
// "23 specialist roles" mention let a LATER, actually-wrong number
// elsewhere in the file go completely unchecked, since only the first
// match was ever read; (b) FALSE-BLOCK — an unrelated historical sentence
// like "grew from 16 roles in early versions" matched before the real
// stated count and was misread as the count. Fixed two ways: require the
// specific phrase this project actually uses ("N specialist roles" — not
// generic "N roles", which is a common enough phrase to collide with
// incidental prose); and check EVERY occurrence of that specific phrase
// with `/g`, not just the first, so a stale or conflicting second mention
// can no longer hide behind an earlier correct one.
const readme = read(path.join(repoRoot, 'README.md')) || '';
function checkStatedCount(text, re, actual, label) {
  const matches = [...text.matchAll(re)].map((m) => parseInt(m[1], 10));
  if (matches.length === 0) {
    fail(`README does not state a ${label} count in a recognisable form`);
    return;
  }
  const distinct = [...new Set(matches)];
  if (distinct.length > 1 || distinct[0] !== actual) {
    fail(`README's stated ${label} count(s) [${distinct.join(', ')}] do not all match the actual count ${actual}`);
  }
}
checkStatedCount(readme, /(\d+)\s+(?:AI\s+)?specialist\s+roles?/gi, agentCount, 'role');

// ---- INV 6: README skill count matches actual skill count --------------------
// Same fix shape as INV5, for the same reason.
checkStatedCount(readme, /(\d+)\s+skills?/gi, skillCount, 'skill');

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
// 2026-07-12 audit fix (SEVERE, found by execution): the missing-file guard
// above only protects against `read()` returning null; a file that EXISTS
// but contains invalid JSON still reached JSON.parse() unguarded and threw
// an uncaught SyntaxError — the exact bug class INV9 below was written to
// prevent ("every other problem was lost behind a raw stack trace instead
// of the structured problem list this script exists to produce"),
// recurring one invariant over. Reproduced live: corrupting plugin.json's
// syntax crashed the whole script with a stack trace instead of a
// structured fail(). Both parses are now individually guarded so a syntax
// error is reported like every other invariant violation, and the rest of
// the script (which doesn't depend on these two values) still runs.
let pluginJson = {};
let marketJson = {};
if (pluginJsonRaw !== null) {
  try {
    pluginJson = JSON.parse(pluginJsonRaw);
  } catch {
    fail(`plugins/gru953-studio/.claude-plugin/plugin.json is not valid JSON`);
  }
}
if (marketJsonRaw !== null) {
  try {
    marketJson = JSON.parse(marketJsonRaw);
  } catch {
    fail(`.claude-plugin/marketplace.json is not valid JSON`);
  }
}
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
//
// 2026-07-11 Round 3 fix: unlike every sibling invariant above, this check
// had no `else fail(...)` — if the wording were ever rephrased to something
// that doesn't match `/up to (\d+) specialised roles/i` (a rewrite, a typo,
// a translation), the check would silently stop verifying the role count at
// all instead of failing loud, which is the same shape of silent blind spot
// this very invariant exists to close. Now requires the phrase to be found
// in the expected shape at all, not just correct when it happens to match.
//
// 2026-07-11 Round 7 audit fix (real crash, found by execution): the
// `if (!marketPluginDesc) fail(...)` above did not STOP execution — `fail`
// only appends to `problems[]` and returns — so when marketplace.json was
// missing entirely, the very next line called `.match()` on `undefined`
// and the whole script threw an uncaught TypeError. Exit code was still
// non-zero (Node's default for a crash), so CI didn't silently pass, but
// every OTHER problem this script would have reported — including the
// real, useful "marketplace.json is missing" message from INV7 above — was
// lost behind a raw stack trace instead of the structured problem list
// this script exists to produce. Guarded with an early `else` so the rest
// of this invariant only runs when there is a description to check.
const marketPluginDesc = marketJson.plugins && marketJson.plugins[0] && marketJson.plugins[0].description;
if (!marketPluginDesc) {
  fail(`marketplace.json plugins[0].description is missing`);
} else {
  const dm = marketPluginDesc.match(/up to (\d+) specialised roles/i);
  if (!dm) {
    fail(`marketplace.json plugin description does not state a role count in the expected "up to N specialised roles" form: "${marketPluginDesc}"`);
  } else if (parseInt(dm[1], 10) !== agentCount) {
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
