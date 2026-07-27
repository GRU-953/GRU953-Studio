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
const allMd = allFiles.filter((f) => f.endsWith('.md'));

// Files that legitimately quote a stale or wrong number as EVIDENCE, not as
// a live claim. AUDIT-2026-07.md IS the findings register — its own rows
// must be free to quote "bringing the skill count to 34" verbatim as the
// proof that sentence was once wrong, and CHANGELOG.md narrates each past
// version's own then-current count. Neither is a claim about today.
const EXEMPT_FILES = new Set(
  ['AUDIT-2026-07.md', 'CHANGELOG.md'].map((f) => path.resolve(repoRoot, f)),
);
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
  if (EXEMPT_FILES.has(path.resolve(f))) return true;
  if (path.resolve(f).startsWith(path.resolve(repoRoot, '.kilo') + path.sep)) return true;
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
  let offset = 0;
  for (const line of lines) {
    lineStartOffsets.push(offset);
    offset += line.length + 1; // +1 for the split-away newline
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
        fail(
          `${path.relative(repoRoot, f)} states "${m[0]}" — the actual skill count is ${skillCount}`,
        );
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
  const m = studioSkillText.match(/##\s*The lifecycle\s*\n\n([\s\S]*?)\n\n/i);
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
          `${path.relative(repoRoot, f)} calls it a "${m[1]}-stage" lifecycle — studio/SKILL.md's own lifecycle line names ${actualStageCount} stages`,
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
      `${path.relative(repoRoot, f)} references \`${token}\`, which names no current agent, no merged-away role in ROSTER.md, and is not an exempted non-role term — a dangling specialist reference (finding 27's class)`,
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
const mcpPackageJsonRaw = read(path.join(pluginRoot, 'package.json'));
let hasRealDependency = false;
if (mcpPackageJsonRaw !== null) {
  try {
    const mcpPackageJson = JSON.parse(mcpPackageJsonRaw);
    hasRealDependency = !!(
      mcpPackageJson.dependencies && Object.keys(mcpPackageJson.dependencies).length > 0
    );
  } catch {
    /* invalid JSON here is repo-integrity's / licence-scan's concern, not this gate's */
  }
}
const readmeText = read(path.join(repoRoot, 'README.md')) || '';
const claimsZeroDependencies =
  /zero third-party code\s*\ndependencies|zero third-party code dependencies/i.test(readmeText);
if (claimsZeroDependencies && hasRealDependency) {
  fail(
    `README.md claims "zero third-party code dependencies" but plugins/gru953-studio/package.json declares a real dependency — finding 29 has regressed`,
  );
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
function refResolves(token, referencingFile) {
  const bases = [...REF_BASE_DIRS, path.dirname(referencingFile)];
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
        `${path.relative(repoRoot, f)} says "see \`${token}\`", but no file at that path exists (checked the repo root, the plugin root, agents/, skills/, hooks/, and commands/) — a dangling cross-reference`,
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
