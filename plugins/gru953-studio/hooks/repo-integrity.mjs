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
//
// 2026-08-16, finding X215. This asserted that every `hooks/<name>.mjs` mentioned ANYWHERE in
// the repository exists on disk. For a live instruction that is exactly right: a skill telling a
// user to run a script that is gone is a broken product.
//
// For a RECORD it is the opposite. A changelog entry describing the day a hook was removed must
// name that hook — that is what the entry IS. So must a findings register describing the defect
// that removed it. Under the old rule those files became unfixable: the only way to satisfy the
// check was to delete the history, which is falsifying a record to satisfy a check about records.
//
// Not hypothetical — removing the push-authorisation layer (X214) put this invariant into
// exactly that state, blocking on CHANGELOG.md, Dev-Memory/FINDINGS.md and an archived plan,
// none of which instructs anybody to do anything.
//
// The distinction is a property of the FILE, not of the sentence, and it is stated once by
// CATEGORY rather than by exempting whichever file blocked today. Exempting one file at a time
// ends with an invariant that covers nothing and still reports clean.
//
// Reproduction: hooks/test/repro/X215-live-versus-historical-reference.mjs, whose controls A, B
// and C hold a live skill, agent and command naming a missing hook and require each to BLOCK —
// so an exemption drawn wide enough to swallow a genuinely broken instruction fails the test.
// Three categories are exempt, each because naming a missing hook is its JOB, not a defect:
//
//   RECORDS      describe what happened. A changelog entry about removing a hook must name it.
//   TEST MATERIAL must name a file that does not exist in order to test the does-not-exist case.
//                 X215's own reproduction does exactly this, deliberately.
//   BUILD OUTPUT  under clients/cli/plugin/ is regenerated from the source this check already
//                 covers. Whether that copy is STALE is a different question, and it has its own
//                 finding (X38); answering it here would mean this invariant reporting the same
//                 defect twice under a name that does not describe it.
//
// Everything else — skills, agents, commands, hooks, README, SECURITY.md, the manifests — is a
// live instruction and stays covered. That boundary is what controls A, B and C pin.
const EXEMPT_FROM_INV4_RE = new RegExp(
  [
    '(^|/)(CHANGELOG\\.md|AUDIT-[^/]*\\.md)', // records
    '(^|/)Dev-Memory/',
    '(^|/)\\.kilo/',
    '[^/]*-audit-[^/]*\\.md',
    '(^|/)hooks/test/', // test material
    '(^|/)clients/cli/plugin/', // build output
  ].join('|'),
  'i',
);
const isHistoricalRecord = (f) => EXEMPT_FROM_INV4_RE.test(path.relative(repoRoot, f));
// The packaging copy, named once so the two places that care cannot drift apart: it is exempt as a
// PLACE references may live (above), and it is also not admissible as EVIDENCE that a file exists
// (X219, below).
const isBuildOutput = (f) => /(^|\/)clients\/cli\/plugin\//.test(path.relative(repoRoot, f));

const knownHooks = new Set(hookFiles);
const refHook = /hooks\/([a-z0-9-]+\.mjs)/gi;

// 2026-08-17, finding X219. The rule above recognises only ONE spelling — a reference must carry
// the `hooks/` prefix. Prose almost never writes it that way, so the commonest form of a broken
// reference was invisible, and the comment above claiming SECURITY.md "stays covered" was true of
// one spelling only. Measured: 36 references to five hooks X214 deleted (`gate.mjs` and its four
// `confirm-*.mjs` minters) had accumulated across SECURITY.md, four skills, an agent and a command
// while this invariant reported clean. Four were live INSTRUCTIONS to run a script that is gone.
//
// X215 hardened this same invariant the day before and missed it, because all three of its
// live-instruction controls used the prefixed spelling too — a control inherits the author's blind
// spot unless something forces the other case. X219's control E now holds the prefixed form so
// widening cannot trade one blind spot for the other.
//
// The bare rule is narrow on purpose, and the narrowness was measured before it was written: flag a
// bare `<name>.mjs` only when NO file of that basename exists ANYWHERE in the repository. Live prose
// carries 117 bare `.mjs` references; exactly five names exist nowhere, and all five are the deleted
// ones. So `lib.mjs`, every gate, and every reproduction filename quoted in a document stay silent —
// zero false alarms on this tree. That mattered more than reach: a guard that interrupts honest work
// gets switched off, taking the real protection with it (L5), and 112 false alarms would have done
// exactly that. Controls B and C pin both halves.
//
// PROSE ONLY, deliberately. `.mjs` files carry 70 bare references to `gate.mjs` in comments
// explaining how a past fix came about — "gate.mjs's first line exited before the check ran", and
// so on. Those are records in the sense X215 established: a comment describing what happened must
// name the thing it happened to, and the only way to satisfy a check about them is to delete the
// history. A skill telling an agent to run a script is the opposite — an instruction, and a false
// one is a broken product. The distinction is instruction versus record, one level finer than X215
// drew it, and it is drawn by file KIND rather than by exempting whichever file blocked today.
// Built from SOURCE only. `walk()` reads the filesystem, not git, and the packaging copy under
// clients/cli/plugin/ is regenerated rather than tracked — it still holds a gate.mjs from before
// X214 deleted it. Counting that copy as proof the hook exists made this rule report clean on all
// 36 references, which is how the first version of it was measured as finding nothing. A stale copy
// answering "does this still exist?" is the standing rule in reverse: evidence gathered from
// clients/cli/plugin/ is evidence about the copy, never about the source. Whether that copy is stale
// is X38's question, not this one.
const anyMjsBasename = new Set(
  allFiles.filter((x) => x.endsWith('.mjs') && !isBuildOutput(x)).map((x) => path.basename(x)),
);
const refBareHook = /(?<![A-Za-z0-9._/-])([a-z0-9][a-z0-9-]*\.mjs)/gi;

for (const f of allFiles.filter(
  (x) => x.endsWith('.md') || x.endsWith('.json') || x.endsWith('.yml') || x.endsWith('.mjs'),
)) {
  if (isHistoricalRecord(f)) continue;
  const text = read(f) || '';
  let m;
  refHook.lastIndex = 0;
  while ((m = refHook.exec(text))) {
    if (!knownHooks.has(m[1]))
      fail(`file ${path.relative(repoRoot, f)} references hooks/${m[1]} which does not exist`);
  }
  if (f.endsWith('.mjs')) continue; // records, per the note above
  // A reference that DISCLOSES the removal is a record and passes, per X215: "gate.mjs (removed
  // 2026-08-16, finding X214) checked specifically for visibility-changing commands" is true, useful,
  // and the only way to satisfy a check that rejected it would be to delete the sentence. What is
  // NOT allowed is naming a removed file as though it were still there.
  //
  // The unit is the PARAGRAPH, not the line, and that was learned by getting it wrong first. A
  // per-line rule looked tighter and was measured against these same files: this prose is hard
  // wrapped near 76 characters, so a sentence routinely spans three or four lines and the disclosure
  // lands on a different line from the filename. Five true records failed that way, and satisfying
  // it would have meant reflowing sentences to suit a checker — the same anti-pattern X215 named,
  // where the only way to pass is to distort the record. A paragraph is the natural unit of one
  // claim in markdown and cannot reach across a blank line into an unrelated section. X219's
  // controls F and G pin both directions: a wrapped disclosure passes, a disclosure in a NEIGHBOURING
  // paragraph does not.
  //
  // An explicit removal word is required. "previously" and "used to" also open sentences that go on
  // to describe present behaviour, so they do not count.
  const DISCLOSES = /\b(removed|deleted|no longer\b|never existed)\b/i;
  const paras = [];
  {
    let start = 0;
    let line = 1;
    for (const block of text.split('\n\n')) {
      paras.push({ start, end: start + block.length, line, text: block });
      start += block.length + 2;
      line += block.split('\n').length + 1;
    }
  }
  const paraAt = (idx) => paras.find((p) => idx >= p.start && idx <= p.end);
  refBareHook.lastIndex = 0;
  while ((m = refBareHook.exec(text))) {
    if (anyMjsBasename.has(m[1])) continue;
    const para = paraAt(m.index);
    if (para && DISCLOSES.test(para.text)) continue;
    const lineNo = text.slice(0, m.index).split('\n').length;
    fail(
      `file ${path.relative(repoRoot, f)}:${lineNo} references ${m[1]}, which does not exist ` +
        'anywhere in this repository. If it was removed, say so in the same paragraph — a record ' +
        'may name a deleted file, a live instruction may not.',
    );
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
    // 2026-08-15, finding X116 (High, reproduced). `matchers` above and `allCommands`
    // here were both computed over ALL PreToolUse entries and never correlated. So
    // "some entry covers Bash" and "some entry runs scan.mjs" could be satisfied by two
    // DIFFERENT entries, and scan.mjs need never run on a Bash command at all — which is
    // exactly what these invariants exist to guarantee. Two true statements were standing
    // in for the one structural fact that matters.
    //
    // Now correlated: for each required hook, find the entries that actually run it, and
    // require at least one of THOSE entries to cover the tools the guard must cover.
    // Reproduction: hooks/test/repro/X116-X117-weaker-predicate.mjs.
    const REQUIRED_TOOLS = ['Bash', 'PowerShell', 'Monitor'];
    // 2026-08-16, X214: `gate.mjs` was removed. Dropping it from this list is deliberate, not an
    // oversight — the push-authorisation token layer it enforced could not establish what it
    // claimed (X91: anything the hook can read, an agent can write), and this list must describe
    // the product that exists. `scan.mjs` STAYS required: the secret scan refuses on evidence,
    // and a build that silently stopped wiring it would ship credentials with nothing objecting.
    for (const required of ['scan.mjs']) {
      const entriesRunningIt = preToolUse.filter((e) =>
        (Array.isArray(e.hooks) ? e.hooks : []).some((h) =>
          new RegExp(required.replace('.', '\\.')).test(String(h.command || '')),
        ),
      );
      if (entriesRunningIt.length === 0) {
        fail(`hooks.json no longer wires ${required} as a PreToolUse hook`);
        continue;
      }
      const itsMatchers = entriesRunningIt.map((e) => String(e.matcher || ''));
      const uncovered = REQUIRED_TOOLS.filter((t) => !matcherCoversTool(itsMatchers, t));
      if (uncovered.length > 0) {
        fail(
          `hooks.json no longer wires ${required} under a matcher covering ${uncovered.join(', ')} — it is registered, but not for the tool(s) it exists to guard, so a push-capable command run that way bypasses it entirely (finding X116)`,
        );
      }
    }
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

// 2026-08-15, finding X117 (High, reproduced). The two checks below claim a gate RUNS in
// CI. What they tested was that its FILENAME occurs somewhere in ci.yml — in a step, in a
// job name, in a comment, anywhere. Delete the `run:` line and the check stayed quiet as
// long as the name survived in prose.
//
// That is not hypothetical here: ci.yml carries a comment reading "docs-consistency.mjs's
// lifecycle-stage-count check located its target paragraph with a literal \n\n…". That
// comment alone satisfied the old test, so the step it guards could have been removed
// today and nothing would have noticed.
//
// Comment lines are stripped before testing. A YAML parser would be stronger still, but
// it would be a dependency, and this closes the demonstrated hole: prose no longer counts
// as wiring. Reproduction: hooks/test/repro/X116-X117-weaker-predicate.mjs.
const ciYmlCode =
  ciYmlText === null
    ? null
    : ciYmlText
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');
if (ciYmlText === null) {
  fail(
    `.github/workflows/ci.yml is missing or unreadable — cannot verify docs-consistency.mjs runs in CI`,
  );
} else if (!/docs-consistency\.mjs/.test(ciYmlCode)) {
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
// 2026-08-17, finding X206. This had two alternatives, and the FIRST one was satisfiable by
// prose that merely talks ABOUT the guardrail. `agents/data-engineer.md` contains the sentence
// "data - one of the safety floors that is never ...", which matches `DATA[^.]{0,60}never`
// while saying nothing about instructions. Delete that file's real guardrail and INV14 still
// passed - the regression detector for the one event this invariant exists to catch was gone.
//
// The fix is to DROP the weak alternative, not to write a cleverer pattern. The surviving
// alternative requires the word `instruction`, which is what makes the clause a rule about
// instructions rather than a sentence containing the word `data`.
//
// Measured before and after across all 46 guardrail files: 0 failed under the old pattern, 0
// fail under this one - so no honest file is newly blocked - and deleting a real guardrail now
// fails where it previously passed. X206's control D holds a REWORDED but intact guardrail,
// because the clause is written differently in 13 measured forms across those 46 files and a
// fix demanding one exact sentence would be reverted within a week.
const DATA_NEVER_INSTRUCTION_RE = /never[^.]{0,80}instruction/is;
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
  // 2026-08-10: the charter is the single most attractive target for injected
  // text — content that successfully rewrote the charter would rewrite how the
  // studio treats its own owner — so it carries the guardrail itself.
  'skills/operating-charter/SKILL.md',
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
      // 2026-08-10 (operating charter): the unabridged charter this generator
      // now also writes, for a host that reads project files but cannot load a
      // Claude skill (Aider, via its own `read:` list). Listed here for the
      // same reason as its six siblings — a committed reference copy that
      // drifts from the real generator output is precisely the defect INV15
      // exists to catch.
      '.agents/OPERATING-CHARTER.md',
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

// ---- INV 16: charter-check.mjs stays wired into both the gate list and CI ----
// 2026-08-10, added with the operating charter. Deliberately the same shape as
// INV13 above, for the same reason and against the same failure mode: a gate
// that still exists on disk but is named in neither CLAUDE.md's mandatory list
// nor .github/workflows/ci.yml has silently stopped running, while every
// green result continues to look exactly as trustworthy as before. That is the
// worst class of defect in this repository — nobody re-checks a passing gate.
//
// Checked against BOTH files on purpose, not either-or: CLAUDE.md alone would
// leave CI silently skipping it, and CI alone would leave a human following
// this repo's own documented pre-commit routine unaware it existed.
if (claudeMdText === null) {
  // Already reported by INV13's own null check — not repeated here.
} else if (!/charter-check\.mjs/.test(claudeMdText)) {
  fail(
    `CLAUDE.md no longer lists charter-check.mjs among the mandatory gates — the operating charter's two copies could drift apart unnoticed (2026-08-10 wiring regressed)`,
  );
}
if (ciYmlText === null) {
  // Already reported by INV13's own null check — not repeated here.
} else if (!/charter-check\.mjs/.test(ciYmlCode)) {
  fail(`.github/workflows/ci.yml no longer runs charter-check.mjs (2026-08-10 wiring regressed)`);
}

// ---- INV 17: no hook grants a blanket approval; only gate.mjs may authorise ----
// 2026-08-13, finding X1 (CRITICAL, reproduced by execution — see
// hooks/test/repro/X1-auto-approval.mjs). lib.mjs used to export a single
// allow() that emitted `permissionDecision: "allow"` on every path where a hook
// had no objection. Per the documented PreToolUse contract that value "permit[s]
// the tool call to proceed without a permission prompt", so this plugin was
// silently switching off the user's own permission prompts for every non-push
// shell command — `rm -rf`, `curl … | sh` and `cat ~/.ssh/id_rsa` among them.
//
// The corrected design splits that into stepAside() (emit nothing — the
// documented neutral) and authorise(reason) (emit "allow"), and confines the
// latter to gate.mjs's two freshly-confirmed-token paths. This invariant is what
// stops a future edit undoing that split quietly: a unit test can be deleted,
// but a missing invariant fails the gate every contributor is told to run.
{
  const HOOKS_DIR = hooksDir;
  let hookFiles = [];
  try {
    hookFiles = fs.readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.mjs'));
  } catch {
    fail(`INV17: could not read ${HOOKS_DIR} to check for blanket approvals`);
  }
  for (const f of hookFiles) {
    // Both of these necessarily quote the very pattern being searched for — the
    // test suite asserts on it, and this file defines it — so scanning them
    // would report a permanent false positive.
    if (f === 'hooks.test.mjs' || f === 'repo-integrity.mjs') continue;
    let text;
    try {
      text = fs.readFileSync(path.join(HOOKS_DIR, f), 'utf8');
    } catch {
      continue;
    }
    // Strip block and line comments so the historical explanations above (which
    // legitimately quote the defective JSON) are not mistaken for live code.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/permissionDecision['"]?\s*:\s*['"]allow['"]/.test(code) && f !== 'lib.mjs') {
      fail(
        `INV17: ${f} emits permissionDecision "allow" directly. Only lib.mjs's authorise() may do that, and only gate.mjs may call it — a blanket approval suppresses the user's permission prompt (finding X1)`,
      );
    }
    if (/\ballow\s*\(\s*\)/.test(code)) {
      fail(
        `INV17: ${f} still calls the removed allow(). Use stepAside() for "no objection" or authorise(reason) for a confirmed authorisation (finding X1)`,
      );
    }
    // 2026-08-15, finding X110 (High, reproduced). This read `f === 'scan.mjs' && …`,
    // while the comment at the top of INV17 claimed "only gate.mjs may call it". Two
    // different rules: the stated one and the enforced one. And the neighbouring
    // literal-"allow" check could not cover the gap, because a hook importing
    // `authorise` from lib.mjs writes no such literal — the string lives in lib.mjs.
    //
    // X91 then removed the last legitimate caller, so today NO hook may call it. The
    // capability itself is deleted from lib.mjs; this asserts it stays deleted.
    if (/\bauthorise\s*\(/.test(code) && f !== 'lib.mjs') {
      fail(
        `INV17: ${f} calls authorise(). No hook may emit "allow" — it suppresses the user's permission prompt, and a record on disk cannot prove a human agreed (findings X1, X91, X110). Use stepAside() for "no objection" or escalate(reason) to ask`,
      );
    }
  }
  // And lib.mjs must still provide both halves of the split.
  try {
    const lib = fs.readFileSync(path.join(HOOKS_DIR, 'lib.mjs'), 'utf8');
    if (!/export function stepAside\s*\(/.test(lib)) {
      fail(
        `INV17: lib.mjs no longer exports stepAside() — the neutral no-decision exit (finding X1)`,
      );
    }
    if (/export function allow\s*\(/.test(lib)) {
      fail(
        `INV17: lib.mjs exports allow() again. It was deliberately split into stepAside() and authorise(reason) so that every approval is explicit (finding X1)`,
      );
    }
    // 2026-08-15, finding X110. authorise() emitted "allow" and was deleted once X91
    // removed its last caller: a record on disk cannot prove a human agreed, so the gate
    // asks instead. Policing a dangerous capability is weaker than not having it, so this
    // asserts the absence rather than confining the use.
    if (/export function authorise\s*\(/.test(lib)) {
      fail(
        `INV17: lib.mjs exports authorise() again. It emitted permissionDecision "allow", which suppresses the user's permission prompt; it was deleted because no hook is entitled to that (findings X91, X110). Re-adding it means re-opening the permission architecture in decisions/2026-08-15-permission-architectures.md, not a one-line restoration`,
      );
    }
  } catch {
    fail(`INV17: could not read lib.mjs to verify the stepAside()/authorise() split`);
  }
}

// ---- INV 20: no source file carries a raw control byte -------------------------
//
// 2026-08-18, finding X222 (the systemic half of X204). A single raw control byte makes a file
// "binary data" to file(1) and makes a default grep return NOTHING AT ALL - not an error, not a
// warning, an empty result indistinguishable from "no matches". That is L13 at the level of the
// toolchain: an instrument that cannot tell a broken read from a negative result reports the broken
// read as a negative result.
//
// Not theoretical. traceability-check.mjs carried exactly one such byte from the X193 fix - a NUL
// separator typed as a literal character instead of the six-character escape sequence - and on
// 2026-08-18 it silently blinded two greps of that file DURING AN AUDIT OF THAT FILE. It was noticed
// only because a second empty result was implausible. X204 had recorded it as Low, as hygiene; it sits
// in the file with the most open findings against it, so anyone auditing that file saw an empty one.
//
// The mistake is easy to make and easy to miss: while writing this very invariant I typed a literal
// NUL into two of my own helper scripts, and only a compiler error caught the second. Nothing in the
// toolchain catches the first kind.
//
// The check bans the raw BYTE, never the VALUE. A NUL separator is a deliberate and needed choice -
// it keeps ['a b','c'] distinct from ['a','b c'] - and a check that forbade the value would force a
// real fix to be undone to satisfy a check about encoding. X222's control B pins that distinction, and
// control C pins that tabs and CRLF are ordinary whitespace, which matters because this project has a
// CRLF CI leg. Build output is exempt for the reason INV18 gives: it is a copy, not a source.
{
  const TEXTUAL = /\.(mjs|js|md|json|ya?ml|txt)$/i;
  // Everything below 0x20 except tab (0x09), newline (0x0a) and carriage return (0x0d), plus DEL.
  const isForbidden = (b) => (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f;
  for (const f of allFiles.filter((x) => TEXTUAL.test(x) && !isBuildOutput(x))) {
    let buf;
    try {
      buf = fs.readFileSync(f);
    } catch {
      continue;
    }
    const at = buf.findIndex(isForbidden);
    if (at === -1) continue;
    const line = buf.subarray(0, at).toString('utf8').split('\n').length;
    const code = buf[at].toString(16).padStart(2, '0');
    const total = buf.reduce((n, b) => n + (isForbidden(b) ? 1 : 0), 0);
    fail(
      `INV20: ${path.relative(repoRoot, f)}:${line} contains a raw control byte 0x${code}` +
        `${total > 1 ? ` (${total} in the file)` : ''}, which makes file(1) report binary data and a ` +
        'default grep return nothing at all - so this file is invisible to every text tool and to ' +
        'anyone auditing it. Write the character as an escape sequence instead; the runtime value is ' +
        'identical and only the source encoding changes.',
    );
  }
}

// ---- INV 19: no command and skill share a name --------------------------------
//
// 2026-08-17, finding X221 (the mechanical half of X35). Commands are declared as
// `commands/<name>.md` and skills as `skills/<name>/`, and both land in ONE namespace. Which one
// answers a bare `<name>` is undocumented platform behaviour that can change without notice, so a
// collision is a live ambiguity rather than a tidiness question.
//
// `studio` was declared as both from the beginning — X35, open since 13 August, settled by the owner
// on 2026-08-17 by renaming the COMMAND to `studio-start`: the cheap side, since 48 files reference the
// skill name and almost nothing referenced the command's. Round 1 raised THIS half separately as
// r1/X64 — "would have caught X35 automatically" — and it was folded into X35's extension and never
// built, so the register carried the finding and not the guard. Fixing the one collision without this
// would leave the next one exactly as undetectable as the first was.
//
// WHOLE names, compared exactly. A check asking "does either name contain the other" would flag the
// command `studio-start` against the skill `studio` and so fail the very repair it protects — L15
// again, where the changed thing shares a name with things kept. X221's control C pins that.
{
  const commandNames = new Set(commandFiles.map((f) => f.replace(/\.md$/, '')));
  const collisions = skillDirs.filter((s) => commandNames.has(s)).sort();
  for (const name of collisions) {
    fail(
      `INV19: '${name}' is declared BOTH as commands/${name}.md and as skills/${name}/. Commands and ` +
        'skills share one namespace and which one answers is undocumented platform behaviour, so this ' +
        'is ambiguous rather than merely untidy. Rename whichever side is referenced less — usually the ' +
        'command, since skill names are referenced across many more files.',
    );
  }
}

// ---- INV 18: the packaged copy has not drifted from source --------------------
//
// 2026-08-17, finding X220 (the mechanical half of X38). `clients/cli/plugin/` is a copy of the
// plugin, produced by clients/cli/scripts/bundle-plugin.mjs at packaging time and gitignored because
// it is build output. It is what `npm pack` ships, so it is what an installing user receives. Its
// only guarantee, until now, was that somebody had remembered to run the bundler.
//
// They had not. On 2026-08-17 the copy was two days stale and still carried `gate.mjs` and the four
// `confirm-*.mjs` minters, deleted by X214 the day before — so it also lacked every fix since. Twice
// that day the stale copy was mistaken for the truth: X219's first version asked "does this hook
// exist anywhere?" and the copy answered YES for `gate.mjs`, reporting clean on 36 broken references;
// and a stale copy of `scan.mjs` with behaviour matching this one exactly turned out to be what a
// live session's PreToolUse hook actually runs, which is X40.
//
// Round 1 filed precisely this on 15 August as r1/X43 — "a drifted twin that never received the F4
// `escalate` fix. A security fix present in one copy, absent in the shipped other" — and it entered
// the register as a one-line note about staleness with the security half dropped (X99).
//
// ABSENCE IS FINE. A fresh clone has no packaged copy, and failing there would fail everyone who had
// done nothing wrong, which is how a guard gets switched off (L5). X220's control D pins that, and
// control C pins that an identical copy is recognised — a check that cannot see a correct copy can
// never be satisfied.
const packagedRoot = path.join(repoRoot, 'clients', 'cli', 'plugin');
if (fs.existsSync(packagedRoot)) {
  const relFiles = (root) =>
    walk(root)
      .map((f) => path.relative(root, f))
      .filter((f) => !f.split(path.sep).includes('node_modules') && !f.endsWith('.DS_Store'))
      .sort();
  const sourceFiles = new Set(relFiles(pluginRoot));
  const packagedFiles = relFiles(packagedRoot);

  // Reported by CATEGORY with a count, not one line per file: a drifted copy differs in hundreds of
  // files at once, and a gate that prints hundreds of lines is a gate nobody reads.
  const extra = packagedFiles.filter((f) => !sourceFiles.has(f));
  const missing = [...sourceFiles].filter((f) => !packagedFiles.includes(f));
  const differing = packagedFiles
    .filter((f) => sourceFiles.has(f))
    .filter((f) => {
      try {
        return !fs
          .readFileSync(path.join(packagedRoot, f))
          .equals(fs.readFileSync(path.join(pluginRoot, f)));
      } catch {
        return true; // unreadable either side counts as drifted, never as clean
      }
    });

  const REBUILD =
    'Rebuild it with `node scripts/bundle-plugin.mjs` from clients/cli. It is build output, so ' +
    'rebuilding loses nothing.';

  // ONLY the surviving-deleted-file case blocks, and the reason is a friction measurement rather than
  // a preference. A first version of this invariant blocked on all three conditions and immediately
  // turned the suite red three times over — not on a defect, but because source had been edited after
  // the last bundle. That is the state a contributor is in every time they touch a hook, so the guard
  // would have interrupted ordinary work constantly, and a guard that does that gets switched off,
  // taking the real protection with it (L5). It would also have been redundant: `prepack` runs the
  // bundler, so missing and differing files are regenerated before anything is ever published.
  //
  // A file the copy carries that source does NOT is different in kind. Editing source cannot create
  // one — only deleting from source, without rebundling, can — so it is never a transient state. It is
  // exactly what was found on 2026-08-17: five hooks deleted by X214 still sitting in the shipped
  // copy, where two separate checks then read them as real. Blocking on that costs nothing and catches
  // the thing that actually happened.
  //
  // The other two are still computed, and reported ONLY alongside a real finding, so a stale copy is
  // never a silent one — but they cannot fail the gate on their own.
  if (extra.length) {
    const alsoStale =
      missing.length || differing.length
        ? ` The copy is stale in other ways too (${missing.length} missing, ${differing.length} differing), which is expected if source has moved since the last bundle and does not itself fail this gate.`
        : '';
    fail(
      `INV18: the packaged copy carries ${extra.length} file(s) that no longer exist in source, so a ` +
        `user installing this would receive code that has been DELETED — e.g. ${extra.slice(0, 3).join(', ')}. ` +
        `Editing source cannot cause this; only deleting from source without rebundling can.${alsoStale} ${REBUILD}`,
    );
  }
}

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
