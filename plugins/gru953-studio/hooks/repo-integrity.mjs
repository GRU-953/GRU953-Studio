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
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { frontmatterBlock } from './lib.mjs';

const repoRoot = process.argv[2] || process.cwd();
const pluginRoot = path.join(repoRoot, 'plugins', 'gru953-studio');
const problems = [];
const fail = (msg) => problems.push(msg);

function read(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}
function listDir(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true });
  } catch {
    return [];
  }
}
function frontmatterField(text, field) {
  if (!text) return null;
  // 2026-07-26 audit finding 9: this used to be an LF-only inline regex,
  // which failed on every single agent and skill at once on a CRLF (Windows)
  // checkout. Delegated to lib.mjs's frontmatterBlock(), which every hook
  // that reads frontmatter now shares, so this can't drift out of tolerance
  // again on its own.
  const block = frontmatterBlock(text);
  if (block === null) return null;
  const line = block.split('\n').find((l) => new RegExp('^' + field + ':').test(l.trim()));
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

const agentFiles = listDir(agentsDir)
  .filter((d) => d.isFile() && d.name.endsWith('.md'))
  .map((d) => d.name);
const skillDirs = listDir(skillsDir)
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const hookFiles = listDir(hooksDir)
  .filter((d) => d.isFile() && d.name.endsWith('.mjs'))
  .map((d) => d.name);
const commandFiles = listDir(commandsDir)
  .filter((d) => d.isFile() && d.name.endsWith('.md'))
  .map((d) => d.name);

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
  else if (name !== expected)
    fail(`agent ${f}: name '${name}' does not match filename '${expected}'`);
  if (!desc) fail(`agent ${f}: missing 'description:' frontmatter`);
}

// ---- INV 2: skill frontmatter present & name matches directory ---------------
for (const s of skillDirs) {
  const skillFile = path.join(skillsDir, s, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    fail(`skill '${s}': directory has no SKILL.md`);
    continue;
  }
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
  if (!knownSkillWords.has(s))
    fail(`referenced skill '${s}' (as \`${s}\` skill) has no skills/${s}/SKILL.md`);
}
// Disclosed limitation (2026-07-12 final audit, confirmed by execution, not
// fixed): this check and the bullet-list carve-out just below only match
// specific PROSE shapes. A stale skill name written inside a markdown TABLE
// CELL or a fenced code block would not be caught by either regex. Narrow
// and low-severity (no currently-committed file uses either shape for a
// skill reference), and generalising to match inside tables/code blocks
// reliably would need a real markdown parser rather than line-oriented
// regexes — deliberately left as a known, bounded gap rather than a fix,
// matching this project's established "close the concrete case found, not
// every theoretical shape" pattern used throughout the push-safety matcher.
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
      fail(
        `skills/studio/SKILL.md's companion-skill list references \`${bm[1]}\`, which has no skills/${bm[1]}/SKILL.md`,
      );
    }
  }
}

// ---- INV 4: every referenced hook file exists --------------------------------
const knownHooks = new Set(hookFiles);
const refHook = /hooks\/([a-z0-9-]+\.mjs)/gi;
for (const f of allFiles.filter(
  (x) => x.endsWith('.md') || x.endsWith('.json') || x.endsWith('.yml') || x.endsWith('.mjs'),
)) {
  const text = read(f) || '';
  let m;
  while ((m = refHook.exec(text))) {
    if (!knownHooks.has(m[1]))
      fail(`file ${path.relative(repoRoot, f)} references hooks/${m[1]} which does not exist`);
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
    fail(
      `README's stated ${label} count(s) [${distinct.join(', ')}] do not all match the actual count ${actual}`,
    );
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
if (pluginJsonRaw === null)
  fail(`plugins/gru953-studio/.claude-plugin/plugin.json is missing or unreadable`);
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
if (pv !== undefined && mv !== undefined && pv !== mv)
  fail(`version mismatch: plugin.json=${pv} marketplace.json=${mv}`);

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
const marketPluginDesc =
  marketJson.plugins && marketJson.plugins[0] && marketJson.plugins[0].description;
if (!marketPluginDesc) {
  fail(`marketplace.json plugins[0].description is missing`);
} else {
  const dm = marketPluginDesc.match(/up to (\d+) specialised roles/i);
  if (!dm) {
    fail(
      `marketplace.json plugin description does not state a role count in the expected "up to N specialised roles" form: "${marketPluginDesc}"`,
    );
  } else if (parseInt(dm[1], 10) !== agentCount) {
    fail(
      `marketplace.json plugin description says "up to ${dm[1]} specialised roles" but agents/ has ${agentCount}`,
    );
  }
}

// ---- INV 8: committed roster baseline matches agent count --------------------
// 2026-07-12 final-audit fix: the gap between "role count"/"baseline" and its
// digits was unbounded ([^0-9]*), so a plausible prose edit like "role count:
// grew from 16 in early versions, now 23" read the FIRST digit sequence
// found (16) instead of the real, intended count (23) -- a false-BLOCK
// (fails toward flagging a human, the safe direction, but for the wrong
// reason). Bounded the gap to 10 non-digit characters, matching this file's
// own real "**role count: 23**" phrasing exactly while no longer skipping
// over an entire unrelated sentence to find a later, unintended number.
// 2026-07-12 Round 7 audit fix: the 10-character bound above traded one
// false-block for another -- reproduced live: a maintainer writing
// legitimate, longer explanatory prose around the count (e.g. "role count,
// after the most recent consolidation exercise held on 2026-07-12, now
// stands at 23") still tripped a false BLOCK, because the true digits sat
// well past 10 characters away. Widening the bound again would just
// reopen the ORIGINAL bug (skip past an earlier decoy number). The real
// fix is that ROSTER.md is not free prose to search -- it's a single-
// purpose committed baseline file with one documented, fixed convention
// (this file's own header literally says "**role count: 23**"), so the
// check now requires the digits to sit IMMEDIATELY after "role count"/
// "baseline", separated only by whitespace and an optional `:`/`=` -- not
// bounded-but-arbitrary prose. This still matches the established
// convention exactly (here, and in every Dev-Memory decision file's
// "role count = N" phrasing, checked against this project's own real
// files) while no longer reading past unrelated text in either direction.
const rosterBaselineFile = path.join(pluginRoot, 'ROSTER.md');
const rosterText = read(rosterBaselineFile);
if (rosterText === null) {
  fail(
    `no committed roster baseline at plugins/gru953-studio/ROSTER.md (needed so the product's own roster can be verified)`,
  );
} else {
  const rmAll = [...rosterText.matchAll(/(?:role count|baseline)[ \t]*[:=]?[ \t]*(\d+)/gi)];
  const rm = rmAll.length ? rmAll[rmAll.length - 1] : null;
  if (!rm) fail(`ROSTER.md does not state a numeric "role count: <n>"`);
  else if (parseInt(rm[1], 10) !== agentCount)
    fail(`ROSTER.md role count ${rm[1]} != actual agent count ${agentCount}`);
}

// ---- INV 10: hooks.json still actually wires the publish-safety hooks --------
// 2026-07-12 Round 8 audit fix (real gap, found by direct execution): a
// reviewer proved live that reverting hooks.json's matcher back to just
// "Bash" (silently disabling the whole publish-safety mechanism for the
// PowerShell tool — exactly the Round 7-documented failure mode) still
// left every gate this project trusts before a commit fully green: JSON
// parses fine, hooks.test.mjs invokes scan.mjs/gate.mjs directly via
// spawnSync (bypassing hooks.json entirely), and this very script had no
// check on hooks.json's actual content, only that referenced hook
// FILENAMES resolve (INV 4). Nothing previously verified the fix itself
// stays in place.
// 2026-07-12 second fix (two bugs found by direct execution against
// constructed hooks.json variants): the original anchor-based regex
// (`/(^|[|,])\s*Bash\s*($|[|,])/`) required "Bash"/"PowerShell" to be
// immediately preceded by "^", "|", or ",", so a parenthesised/anchored
// but functionally-identical matcher like "(Bash|PowerShell)" or
// "^(Bash|PowerShell)$" was wrongly reported BLOCKED (false-BLOCK) purely
// because "(" isn't one of those three characters. Fixed by parsing the
// matcher properly: split on the real separator(s), then strip any
// wrapping "(", ")", "^", "$" from each alternative before comparing it
// exactly to the tool name. This recognises "(Bash|PowerShell)" /
// "^(Bash|PowerShell)$" as valid coverage.
// 2026-07-12 Claude-Topics compliance fix: the intervening version of this
// comment (and this function) asserted that "," is never a valid
// OR-separator and that a comma-joined matcher "never actually matches at
// runtime" — that claim is false. Claude Code's own hooks reference
// documents a matcher built only from letters/digits/_/-/spaces/,/| as "a
// list of exact strings separated by | or , with optional surrounding
// whitespace" (comma support requires Claude Code v2.1.191+; this plugin
// declares no version floor, so nothing here assumes an older install).
// The prior fix had it backwards — treating a documented-valid "Bash,PowerShell"
// as missing coverage would itself be a false-BLOCK on this project's own
// integrity gate. Fixed by splitting on both "|" and ",".
// 2026-07-12 second Claude-Topics compliance fix: the built-in Monitor tool
// also runs shell commands, through the identical `command` field and the
// same Bash-style permission-rule format ("Bash(npm run *)" applies to both
// Bash and Monitor per tools-reference.md) — but wasn't in the matcher or
// this check, exactly the same class of total, silent bypass Round 7 found
// and fixed for PowerShell. Added the same INV10 coverage check for it.
function matcherAlternatives(matcher) {
  // 2026-08-05 further-pass audit fix (found by execution): a single-sided
  // wrapper like "(Bash|PowerShell|Monitor" (a stray "(", no closing ")")
  // still named all three tools after the strip below, so INV10 reported the
  // publish-safety hooks covered when the matcher was a malformed config error
  // and would never match at runtime. Fail closed: an unbalanced "("/"[" —
  // i.e. a matcher that is not the documented `|`/`,`-separated exact-string
  // list with optional wrapping — contributes NO alternatives at all, so it
  // can never satisfy a coverage claim. Balanced "(Bash|PowerShell)" and
  // "^(Bash|PowerShell)$" still work exactly as before.
  const opens = (matcher.match(/[(\[]/g) || []).length;
  const closes = (matcher.match(/[)\]]/g) || []).length;
  if (opens !== closes) return [];
  return matcher.split(/[|,]/).map((part) =>
    part
      .trim()
      .replace(/^[(^]+/, '')
      .replace(/[)$]+$/, '')
      .trim(),
  );
}
function matcherCoversTool(matchers, toolName) {
  return matchers.some((m) => matcherAlternatives(m).includes(toolName));
}
const hooksJsonFile = path.join(pluginRoot, 'hooks', 'hooks.json');
const hooksJsonText = read(hooksJsonFile);
if (hooksJsonText === null) {
  fail(`no plugins/gru953-studio/hooks/hooks.json found`);
} else {
  let hooksJson;
  try {
    hooksJson = JSON.parse(hooksJsonText);
  } catch (e) {
    fail(`hooks.json is not valid JSON: ${e.message}`);
    hooksJson = null;
  }
  if (hooksJson) {
    const preToolUse =
      hooksJson.hooks && Array.isArray(hooksJson.hooks.PreToolUse)
        ? hooksJson.hooks.PreToolUse
        : [];
    const matchers = preToolUse.map((e) => String(e.matcher || ''));
    const coversBash = matcherCoversTool(matchers, 'Bash');
    const coversPowerShell = matcherCoversTool(matchers, 'PowerShell');
    const coversMonitor = matcherCoversTool(matchers, 'Monitor');
    if (!coversBash)
      fail(
        `hooks.json's PreToolUse matcher no longer covers "Bash" — the publish-safety hooks would not run for ordinary shell commands`,
      );
    if (!coversPowerShell)
      fail(
        `hooks.json's PreToolUse matcher no longer covers "PowerShell" — the publish-safety hooks would silently not run on native Windows without Git Bash (2026-07-12 Round 7 fix regressed)`,
      );
    if (!coversMonitor)
      fail(
        `hooks.json's PreToolUse matcher no longer covers "Monitor" — a push-capable command run via the Monitor tool would bypass both scan.mjs and gate.mjs entirely (2026-07-12 Claude-Topics compliance fix regressed)`,
      );
    const allCommands = preToolUse
      .flatMap((e) => (Array.isArray(e.hooks) ? e.hooks : []))
      .map((h) => String(h.command || ''));
    if (!allCommands.some((c) => /scan\.mjs/.test(c)))
      fail(`hooks.json no longer wires scan.mjs as a PreToolUse hook`);
    if (!allCommands.some((c) => /gate\.mjs/.test(c)))
      fail(`hooks.json no longer wires gate.mjs as a PreToolUse hook`);
  }
}

// ---- INV 11: every language pack declares the six standard commands ----------
// 2026-07-19 (Phase 5 language-pack contract). Each `lang-*` skill is the shared
// toolchain pack a native language specialist loads; a pack missing one of the
// standard command families (build / test / lint / format / deps / package)
// would let a language ship half-wired — a specialist with no way to prove or
// check its work, or no way to actually FINISH the app. This makes the
// contract mechanical: a new `lang-*` pack cannot land without all six, the
// same way a new agent cannot land without a roster entry.
//
// 2026-07-26 audit finding 15: 'package' added as the sixth required family.
// All ten packs covered build/test/lint/format/deps but stopped at "compiles"
// — none named the actual command that produces a finished, installable
// artefact (an .apk, an .ipa, a live URL). For a non-technical owner whose
// goal is "an app on my phone", compiling is not the finish line.
//
// The obvious first regex (`\bpackage\b`) turned out NOT to discriminate —
// confirmed by execution, reverting each pack one at a time: "package" is
// already ordinary vocabulary in at least six of the ten ecosystems on their
// own terms, entirely unrelated to shipping a finished app — Go's own
// `package` keyword, npm's `package.json`, NuGet's `dotnet add package`,
// Swift Package Manager, and "third-party package" in several packs'
// existing YAGNI-ladder prose. A bare word match would have reported every
// pack compliant whether or not this fix had actually landed. Narrowed to
// the specific tool/artefact names each pack's real packaging command
// actually uses, verified by execution to appear in NONE of the ten packs
// before this finding was fixed and in ALL TEN after.
const REQUIRED_PACK_COMMANDS = [
  { key: 'build', re: /\bbuild\b/i },
  { key: 'test', re: /\btest\b/i },
  {
    key: 'lint',
    re: /\blint\b|\banalys|clippy|ktlint|detekt|checkstyle|clang-tidy|\bruff\b|flake8/i,
  },
  { key: 'format', re: /\bformat\b|fmt|spotless|clang-format|\bblack\b/i },
  {
    key: 'deps',
    re: /\bdepend|\bdeps\b|cargo\.toml|pubspec|requirements|pom\.xml|build\.gradle|vcpkg|conan|pip install|pub add|cargo add/i,
  },
  {
    key: 'package',
    re: /jpackage|pyinstaller|eas build|cargo tauri|exportarchive|dotnet publish|assemblerelease|bundlerelease|\bcpack\b|appimage|\.aab\b|\.ipa\b|\.dmg\b|\.msi\b|github releases?/i,
  },
];
for (const s of skillDirs) {
  if (!/^lang-/.test(s)) continue;
  const text = read(path.join(skillsDir, s, 'SKILL.md')) || '';
  const missing = REQUIRED_PACK_COMMANDS.filter((c) => !c.re.test(text)).map((c) => c.key);
  if (missing.length)
    fail(
      `language pack 'skills/${s}' does not declare the required command famil${missing.length === 1 ? 'y' : 'ies'}: ${missing.join(', ')} — a lang-* pack must cover build, test, lint, format, deps and package.`,
    );
}

// ---- INV 12: the publish protocol enumerates all seven pre-flight checks -----
// 2026-07-21 audit fix: publish-github/SKILL.md listed only FOUR pre-flight
// checks while security-compliance-auditor.md (the gate's owner) declares SEVEN
// — quality-gate.mjs, traceability-check.mjs and content-check.mjs were never
// enumerated, so an agent following the protocol as written ran four and honestly
// reported success while silently skipping three mandatory gates. Guard the
// reconciliation mechanically so the most safety-critical flow cannot drift again:
// the publish protocol must name every mandatory check hook by filename.
const publishSkill = read(path.join(pluginRoot, 'skills', 'publish-github', 'SKILL.md'));
if (publishSkill === null) {
  fail('skills/publish-github/SKILL.md is missing or unreadable — cannot verify the Publish gate');
} else {
  for (const h of [
    'scan.mjs',
    'licence-scan.mjs',
    'verify-progress.mjs',
    'quality-gate.mjs',
    'traceability-check.mjs',
    'content-check.mjs',
    'roster-check.mjs',
  ]) {
    if (!publishSkill.includes(h)) {
      fail(
        `publish-github/SKILL.md no longer references ${h} — the Publish protocol must enumerate all seven blocking checks plus the roster check (2026-07-21 reconciliation regressed)`,
      );
    }
  }
}
// 2026-07-21 Round 2 fix: INV12 above guarded publish-github/SKILL.md only, but
// the "four vs seven" drift also lived in maintenance-agent.md and the
// studio-publish command description. Guard every file on the publish path against
// a stale "four ... checks" count so the reconciliation cannot silently regress.
for (const rel of [
  'agents/maintenance-agent.md',
  'commands/studio-publish.md',
  'agents/publisher.md',
]) {
  const t = read(path.join(pluginRoot, rel));
  if (t === null) {
    fail(`${rel} is missing or unreadable — cannot verify its publish pre-flight check count`);
  } else if (/\bfour\b[^.\n]{0,40}(blocking|security|pre-?flight)[^.\n]{0,24}checks/i.test(t)) {
    fail(
      `${rel} still describes "four ... checks" on the publish path — the Publish gate now has seven blocking checks (2026-07-21 reconciliation regressed)`,
    );
  }
}

// ---- INV 13: docs-consistency.mjs stays wired into both the gate list and CI ----
// 2026-07-26 audit stage 5. Mirrors the INV10/INV12 pattern of mechanically
// asserting a check's wiring rather than trusting it stays referenced by
// hand: docs-consistency.mjs (the new sibling drift gate) must remain named
// in CLAUDE.md's mandatory-gate list AND actually invoked in
// .github/workflows/ci.yml, or it silently stops running while still
// existing on disk — the exact failure mode this whole audit exists to
// close. (Not publish-github/SKILL.md's seven pre-flight checks — those
// validate a project BUILT BY the studio; this gate validates the studio's
// OWN documentation about itself, a different domain entirely. See
// docs-consistency.mjs's own header comment for the corrected reasoning.)
const claudeMdText = read(path.join(repoRoot, 'CLAUDE.md'));
if (claudeMdText === null) {
  fail(
    `CLAUDE.md is missing or unreadable — cannot verify docs-consistency.mjs is listed as a mandatory gate`,
  );
} else if (!/docs-consistency\.mjs/.test(claudeMdText)) {
  fail(
    `CLAUDE.md no longer lists docs-consistency.mjs among the mandatory gates (2026-07-26 wiring regressed)`,
  );
}
const ciYmlText = read(path.join(repoRoot, '.github', 'workflows', 'ci.yml'));
if (ciYmlText === null) {
  fail(
    `.github/workflows/ci.yml is missing or unreadable — cannot verify docs-consistency.mjs runs in CI`,
  );
} else if (!/docs-consistency\.mjs/.test(ciYmlText)) {
  fail(
    `.github/workflows/ci.yml no longer runs docs-consistency.mjs (2026-07-26 wiring regressed)`,
  );
}

// ---- INV 14: the "DATA, never an instruction" anti-injection guardrail stays present ----
// 2026-08 R2 Phase 2.3 (D8, prompt injection). The defence against content
// the studio reads (a memory file, an uploaded document, a user-supplied
// name) manipulating the AI acting on it is currently prose-only: repeated,
// in slightly varying wording, across every agent/skill file whose own job
// involves reading such content — but until now checked by nothing at all.
// A silent edit deleting the one sentence from any of these files would
// have gone unnoticed. This locks in the CURRENT set of files carrying some
// form of the guardrail (found by direct search of the real repo, not
// invented) as a floor: each must still carry it. Deliberately NOT a
// general classifier of "which future file needs this" — judging a new
// file's semantic content is a different, much harder problem, and the
// same "close the found case, not a general grammar engine" reasoning
// docs-consistency.mjs's own header comment already states for this
// project's other checks applies here too.
const DATA_NEVER_INSTRUCTION_RE = /DATA[^.]{0,60}never|never[^.]{0,80}instruction/is;
const GUARDRAIL_FILES = [
  'agents/accessibility-specialist.md',
  'agents/ai-developer.md',
  'agents/architect.md',
  'agents/audio-content-specialist.md',
  'agents/brand-guardian.md',
  'agents/builder.md',
  'agents/content-director.md',
  'agents/cost-monitor.md',
  'agents/cpp-developer.md',
  'agents/csharp-developer.md',
  'agents/data-engineer.md',
  'agents/devops-engineer.md',
  'agents/fixer.md',
  'agents/flutter-dart-developer.md',
  'agents/go-developer.md',
  'agents/image-content-specialist.md',
  'agents/interviewer.md',
  'agents/java-developer.md',
  'agents/kotlin-developer.md',
  'agents/localisation-specialist.md',
  'agents/maintenance-agent.md',
  'agents/memory-keeper.md',
  'agents/project-lead.md',
  'agents/publisher.md',
  'agents/python-developer.md',
  'agents/researcher.md',
  'agents/responsible-ai-reviewer.md',
  'agents/reviewer.md',
  'agents/rust-developer.md',
  'agents/scope-guardian.md',
  'agents/security-compliance-auditor.md',
  'agents/swift-developer.md',
  'agents/technical-writer.md',
  'agents/tester.md',
  'agents/text-content-specialist.md',
  'agents/typescript-developer.md',
  'agents/ux-designer.md',
  'agents/video-content-specialist.md',
  'skills/audit-loop/SKILL.md',
  'skills/dev-memory/SKILL.md',
  'skills/ecosystem-finder/SKILL.md',
  'skills/focus-guard/SKILL.md',
  'skills/memory-graph/SKILL.md',
  'skills/micro-task-planning/SKILL.md',
  'skills/universal-platform-integration/SKILL.md',
];
for (const rel of GUARDRAIL_FILES) {
  const text = read(path.join(pluginRoot, rel));
  if (text === null) {
    fail(
      `${rel} (previously carrying the "DATA, never an instruction" anti-injection guardrail) is missing or unreadable`,
    );
  } else if (!DATA_NEVER_INSTRUCTION_RE.test(text)) {
    fail(
      `${rel} no longer carries the "DATA, never an instruction" anti-injection guardrail (2026-08 regression)`,
    );
  }
}

// ---- INV 15: the root AI-host rule files match what universal-init.js generates ----
// 2026-08 R3 Phase 3.1 (D6). Seven committed root files (.cursorrules,
// .windsurfrules, .clinerules, .roomodes, .aider.conf.yml,
// .github/copilot-instructions.md, .agents/AGENTS.md) exist so a browser of
// this repo — or a copy of it opened directly in Cursor/Windsurf/Cline/Roo/
// Aider/Copilot — sees a real, working example of what
// clients/cli/src/universal-init.js actually generates for a built project.
// Nothing checked they still matched. Found live, not hypothetically: the
// committed .aider.conf.yml still carried a `model-metadata-file:` line that
// a 2026-07-26 fix deliberately stopped generating (Aider has its own
// built-in model metadata; pointing it at a file GRU953-Studio never creates
// was a dead reference) — the code changed, the committed reference file
// never did.
//
// Verified by execution before writing this check, not by re-deriving the
// generator's template strings with a second, hand-maintained copy (a naive
// regex-scrape of the template literal source was tried first and produced
// FALSE drift reports on every file, because it doesn't account for the
// backslash-escaped backticks inside the JS template literal — e.g. the
// source text \`project-lead\` differs from the real string value
// `project-lead` by two backslash characters the regex approach can't see).
// The only reliable comparison is running the REAL generator and reading
// its REAL output, which is exactly what this does: import
// initializeUniversalRules from the actual CLI module and run it against a
// throwaway temp directory, then diff its output (with the generator's own
// BEGIN/END markers stripped, since the committed reference copies are
// deliberately unmarked, human-readable examples) against each committed
// file.
async function checkHostRuleFiles() {
  const generatorPath = path.join(repoRoot, 'clients', 'cli', 'src', 'universal-init.js');
  if (!fs.existsSync(generatorPath)) {
    fail(
      `clients/cli/src/universal-init.js is missing — cannot verify the root AI-host rule files still match it`,
    );
    return;
  }
  let initializeUniversalRules;
  try {
    // 2026-08 R3 (found live on the Windows CI leg): a bare `import()` of a
    // path.resolve()'d absolute path works on POSIX but throws on Windows —
    // `D:\a\...` looks like a URL with scheme "d:" to Node's ESM loader
    // ("Only URLs with a scheme in: file, data, and node are supported"),
    // which made this whole check fail on every Windows run. pathToFileURL()
    // builds the correct `file://` URL for either platform.
    ({ initializeUniversalRules } = await import(pathToFileURL(path.resolve(generatorPath))));
  } catch (e) {
    fail(`clients/cli/src/universal-init.js could not be loaded: ${e.message}`);
    return;
  }
  if (typeof initializeUniversalRules !== 'function') {
    fail(
      `clients/cli/src/universal-init.js no longer exports initializeUniversalRules — cannot verify the root AI-host rule files`,
    );
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gru953-hostrule-gen-'));
  // initializeUniversalRules() calls console.log() for real CLI users' own
  // benefit (it's meant to be run interactively) — but this script's stdout
  // is reserved for the final JSON report (like every other hook in this
  // repo, e.g. gate.mjs's own "stdout is reserved for the decision JSON").
  // Confirmed by execution: without silencing it, stdout starts with
  // "Initializing GRU953-Studio rules..." and every subsequent
  // JSON.parse(stdout) call — including this project's own test harness —
  // fails on invalid JSON. Restored in the finally block regardless of
  // outcome, so a thrown error can never leave console.log silenced for the
  // rest of the process.
  const realConsoleLog = console.log;
  console.log = () => {};
  try {
    initializeUniversalRules(tmpDir);
    const HOST_RULE_FILES = [
      '.cursorrules',
      '.windsurfrules',
      '.clinerules',
      '.roomodes',
      '.aider.conf.yml',
      '.github/copilot-instructions.md',
      '.agents/AGENTS.md',
    ];
    // Normalises line endings AND strips the generator's own markers, so a
    // CRLF-encoded committed copy (a real Windows checkout — see
    // .gitattributes' own header comment on exactly this class of issue) is
    // compared on CONTENT, not line-ending style. Found live: this file's own
    // CRLF regression test converts every .md file (including
    // .github/copilot-instructions.md and .agents/AGENTS.md) to CRLF and
    // asserted repo-integrity.mjs stays clean — it didn't, until `committed`
    // was normalised the same way `generated` already is.
    const normalise = (s) =>
      s
        .split(/\r?\n/)
        .filter((line) => !/GRU953-STUDIO:(BEGIN|END)/.test(line))
        .join('\n')
        .trim();
    for (const rel of HOST_RULE_FILES) {
      const generated = read(path.join(tmpDir, rel));
      const committed = read(path.join(repoRoot, rel));
      if (generated === null) {
        fail(
          `INV15: universal-init.js no longer generates ${rel} at all — the committed copy is now orphaned`,
        );
        continue;
      }
      if (committed === null) {
        fail(
          `INV15: ${rel} is missing from the repo root but universal-init.js still generates it`,
        );
        continue;
      }
      if (normalise(generated) !== normalise(committed)) {
        fail(
          `INV15: ${rel} no longer matches what clients/cli/src/universal-init.js generates (the committed reference copy has drifted from the real generator output)`,
        );
      }
    }
  } catch (e) {
    // 2026-08-05 further-pass audit fix (found by execution): this block had
    // only a `finally`, so a throw from initializeUniversalRules() (or
    // anything inside the try) propagated up through `await checkHostRuleFiles()`
    // as an unhandled rejection — a raw Node stack trace on stderr and NO
    // JSON on stdout at all, losing the entire structured report this script
    // exists to produce. The throw is now caught and surfaced as one ordinary
    // BLOCKED problem like every other integrity failure, so a broken
    // generator can never silently turn this gate into a raw crash.
    fail(
      `INV15: could not run clients/cli/src/universal-init.js's initializeUniversalRules to verify the root AI-host rule files: ${e && e.message ? e.message : String(e)}`,
    );
  } finally {
    console.log = realConsoleLog;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
await checkHostRuleFiles();

// ---- report ------------------------------------------------------------------
if (problems.length === 0) {
  console.log(
    JSON.stringify(
      {
        status: 'clean',
        agentCount,
        skillCount,
        hookCount: hookFiles.length,
        commandCount: commandFiles.length,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
console.log(JSON.stringify({ status: 'BLOCKED', problems, agentCount, skillCount }, null, 2));
process.exit(1);
