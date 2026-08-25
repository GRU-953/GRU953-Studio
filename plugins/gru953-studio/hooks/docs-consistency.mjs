#!/usr/bin/env node
//
// docs-consistency.mjs — GRU953-Studio documentation-drift check.
// Zero dependencies (Node stdlib only). Added 2026-07-26 audit stage 5.
//
// A sibling to repo-integrity.mjs, deliberately NOT an extension of it.
// repo-integrity.mjs does hold a handful of small helper functions (reading a
// file, walking a directory, matching a stated count) — the real point,
// which held even when this was first written, is that its whole value is a
// readable top-to-bottom audit trail with a large hooks.test.mjs suite
// pinned to its exact message strings (2026-07-26 correction: this used to
// give specific figures — "470 lines with no functions," "197... cases" —
// that were already wrong the day this was written, and only get more stale
// as both files grow; dropped the numbers rather than re-pin them to numbers
// that will drift again). Folding a fenced-block tokeniser, a
// number-word parser and a role-reference classifier into that file during
// the same programme that already changed CI, OS and Node coverage is the
// wrong risk to take on at once. This file's job is narrower and newer:
// catching STALE CLAIMS (a count, a description, a list) that repo-integrity
// was never built to see, not re-checking anything it already covers.
//
// Concretely, this closes the exact gap that let finding 28 survive:
// repo-integrity's INV6 only matches "<digit> skills" (digit BEFORE the
// word) — so README.md's "bringing the skill count to 34" (word before a
// stale digit) passed every existing check while directly contradicting the
// "35 skills" stated twelve lines above it. The four checks below are
// scoped to the real, concrete drift this audit actually found — not a
// general-purpose prose parser — the same "close the found case, not every
// theoretical shape" discipline repo-integrity.mjs already documents for its
// own push-safety matcher.
//
// A note on scope, corrected after investigation (recorded plainly, the same
// way this audit records two retracted findings in AUDIT-2026-07.md §8): the
// original plan for this stage assumed adding this gate to the *publish*
// protocol would trip the "seven blocking checks" invariant (repo-
// integrity.mjs INV12) that publish-github/SKILL.md enforces. On inspection,
// that assumption doesn't hold — INV12's seven checks validate a project
// *built by* the studio (its own Dev-Memory, its own dependencies); this
// gate validates the STUDIO'S OWN documentation about itself, which a built
// project's README never contains. So this is wired as a sixth MANDATORY
// REPO GATE alongside repo-integrity.mjs / roster-check.mjs / licence-
// scan.mjs (see CLAUDE.md and .github/workflows/ci.yml), not a seventh
// publish pre-flight check — and INV13 below asserts that wiring mechanically
// so it cannot silently go unwired.
//
// Usage: node docs-consistency.mjs [repoRoot]
// Exit 0 = no drift found. Exit 1 = at least one drift found (listed).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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
function walk(dir, acc = []) {
  for (const d of listDir(dir)) {
    if (d.name === '.git' || d.name === 'node_modules') continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

// ---- ground truth, computed the same way repo-integrity.mjs does ------------
const agentsDir = path.join(pluginRoot, 'agents');
const skillsDir = path.join(pluginRoot, 'skills');
const agentFiles = listDir(agentsDir)
  .filter((d) => d.isFile() && d.name.endsWith('.md'))
  .map((d) => d.name);
const skillDirs = listDir(skillsDir)
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const agentNames = new Set(agentFiles.map((f) => f.replace(/\.md$/, '')));
const skillCount = skillDirs.length;

const allFiles = walk(repoRoot);
// 2026-08-17, finding X216 — the same live-versus-historical distinction X215 made for INV4,
// in its sibling gate. This check exists to catch a STALE CLAIM: a live document telling a user
// there are 7 skills when there are 37. A RECORD is the opposite case — a decision note saying
// "4 agents, 7 skills, 1 command were edited" is counting what it touched, not asserting a total,
// and a changelog describing the day a count changed must be free to name the old one.
//
// Caught on this project's own note: `2026-08-16-x214-remove-token-layer.md` was blocked for the
// phrase "7 skills", written while listing the seven files updated that day. The only way to
// satisfy the old rule was to stop recording what was done.
//
// Same categories as X215, stated once rather than exempted file by file: records, test material
// and build output. Everything a user actually reads stays covered — X216's reproduction holds a
// live README with a wrong count and requires it to BLOCK.
// 2026-08-18, X225: the trailing `i` made `Dev-Memory/` also match the live shipped skill
// directory `skills/dev-memory/`, so this gate skipped it too. Case-sensitive now, matching
// scan.mjs's DEVMEMORY_RE. Exactly five files lose the exemption and all five are live product
// files, measured before the change.
const RECORD_OR_FIXTURE_RE = /(^|\/)(CHANGELOG\.md|AUDIT-[^/]*\.md)|(^|\/)Dev-Memory\//;

// 2026-08-26, X365 — the sibling of X359, found by sweeping its class rather than by CI. The pattern
// above is spelled with '/' and was handed `path.relative()` output, which emits `path.sep` — '\' on
// win32. So on Windows `Dev-Memory\FINDINGS.md` and `docs\AUDIT-2026-08.md` lose an exemption they
// have on every other platform, and this gate false-BLOCKS on every record in them, exactly as
// repo-integrity.mjs did on the twelve tests CI caught. Demonstrated by calling the pattern directly
// with both spellings, not by simulating the path module.
//
// It is dormant on CI only by accident: `Dev-Memory/` is gitignored so a clean runner has none, and
// the AUDIT files happen to sit at the repository ROOT, where a single-segment path has no separator
// to misspell. It would fire on the first Windows machine that did real development here — which is
// the condition this project is actually for.
//
// `.split(path.sep).join('/')` and NOT `.replace(/\\/g, '/')`: a backslash is a legal POSIX filename
// character, and an unconditional replace would hand a file genuinely named `a\b.md` an exemption it
// never had. Normalise at the boundary, never widen the pattern.
//
// NOT applied at :149's `abs.startsWith(path.resolve(repoRoot, '.kilo') + path.sep)` — that one is
// already correct, because `resolve` and `sep` agree with each other on every platform. Normalising
// there would break it. The rule is about a relative path meeting a '/'-spelled pattern, not about
// separators in general.
const toPosix = (p) => p.split(path.sep).join('/');
const repoRel = (f) => toPosix(path.relative(repoRoot, f));
const allMd = allFiles.filter((f) => f.endsWith('.md') && !RECORD_OR_FIXTURE_RE.test(repoRel(f)));

// Files that legitimately quote a stale or wrong number as EVIDENCE, not as
// a live claim. AUDIT-2026-07.md IS the findings register — its own rows
// must be free to quote "bringing the skill count to 34" verbatim as the
// proof that sentence was once wrong, and CHANGELOG.md narrates each past
// version's own then-current count. Neither is a claim about today.
const EXEMPT_FILES = new Set(
  ['AUDIT-2026-07.md', 'CHANGELOG.md'].map((f) => path.resolve(repoRoot, f)),
);
// 2026-08-07 audit fix. The line above named ONE audit register by its exact
// filename, so AUDIT-2026-08.md — the same kind of file, written the same
// way, quoting its own then-current counts as evidence ("the 22 hooks, 35
// skills and 38 agents") — was never exempt. It reads clean today only
// because those numbers still happen to match; the day a skill is added,
// DC1 would BLOCK on a register truthfully recording what was true in
// August. Any AUDIT-<date>.md at the repo root is a dated findings register
// by construction, so match the shape rather than adding a new literal
// filename every time a programme runs.
const AUDIT_REGISTER_RE = /^AUDIT-\d{4}-\d{2}(-\d{2})?\.md$/;
// .kilo/plans/ is a pre-existing, committed set of planning notes from a
// different tool's own earlier (2026-07-25, one day before this audit) and
// now-superseded review — it proposes a different, partly-wrong set of
// findings (including its own now-stale role/skill counts and its own
// phantom specialist names, distinct from finding 27's). It documents a
// past proposal, not a live claim about the product today, exactly like
// CHANGELOG.md above — found while first running this check, disclosed here
// rather than silently exempted, and left for the repo owner to decide
// whether to keep or remove; not this stage's decision to make unilaterally.
function isExempt(f) {
  const abs = path.resolve(f);
  if (EXEMPT_FILES.has(abs)) return true;
  if (path.dirname(abs) === path.resolve(repoRoot) && AUDIT_REGISTER_RE.test(path.basename(abs)))
    return true;
  if (abs.startsWith(path.resolve(repoRoot, '.kilo') + path.sep)) return true;
  return false;
}

// ---- the historical-section scope rule (diagnosed 2026-07-26, implemented 2026-07-27) --
// A `total skills to (\d+)`-shaped count check was attempted and reverted
// after breaking three tests, because it compared EVERY match against
// TODAY's count — but a file's own dated "## vX.Y.Z ..." section is a
// legitimate HISTORICAL statement ("expanding total skills to 33" was true
// the day it was written), not a live claim, and EXEMPT_FILES alone can't
// scope that: it exempts a whole FILE (AUDIT-2026-07.md, CHANGELOG.md), but
// ROSTER.md is mostly live claims with a few dated sections mixed in, so
// exempting the whole file would blind DC1/DC2 to a genuine live regression
// anywhere else in it. The fix that actually holds is per-SECTION scope: any
// heading shaped like a version tag — "## v4.5.0 update (2026-07-26): ..."
// — opens a historical section that runs to the next "##" heading (any
// level-2 heading, dated or not, closes it); a count claim whose match
// position falls inside that range is a historical statement and is
// skipped, not compared against today's ground truth. Phase 1.0 of this
// same audit round additionally stripped ROSTER.md's own stale count
// phrases outright (the concrete case found), but that is a one-file
// workaround — this scope rule is what stops the exact same class of false
// BLOCK recurring the next time any file legitimately narrates a past
// count in a dated section. Verified by execution: reverted without this
// rule, appending a "## v9.9.9 (2026-07-27)" section to ROSTER.md that
// truthfully narrates an old count trips DC1 even though nothing today is
// wrong; with the rule, it does not.
const HISTORICAL_HEADING_RE = /^##\s*v\d/i;
function getHistoricalSectionRanges(text) {
  const ranges = [];
  const lines = text.split(/\r?\n/);
  const lineStartOffsets = [];
  // 2026-08-05 further-pass audit fix (found by execution): this used to add
  // `line.length + 1` per line, assuming the split-away newline was exactly
  // one char. On a CRLF checkout `split(/\r?\n/)` removes TWO chars yet
  // line.length counts neither, so every line drifted the offsets short by
  // one — after enough CRLF lines a live wrong count placed just before a
  // "## vX.Y.Z" historical section had its index classified as historical
  // and was skipped, a false-green (same fixture BLOCKS on LF, clean on
  // CRLF; reproduced by execution both ways). Compute each line's start from
  // the raw text's actual newline positions instead, so LF and CRLF are
  // handled identically and cannot drift.
  let offset = 0;
  lineStartOffsets.push(0);
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      offset = i + 1;
      lineStartOffsets.push(offset);
    }
  }
  let openStart = null;
  for (let i = 0; i < lines.length; i++) {
    if (!/^##\s/.test(lines[i])) continue;
    if (openStart !== null) {
      ranges.push({ start: openStart, end: lineStartOffsets[i] });
      openStart = null;
    }
    if (HISTORICAL_HEADING_RE.test(lines[i])) openStart = lineStartOffsets[i];
  }
  if (openStart !== null) ranges.push({ start: openStart, end: text.length });
  return ranges;
}
function isInHistoricalSection(ranges, index) {
  return ranges.some((r) => index >= r.start && index < r.end);
}

// ---- DC1: stale count phrasing repo-integrity.mjs's narrower regexes can't see (findings 28, 30) ----
// INV6 in repo-integrity.mjs matches only "<digit> skills" (digit-first).
// "the skill count to 34" and "34 skills" (in the OTHER order, or with the
// word "skill" singular) are both real phrasings this audit found live in
// the repo and neither matches that shape. Checked as its own pattern,
// against every markdown file except the two exemptions above.
const skillCountPatterns = [/skill count to (\d+)/gi, /(\d+)\s+skills?\b/gi];
for (const f of allMd) {
  if (isExempt(f)) continue;
  const text = read(f) || '';
  const historicalRanges = getHistoricalSectionRanges(text);
  for (const re of skillCountPatterns) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      if (isInHistoricalSection(historicalRanges, m.index)) continue;
      const n = parseInt(m[1], 10);
      if (n !== skillCount) {
        fail(`${repoRel(f)} states "${m[0]}" — the actual skill count is ${skillCount}`);
      }
    }
  }
}

// ---- DC2: lifecycle stage count (finding 30 — project-lead.md said "nine", actually twelve) ----
// Ground truth is derived, not hardcoded: studio/SKILL.md's own "## The
// lifecycle" line IS the canonical stage list (Brainstorm through Publish,
// plus Maintain for a returning project) — read it and count, so a future
// stage added to that line updates this check's expectation automatically
// instead of needing a second, hand-maintained number here.
const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
};
const numberWordAlt = Object.keys(NUMBER_WORDS).join('|');

function countLifecycleStages(studioSkillText) {
  // The lifecycle sentence wraps across several source lines (ordinary prose
  // word-wrap) — captured as the whole paragraph up to the next blank line,
  // then whitespace-collapsed, so a line-wrap can never truncate the count.
  // 2026-08 R2 Phase 2.2 (D3, cross-OS): a literal `\n\n` here required two
  // adjacent LF bytes for a "blank line", which a CRLF-encoded file (a real
  // Windows checkout, or any project whose SKILL.md a Windows editor saved)
  // never has — its blank lines are `\r\n\r\n`, two \n bytes separated by a
  // \r, which never matches `\n\n`. Reproduced: re-encoding this exact file
  // to CRLF made this return null, and the whole DC2 check fail closed with
  // "could not find studio/SKILL.md's lifecycle line" instead of validating
  // anything. `\r?\n` tolerates either line ending, matching the pattern
  // this file's own line-splitting already uses elsewhere.
  const m = studioSkillText.match(/##\s*The lifecycle\s*\r?\n\r?\n([\s\S]*?)\r?\n\r?\n/i);
  if (!m) return null;
  const para = m[1].replace(/\s+/g, ' ').trim();
  const plusMatch = para.match(/\(plus\s+([^)]+?)\s+for\b[^)]*\)/i);
  const bonusCount = plusMatch
    ? plusMatch[1]
        .split(/,|\band\b/i)
        .map((s) => s.trim())
        .filter(Boolean).length
    : 0;
  const mainPart = para.split(/\(plus/i)[0];
  const stages = mainPart
    .split('→')
    .map((s) => s.replace(/\*/g, '').trim())
    .filter(Boolean);
  return stages.length + bonusCount;
}
const studioSkillText = read(path.join(skillsDir, 'studio', 'SKILL.md'));
const actualStageCount = studioSkillText ? countLifecycleStages(studioSkillText) : null;
if (actualStageCount === null) {
  fail(
    `could not find studio/SKILL.md's "## The lifecycle" line — cannot verify stage-count claims elsewhere`,
  );
} else {
  // Scoped to "<word>-stage ... lifecycle" specifically, not any "<word>-stage"
  // phrase — found necessary by direct execution: this repo's own README
  // legitimately says "an eight-stage, exhaustive audit", which has nothing
  // to do with the studio's project lifecycle and must not be compared
  // against its stage count.
  const stageCountRe = new RegExp(
    `\\b(${numberWordAlt})-stage\\b[^.\\n]{0,20}\\blifecycle\\b`,
    'gi',
  );
  for (const f of allMd) {
    if (isExempt(f)) continue;
    const text = read(f) || '';
    const historicalRanges = getHistoricalSectionRanges(text);
    let m;
    stageCountRe.lastIndex = 0;
    while ((m = stageCountRe.exec(text))) {
      if (isInHistoricalSection(historicalRanges, m.index)) continue;
      const claimed = NUMBER_WORDS[m[1].toLowerCase()];
      if (claimed !== actualStageCount) {
        fail(
          `${repoRel(f)} calls it a "${m[1]}-stage" lifecycle — studio/SKILL.md's own lifecycle line names ${actualStageCount} stages`,
        );
      }
    }
  }
}

// ---- DC3: companion-skill-count phrasing ("the five skills above") drifting from the real list (finding 30) ----
// Ground truth: the distinct skill names bulleted under studio/SKILL.md's own
// "companion skills" heading — the exact list the flagged phrase describes.
function countCompanionSkills(text) {
  const bulletRe = /^\s*-\s*`([a-z0-9-]+)`\s*[—-]/gm;
  const names = new Set();
  let m;
  while ((m = bulletRe.exec(text))) names.add(m[1]);
  return names.size;
}
if (studioSkillText) {
  const actualCompanionCount = countCompanionSkills(studioSkillText);
  const companionCountRe = new RegExp(`\\bthe\\s+(${numberWordAlt})\\s+skills?\\s+above\\b`, 'gi');
  const studioHistoricalRanges = getHistoricalSectionRanges(studioSkillText);
  let m;
  while ((m = companionCountRe.exec(studioSkillText))) {
    if (isInHistoricalSection(studioHistoricalRanges, m.index)) continue;
    const claimed = NUMBER_WORDS[m[1].toLowerCase()];
    if (claimed !== actualCompanionCount) {
      fail(
        `studio/SKILL.md says "the ${m[1]} skills above" — its own companion-skill bullet list actually names ${actualCompanionCount} distinct skills`,
      );
    }
  }
}

// ---- DC4: duplicate entries in canonical lists (finding 31) ------------------
// studio/SKILL.md's companion-skill bullet list: the same skill named twice
// (with two different descriptions, in the case this audit found) is a
// stale leftover, not a deliberate repeat.
if (studioSkillText) {
  const bulletRe = /^\s*-\s*`([a-z0-9-]+)`\s*[—-]/gm;
  const seen = new Map();
  let m;
  while ((m = bulletRe.exec(studioSkillText))) {
    seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1)
      fail(
        `studio/SKILL.md's companion-skill list names \`${name}\` ${count} times — a duplicate entry`,
      );
  }
}
// marketplace.json's tags array: the same tag listed twice.
const marketplaceFile = path.join(repoRoot, '.claude-plugin', 'marketplace.json');
const marketplaceRaw = read(marketplaceFile);
if (marketplaceRaw !== null) {
  try {
    const marketJson = JSON.parse(marketplaceRaw);
    for (const p of marketJson.plugins || []) {
      const tags = Array.isArray(p.tags) ? p.tags : [];
      const seen = new Map();
      for (const t of tags) seen.set(t, (seen.get(t) || 0) + 1);
      for (const [tag, count] of seen) {
        if (count > 1)
          fail(
            `.claude-plugin/marketplace.json's plugin '${p.name}' lists the tag "${tag}" ${count} times — a duplicate entry`,
          );
      }
    }
  } catch (e) {
    fail(`.claude-plugin/marketplace.json is not valid JSON: ${e.message}`);
  }
}

// ---- DC5: dangling role-shaped references (finding 27's class, generalised) ----
// The class of bug finding 27 was: a specialist named in prose that does not
// exist on the actual team, invisible because there is no check at all for
// role references (unlike skills, which INV3 already covers) and markdown
// tables are not parsed by any existing check. Classify every backticked,
// hyphenated, role-SHAPED token (ending in a word every real agent filename
// actually ends in) against: the real roster, ROSTER.md's own "merged away"
// table (historical names that are legitimately still discussed, just not
// active), and a short, named exemption list for real non-role technical
// terms that happen to share a suffix word by coincidence.
const roleSuffixes = new Set([...agentNames].map((n) => n.split('-').pop()));
const ROLE_SHAPED_RE = new RegExp(
  '`([a-z0-9]+(?:-[a-z0-9]+)*-(?:' + [...roleSuffixes].join('|') + '))`',
  'g',
);

const rosterFile = path.join(pluginRoot, 'ROSTER.md');
const rosterText = read(rosterFile) || '';
const mergedRoleNames = new Set();
{
  let inMergedTable = false;
  for (const line of rosterText.split(/\r?\n/)) {
    if (/^##\s*v3\.0\.0 consolidation/i.test(line)) {
      inMergedTable = true;
      continue;
    }
    if (/^##\s/.test(line)) {
      inMergedTable = false;
      continue;
    }
    if (!inMergedTable) continue;
    const rm = line.match(/^\|\s*([a-z0-9-]+)\s*\|\s*([a-z0-9-]+)\s*\|/i);
    if (rm) {
      mergedRoleNames.add(rm[1]);
      mergedRoleNames.add(rm[2]);
    }
  }
}
// Real, non-role technical terms that are role-SHAPED by coincidence
// (confirmed by reading each one — none names a specialist), found by
// running this exact check against the repo before adding this list.
const NON_ROLE_EXEMPTIONS = new Set([
  'pip-licenses',
  'clang-tidy',
  'clang-format',
  'project-lead', // real agent, kept here defensively if roster lookup ever races
]);
for (const f of allMd) {
  if (isExempt(f)) continue;
  const text = read(f) || '';
  let m;
  ROLE_SHAPED_RE.lastIndex = 0;
  while ((m = ROLE_SHAPED_RE.exec(text))) {
    const token = m[1];
    if (agentNames.has(token)) continue;
    if (mergedRoleNames.has(token)) continue;
    if (NON_ROLE_EXEMPTIONS.has(token)) continue;
    fail(
      `${repoRel(f)} references \`${token}\`, which names no current agent, no merged-away role in ROSTER.md, and is not an exempted non-role term — a dangling specialist reference (finding 27's class)`,
    );
  }
}

// ---- DC6: the "zero third-party dependencies" claim (finding 29) ------------
// Until 2026-07-26 audit stage 6, this was a disclosed, temporary exemption:
// README.md's "zero third-party code dependencies" claim was untrue while
// plugins/gru953-studio/package.json still declared @modelcontextprotocol/sdk
// for the never-loadable mcp-server.js (finding 10). Stage 6 deleted both in
// the same commit that made this claim true, so this is now a permanent,
// blocking regression guard rather than an exemption: if the plugin's own
// package.json is ever reintroduced with a real dependency while README
// still makes this claim, that is a genuine regression of finding 29, not a
// disclosed known state.
// 2026-08-15, finding X106 (High, reproduced). This check used to read:
//
//     if (claimsZeroDependencies && hasRealDependency) fail(...)
//
// It fired only when BOTH held, so it did not check the zero-dependency property at
// all — it checked whether README.md was LYING about the property. And the cheapest way
// to stop lying is to stop claiming: delete the sentence and a real dependency passed
// unnoticed, while CONTRIBUTING.md and the header comment of 18 shipped hooks went on
// calling zero-dependency "a deliberate, mechanically-checked property".
//
// A guard that can be switched off by removing the sentence it guards is not a guard.
// The property is a project rule, not a claim in one document, so it is now tested on
// its own terms and README.md's wording is irrelevant to it.
//
// The swallowed parse error was the same mistake in a second form. Its comment read
// "invalid JSON here is repo-integrity's / licence-scan's concern, not this gate's" —
// and that was FALSE, checked rather than assumed: licence-scan.mjs reads the ROOT
// package.json, never the plugin's own, and repo-integrity.mjs does not read
// dependencies at all. So an unparseable manifest was reported by nobody, and this gate
// treated "I could not read it" as "it is fine" — the exact inversion the project's own
// C8 rule forbids. It now fails closed.
//
// Reproduction: hooks/test/repro/X106-disarmable-dependency-gate.mjs — five cases, three
// of them controls.
// Read once and keep: later checks in this file (the version cross-check at DC8, among
// others) use README.md's text. Only the zero-dependency check stopped depending on it.
const readmeText = read(path.join(repoRoot, 'README.md')) || '';

const mcpPackageJsonRaw = read(path.join(pluginRoot, 'package.json'));
if (mcpPackageJsonRaw !== null) {
  let mcpPackageJson = null;
  try {
    mcpPackageJson = JSON.parse(mcpPackageJsonRaw);
  } catch {
    mcpPackageJson = null;
  }
  if (mcpPackageJson === null) {
    fail(
      `plugins/gru953-studio/package.json exists but cannot be parsed, so the zero-dependency property cannot be verified — refusing to report it as satisfied (finding 29 / X106). A gate that cannot read its input must never claim its input is fine.`,
    );
  } else if (mcpPackageJson.dependencies && Object.keys(mcpPackageJson.dependencies).length > 0) {
    fail(
      `plugins/gru953-studio/package.json declares a runtime dependency, but zero third-party dependencies is a mechanically-checked property of this plugin, asserted in CONTRIBUTING.md and in 18 shipped hook headers — finding 29 has regressed (X106: this now fails regardless of what README.md claims)`,
    );
  }
}

// 2026-08-15, finding X109 (Medium, reproduced). The check above reads the manifest and
// nothing else, so third-party code that is never DECLARED is never seen: a compiled
// `.node`/`.dylib`, a bundled `node_modules/`, or a library pasted in as a `.js` file
// all leave the manifest empty while CONTRIBUTING.md and 18 hook headers go on calling
// zero third-party dependencies "a mechanically-checked property".
//
// WHY AN ALLOWLIST RATHER THAN A LIST OF BANNED EXTENSIONS. Looking for `.node`, `.so`,
// `.dll` and friends is the exact failure mode this family of findings is about — a
// check that only looks for what somebody thought of. X86 checked references but not
// coverage; X99 checked the register's shape but never compared it with its source; X106
// checked whether a sentence was honest rather than whether the rule held. So this is
// inverted: the plugin ships markdown, stdlib-only ES modules, a little JSON and a
// licence, and anything ELSE fails rather than passing unexamined.
//
// The cost is deliberate: a legitimately new file type makes this fail until someone
// widens PERMITTED on purpose. That is the intended behaviour, and the message below
// says exactly how — an over-strict gate nobody can understand is one that gets switched
// off (lesson L5).
//
// NOT COVERED, and deliberately not half-covered: a dependency fetched over the network
// at run time. `hooks/openrouter-models.mjs` legitimately uses Node's built-in fetch to
// read a public model catalogue, so "this plugin never fetches anything" is NOT a
// property this product has and must not be asserted as one. Disclosed in RESIDUALS.md.
//
// Reproduction: hooks/test/repro/X109-vendored-dependency.mjs — five cases, two controls,
// one of which is the real tree.
const PERMITTED_EXTENSIONS = new Set(['.md', '.mjs', '.json']);
const PERMITTED_FILENAMES = new Set(['LICENSE', 'LICENCE']);
const VENDOR_DIRECTORY_NAMES = new Set(['node_modules', 'vendor', 'third_party', 'third-party']);

function collectForeignArtefacts(dir, rel, foreign, vendorDirs) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Unreadable directory: report it rather than treating it as empty. A gate that
    // cannot read its input must never claim its input is fine (the C8 rule, and the
    // second half of X106).
    foreign.push(`${rel || '.'} (unreadable — cannot verify its contents)`);
    return;
  }
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (VENDOR_DIRECTORY_NAMES.has(entry.name)) {
        vendorDirs.push(childRel);
        continue; // named explicitly; no need to list every file inside it
      }
      collectForeignArtefacts(path.join(dir, entry.name), childRel, foreign, vendorDirs);
      continue;
    }
    if (!entry.isFile()) continue;
    if (PERMITTED_FILENAMES.has(entry.name)) continue;
    const ext = path.extname(entry.name);
    if (PERMITTED_EXTENSIONS.has(ext)) continue;
    foreign.push(childRel);
  }
}

{
  const foreign = [];
  const vendorDirs = [];
  collectForeignArtefacts(pluginRoot, '', foreign, vendorDirs);
  if (vendorDirs.length > 0) {
    fail(
      `a vendored-dependency directory exists inside the plugin: ${vendorDirs.join(', ')} — third-party code copied into the tree is still a third-party dependency, and this plugin's zero-dependency property is asserted in CONTRIBUTING.md and in 18 shipped hook headers (X109)`,
    );
  }
  if (foreign.length > 0) {
    const shown = foreign.slice(0, 10).join(', ');
    fail(
      `the plugin tree contains ${foreign.length} file(s) that are not markdown, ES modules, JSON or a licence: ${shown}${foreign.length > 10 ? ', …' : ''} — this plugin ships only those types, so anything else may be vendored third-party code, which its zero-dependency property forbids (X109). If the file is legitimate, add its extension to PERMITTED_EXTENSIONS in this file, deliberately and in the same commit that adds the file`,
    );
  }
}

// ---- DC7: dangling cross-file "see `path`" references (2026-07-27 R1 Phase 1.3, new) --
// No prior check verified this at all — a "see `some/file.md`" pointer whose
// target moved or was deleted became invisible prose, silently. Scoped
// deliberately narrow, the same "close the found case" discipline DC1-DC6
// already document: only a backticked token that is unambiguously
// PATH-shaped (contains a `/`, or ends in one of the real extensions this
// repo's own docs actually use) and immediately follows the word "see"
// (optionally "see also") counts as a reference at all. A bare backticked
// identifier with no extension or slash (`architect`, `cost-guard`) is left
// to DC5's own purpose-built role-reference check rather than guessed at
// here, and a wildcard path ("commands/studio-*.md") is never one real file
// and is skipped, not flagged.
const SEE_REF_RE = /\bsee(?:\s+also)?\s+`([^`]+)`/gi;
const REF_EXTENSIONS = /\.(md|mjs|js|json|ya?ml)$/i;
function looksLikePathRef(token) {
  if (token.includes('*') || token.includes('<') || token.includes('>')) return false;
  if (!/^[A-Za-z0-9_./-]+$/.test(token)) return false;
  return token.includes('/') || REF_EXTENSIONS.test(token);
}
const REF_BASE_DIRS = [
  repoRoot,
  pluginRoot,
  path.join(pluginRoot, 'agents'),
  path.join(pluginRoot, 'skills'),
  path.join(pluginRoot, 'hooks'),
  path.join(pluginRoot, 'commands'),
];
// A relative reference between two files in the SAME directory — e.g.
// governance/LOGO-USAGE.md's real, legitimate "see `TRADEMARKS.md`" pointing
// at its own sibling governance/TRADEMARKS.md — resolves only against the
// referencing file's own directory, not any of the fixed base dirs above;
// found live in this repo while first running this check, not hypothetical.
// 2026-08-13, finding X24 (reproduced by execution — see
// test/repro/phase1-gate-honesty.mjs case P12). The bases above include the
// referencing file's OWN directory but never a PARENT one. That is a false
// positive against the most ordinary shape in a project's working memory: a note
// at Dev-Memory/decisions/2026-08-13-something.md pointing at `UNBUILT.md`,
// which lives one level up in Dev-Memory/ beside PROGRESS.md and
// REQUIREMENTS.md. This gate blocked exactly that three times in one session,
// including once on a note whose only content was a description of this defect —
// it could not document its own bug without triggering it.
//
// The fix is to walk UP from the referencing file to the repository root, which
// generalises correctly rather than special-casing Dev-Memory: any relative
// reference that resolves anywhere on the path between a file and the repo root
// is a real file, and the check's purpose is to catch references to files that do
// not exist at all. Bounded by repoRoot, so it never escapes the repository.
function ancestorDirs(file) {
  const dirs = [];
  let dir = path.dirname(path.resolve(file));
  const root = path.resolve(repoRoot);
  for (let guard = 0; guard < 64; guard++) {
    dirs.push(dir);
    if (dir === root || !dir.startsWith(root)) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return dirs;
}
function refResolves(token, referencingFile) {
  const bases = [...REF_BASE_DIRS, ...ancestorDirs(referencingFile)];
  return bases.some((base) => {
    try {
      return fs.statSync(path.join(base, token)).isFile();
    } catch {
      return false;
    }
  });
}
for (const f of allMd) {
  if (isExempt(f)) continue;
  const text = read(f) || '';
  let m;
  SEE_REF_RE.lastIndex = 0;
  while ((m = SEE_REF_RE.exec(text))) {
    const token = m[1];
    if (!looksLikePathRef(token)) continue;
    if (!refResolves(token, f)) {
      fail(
        `${repoRel(f)} says "see \`${token}\`", but no file at that path exists (checked the repo root, the plugin root, agents/, skills/, hooks/, and commands/) — a dangling cross-reference`,
      );
    }
  }
}

// ---- DC8: docs/index.html's install command matches the real marketplace/plugin names (2026-08 R3 Phase 3.1, D6) --
// docs/index.html is the one substantive page under docs/*.html — every
// other page there (agents.html, skills.html, guide.html, faq.html,
// troubleshooting.html, use-cases.html) is a thin redirect stub to the
// wiki with no factual claim to verify at all (checked directly, not
// assumed). index.html carries exactly one concrete, checkable claim: the
// "install inside Claude Code" command block naming the marketplace repo
// and the `plugin@marketplace` identifier. If the plugin or marketplace
// name in .claude-plugin/marketplace.json is ever renamed, this line would
// otherwise silently start telling every visitor to run a command that no
// longer works.
const indexHtmlText = read(path.join(repoRoot, 'docs', 'index.html'));
if (indexHtmlText !== null) {
  const installMatch = indexHtmlText.match(/\/plugin install ([a-z0-9-]+)@([a-z0-9-]+)/i);
  if (!installMatch) {
    fail(
      `docs/index.html no longer states a "/plugin install <name>@<marketplace>" command — cannot verify it matches the real marketplace`,
    );
  } else {
    const [, statedPlugin, statedMarketplace] = installMatch;
    const marketRaw2 = read(path.join(repoRoot, '.claude-plugin', 'marketplace.json'));
    if (marketRaw2 === null) {
      fail(
        `.claude-plugin/marketplace.json is missing or unreadable — cannot verify docs/index.html's install command`,
      );
    } else {
      try {
        const marketJson2 = JSON.parse(marketRaw2);
        const realMarketplaceName = marketJson2.name;
        const realPluginNames = (marketJson2.plugins || []).map((p) => p.name);
        if (statedMarketplace !== realMarketplaceName) {
          fail(
            `docs/index.html's install command names marketplace "${statedMarketplace}", but .claude-plugin/marketplace.json's real name is "${realMarketplaceName}"`,
          );
        }
        if (!realPluginNames.includes(statedPlugin)) {
          fail(
            `docs/index.html's install command names plugin "${statedPlugin}", which is not among marketplace.json's real plugin names (${realPluginNames.join(', ')})`,
          );
        }
      } catch {
        /* invalid JSON here is DC4's/repo-integrity's concern, not this gate's */
      }
    }
  }
}

// ---- DC9: every stated version agrees with CHANGELOG.md's newest release (2026-08-07 audit fix) --
// The bug this closes was live and shipped: CHANGELOG.md's newest section
// said 5.1.3 and a v5.1.3 tag existed, while plugins/gru953-studio/.claude-
// plugin/plugin.json and .claude-plugin/marketplace.json still said 5.1.1
// (never bumped by the 5.1.2 release at all) and all three clients/ packages
// still said 5.1.2. Nothing anywhere noticed: repo-integrity.mjs checks that
// referenced things EXIST, DC1-DC8 check counts and names, and publish.yml
// reads the version from package.json rather than from the tag — so the
// v5.1.3 tag found 5.1.2 already on npm, took its "already published, skip
// cleanly" path, and reported a green run that published nothing. A version
// number is exactly the kind of claim this gate exists for: stated in seven
// places, true in none of them unless something checks.
//
// CHANGELOG.md is the ground truth deliberately — it is the file a human
// actually writes first when cutting a release, and its newest `## X.Y.Z`
// heading is unambiguous. README.md's "Latest version: X.Y.Z" line is
// included because it is the version a reader sees before anything else.
const changelogText = read(path.join(repoRoot, 'CHANGELOG.md'));

// 2026-08-15, finding X118 (High, reproduced). Everything below is inside
// `if (changelogText !== null)`, so deleting or renaming CHANGELOG.md did not merely
// skip one check — it silently switched off every version cross-check in this gate at
// once. The gate went on reporting `clean`, having verified nothing about versions.
//
// This is the same rule as X113 and X115: a gate that cannot read its input must never
// claim its input is fine. The absence is now a failure in its own right, so the block
// below is skipped only when it has already been reported.
if (changelogText === null) {
  fail(
    `CHANGELOG.md is missing or unreadable, so every version cross-check in this gate is silently skipped — the release version, the manifests and the docs go unverified against each other (finding X118)`,
  );
}
if (changelogText !== null) {
  const newest = changelogText.match(/^##\s+v?(\d+\.\d+\.\d+)\b/m);
  if (!newest) {
    fail(
      `CHANGELOG.md has no "## X.Y.Z" release heading — cannot verify the version stated in the plugin and client manifests`,
    );
  } else {
    const releaseVersion = newest[1];
    const jsonVersionSources = [
      ['plugins/gru953-studio/.claude-plugin/plugin.json', (j) => j.version],
      ['.claude-plugin/marketplace.json', (j) => j.metadata && j.metadata.version],
      ['clients/cli/package.json', (j) => j.version],
      ['clients/antigravity/package.json', (j) => j.version],
      ['clients/vscode/package.json', (j) => j.version],
    ];
    for (const [rel, pick] of jsonVersionSources) {
      const raw = read(path.join(repoRoot, ...rel.split('/')));
      if (raw === null) continue; // a missing manifest is repo-integrity's concern, not this gate's
      let stated;
      try {
        stated = pick(JSON.parse(raw));
      } catch {
        continue; // invalid JSON is DC4's / CI's concern
      }
      // 2026-08-13 (reproduced by execution — see
      // test/repro/phase1-gate-honesty.mjs case P10). The condition used to be
      // `if (stated && …)`, so a manifest whose version was absent, empty, or
      // otherwise falsy was SKIPPED rather than failed. But this check exists
      // precisely because "the publish workflow reads the manifest, not the tag"
      // — and a manifest with no version publishes nothing just as surely as one
      // with the wrong version. Reproduced: setting clients/cli/package.json's
      // version to "" left both this gate and repo-integrity.mjs reporting clean.
      // A non-semver value is treated the same way, for the same reason.
      if (stated === undefined || stated === null || String(stated).trim() === '') {
        fail(
          `${rel} states no version at all (found ${JSON.stringify(stated)}), and CHANGELOG.md's newest release is ${releaseVersion} — a manifest with no version publishes nothing, exactly like a mismatched one`,
        );
      } else if (!/^\d+\.\d+\.\d+/.test(String(stated).trim())) {
        fail(
          `${rel} states version ${JSON.stringify(stated)}, which is not a semantic version — it cannot be compared with CHANGELOG.md's newest release ${releaseVersion}, so it fails closed`,
        );
      } else if (stated !== releaseVersion) {
        fail(
          `${rel} states version "${stated}", but CHANGELOG.md's newest release is ${releaseVersion} — a release that bumps one and not the other publishes nothing (the publish workflow reads the manifest, not the tag)`,
        );
      }
    }
    const readmeVersionMatch = readmeText.match(/^###\s+Latest version:\s*v?(\d+\.\d+\.\d+)/m);
    if (readmeVersionMatch && readmeVersionMatch[1] !== releaseVersion) {
      fail(
        `README.md says "Latest version: ${readmeVersionMatch[1]}", but CHANGELOG.md's newest release is ${releaseVersion}`,
      );
    }
  }
}

// ---- report -------------------------------------------------------------
if (problems.length === 0) {
  console.log(JSON.stringify({ status: 'clean' }, null, 2));
  process.exit(0);
}
console.log(JSON.stringify({ status: 'BLOCKED', problems }, null, 2));
process.exit(1);
