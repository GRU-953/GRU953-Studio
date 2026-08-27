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
    // 2026-08-26, v7. This was pinned to `## v3.0.0 consolidation` by name, so it recognised
    // exactly one consolidation and no other. The first time the roster was consolidated again
    // — v7.0.0, merging three media roles into one — every reference to a merged-away role read
    // as a dangling one, and this gate reported seven problems that were all the same missing
    // pattern. A check keyed to one hard-coded version is a check that expires; matched on the
    // SHAPE of the heading instead, so the next consolidation is covered on the day it lands.
    if (/^##\s*v\d+\.\d+\.\d+ consolidation/i.test(line)) {
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
// A dependency fetched over the network at run time used to be explicitly NOT covered here:
// the model-catalogue hook read a public catalogue with Node's built-in fetch, so
// "this plugin never fetches anything" was not a property the product had and this comment
// said so rather than asserting it. That hook went with v7's model integrations, and the
// plugin now makes NO outbound network call at all — so the property is finally true. It is
// still not asserted as a gate here, because nothing checks it; if that is ever wanted, the
// check is a sweep for `fetch(`/`http` in the hooks tree, not a claim in a comment.
//
// Reproduction: hooks/test/repro/X109-vendored-dependency.mjs — five cases, two controls,
// one of which is the real tree.
const PERMITTED_EXTENSIONS = new Set(['.md', '.mjs', '.json']);
const PERMITTED_FILENAMES = new Set(['LICENSE', 'LICENCE']);

// 2026-08-26, finding X377. Operating-system artefacts, skipped by NAME because they have no
// extension to permit — so the remedy this check's own message offers ("add its extension to
// PERMITTED_EXTENSIONS") cannot be applied to them, and there was no other way out.
//
// Found by the owner: opening the repository in macOS Finder scatters `.DS_Store` files through
// the tree, and this gate then BLOCKED on two of them inside the plugin, taking thirteen tests
// with it. Every macOS contributor who has ever looked at the folder hits this, for a file that
// provably cannot reach anybody: it is in `.gitignore` so it is never committed, in the
// bundler's own EXCLUDE set so it is never copied into the packaged plugin, and in
// `clients/cli/.npmignore` so it is never published. Three independent exclusions already stop
// it shipping, and this check was the only thing treating it as a hazard.
//
// A gate that fails on ordinary local state gets switched off, and its absence is then
// invisible — the same reason hooks/stall-check.mjs suppresses an alert on a run that carried
// on. Named exclusions rather than a blanket dotfile rule, deliberately: the point of the check
// is that an unexpected file type in the shipped tree may be vendored third-party code, and
// waving through everything beginning with a dot would give that away for nothing.
const OS_ARTEFACTS = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
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
    // X377: an operating-system artefact cannot ship (gitignored, excluded by the bundler, named
    // in .npmignore), so it is not a hazard and must not fail this gate on a contributor's own
    // machine. See OS_ARTEFACTS above for the full reasoning.
    if (OS_ARTEFACTS.has(entry.name)) continue;
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

// ---- DC10: every licence declaration agrees with the LICENSE file (2026-08-26, v7 relicensing) --
//
// Why this exists, measured rather than imagined. Relicensing 6.1.0 from PolyForm
// Noncommercial to Apache-2.0 meant correcting sixteen files. Every one of the seven
// repo gates stayed GREEN throughout — including this one — while the root LICENSE
// said Apache-2.0 and README.md still told the user the project was noncommercial and
// that selling anything required buying a licence. Nothing in the repository compared
// the licence to the claims made about it: `licence-scan.mjs` reads DEPENDENCY
// manifests, and the vendored-code rule in this file is an extension allowlist, not a
// notice check. So the single most legally consequential fact about the product was
// the one fact no gate held.
//
// Two of those sixteen were missed by a hand grep over `--include='*.md' --include='*.yml'`
// and found only by a second, wider sweep: a Homebrew formula (`.rb`) and a winget
// manifest (`.yaml`, not `.yml`). That is this repository's own enumeration-blindness
// class — X349's shape — committed while fixing something else. Hence the rule below
// enumerates by DECLARATION SHAPE across every tracked file, not by a curated file list:
// a packaging manifest added later is covered on the day it appears, with nobody
// remembering to add it here.
//
// It asserts agreement POSITIVELY (every declaration equals the LICENSE's identifier)
// rather than banning the old licence's name. A ban would be wrong twice over: it would
// fire on the deliberate "versions up to 6.1.0 were PolyForm" notes that MIGRATION.md,
// NOTICE and README.md are obliged to carry, and it would fall silent the moment the
// licence changed again to something the ban did not enumerate.
{
  const spdxOf = (text) => {
    if (!text) return null;
    if (/Apache License/.test(text) && /Version 2\.0/.test(text)) return 'Apache-2.0';
    if (/PolyForm Noncommercial License 1\.0\.0/.test(text)) return 'PolyForm-Noncommercial-1.0.0';
    if (/MIT License/.test(text)) return 'MIT';
    return null;
  };
  // Human-readable forms NOTICE is allowed to use for each identifier.
  const NOTICE_PHRASE = {
    'Apache-2.0': /Apache License, Version 2\.0|Apache License 2\.0/,
    'PolyForm-Noncommercial-1.0.0': /PolyForm Noncommercial License 1\.0\.0/,
    MIT: /MIT License/,
  };

  const rootLicensePath = path.join(repoRoot, 'LICENSE');
  const rootLicenceText = read(rootLicensePath);

  if (rootLicenceText === null) {
    // Fail closed. X113/X115's lesson: an input this check cannot read is the one
    // state that must never report clean, because "no LICENSE" is itself the defect.
    fail(
      'LICENSE is missing or unreadable at the repository root — the licence every other declaration is checked against cannot be determined, so no declaration can be verified',
    );
  } else {
    const truth = spdxOf(rootLicenceText);
    if (truth === null) {
      fail(
        'LICENSE exists but its text matches no licence this check recognises — add the new licence to spdxOf() in docs-consistency.mjs rather than leaving every declaration unverified',
      );
    } else {
      // (a) Every other LICENSE/LICENCE copy must be byte-identical to the root one.
      // They are shipped copies: a stale one is a different licence reaching a user.
      for (const f of allFiles) {
        const base = path.basename(f);
        if (base !== 'LICENSE' && base !== 'LICENCE') continue;
        if (f === rootLicensePath) continue;
        const rel = repoRel(f);
        if (/(^|\/)(fixtures|test)\//.test(rel)) continue; // deliberate test data
        if (read(f) !== rootLicenceText) {
          fail(
            `${rel} is not byte-identical to the root LICENSE — this copy is shipped, so a user installing it receives different terms from the ones the repository declares`,
          );
        }
      }

      // (b) Declarations, enumerated by SHAPE across the whole tree.
      // A lockfile records the licence of every DEPENDENCY, which is licence-scan.mjs's
      // subject, not this one's — those licences legitimately differ from ours and
      // flagging them would make this check noise and get it switched off. For JSON the
      // project's OWN declaration is the ROOT `license` key, so parse and read exactly
      // that: npm writes a lockfile's own package entry under `packages[""]`, never at
      // the root, so parsing structurally excludes dependency data without needing a
      // filename denylist that a future lockfile format could slip past.
      const declarations = [];
      for (const f of allFiles) {
        const rel = repoRel(f);
        if (/(^|\/)(fixtures|test)\//.test(rel)) continue;
        const text = read(f);
        if (text === null) continue;
        const ext = path.extname(f);
        if (ext === '.json') {
          let obj;
          try {
            obj = JSON.parse(text);
          } catch {
            continue; // DC4 already reports unparseable manifests
          }
          if (obj && typeof obj === 'object' && typeof obj.license === 'string') {
            declarations.push([rel, obj.license.trim(), 'JSON "license" field']);
          }
        } else if (ext === '.rb') {
          for (const m of text.matchAll(/^\s*license\s+"([^"]+)"/gm)) {
            declarations.push([rel, m[1].trim(), 'Homebrew formula licence']);
          }
        } else if (ext === '.yaml' || ext === '.yml') {
          for (const m of text.matchAll(/^License:\s*(.+?)\s*$/gm)) {
            declarations.push([rel, m[1].trim(), 'YAML License field']);
          }
        }
      }
      for (const [rel, stated, what] of declarations) {
        if (stated === truth) continue;
        fail(
          `${rel} declares its licence as "${stated}" (${what}), but LICENSE is ${truth} — a published manifest that names the wrong licence misinforms every tool and person that reads it`,
        );
      }

      // (c) NOTICE must name the same licence, and must not promise a file that is absent.
      const noticePath = path.join(repoRoot, 'NOTICE');
      const noticeText = read(noticePath);
      if (noticeText === null) {
        fail(
          'NOTICE is missing or unreadable at the repository root, but LICENSE exists — a licence whose notice file is absent cannot be complied with by anyone redistributing it',
        );
      } else {
        // Two-part predicate, deliberately. Requiring only that the licence's name
        // appears SOMEWHERE in NOTICE is satisfied by prose — this file mentions the
        // licence again in its trademark paragraph, so a NOTICE whose actual
        // "Licensed under" statement had been changed to a different licence still
        // passed a mere-mention test. That is finding X206's shape (a guardrail
        // satisfied by text talking ABOUT the rule), caught here by deliberately
        // mutating NOTICE and watching this check stay green. So: the name must be
        // present AND the operative "Licensed under ..." statement must not name a
        // DIFFERENT recognised licence.
        const phrase = NOTICE_PHRASE[truth];
        if (phrase && !phrase.test(noticeText)) {
          fail(
            `NOTICE does not name the licence in LICENSE (${truth}) — the two files a redistributor is required to keep together disagree about what the licence is`,
          );
        }
        // Assert POSITIVELY: at least one "Licensed under ..." statement must name OUR
        // licence. Two earlier attempts at this failed on first contact and are worth
        // recording, because both failed by staying GREEN:
        //   1. Requiring the name to appear anywhere in NOTICE was satisfied by the
        //      trademark paragraph, which mentions the licence for a different reason.
        //   2. Requiring that no OTHER *recognised* licence be named could not see a
        //      swap to a licence absent from the recognised set (MPL, tried live).
        // A third defect sat inside attempt 2: the capture stopped at the first `.`,
        // so "Apache License, Version 2.0" was truncated to "Apache License, Version 2"
        // and did not match even the TRUTHFUL statement. Capturing to end of line and
        // demanding a positive match fixes all three — and cannot be satisfied by a
        // licence nobody enumerated, because an unrecognised name simply fails to match.
        const operative = [...noticeText.matchAll(/Licensed under (?:the )?([^\n]{0,80})/g)].map(
          (m) => m[1].trim(),
        );
        if (operative.length > 0 && phrase && !operative.some((o) => phrase.test(o))) {
          fail(
            `NOTICE contains ${operative.length} "Licensed under ..." statement(s) and none of them names ${truth}, the licence in LICENSE (found: ${operative.map((o) => JSON.stringify(o.slice(0, 48))).join(', ')}) — the operative licence statement disagrees with the licence actually shipped`,
          );
        }
        const refsThirdParty = /THIRD-PARTY-NOTICES\.md/.test(noticeText);
        if (refsThirdParty && read(path.join(repoRoot, 'THIRD-PARTY-NOTICES.md')) === null) {
          fail(
            'NOTICE states that third-party attributions live in THIRD-PARTY-NOTICES.md, but that file does not exist — the notice points at attributions nobody can read',
          );
        }
      }
    }
  }
}

// Both DC11 and DC12 exempt a claim the surrounding prose explains. Scoped to a SMALL WINDOW —
// the line plus the two either side — because the commonest legitimate use is a correction that
// QUOTES the text it retires, and a quotation wraps.
//
// The first attempt scoped to the whole paragraph and was measured to be useless: markdown lists
// carry no blank lines, so a ten-step numbered list is one "paragraph", and a single "(removed
// 2026-08-16)" in step 1 exempted a live claim in step 4. Worse, it exempted a deliberately
// reintroduced defect — the check reported zero hits on the exact regression it was written for.
// A window is the honest unit: a wrapped sentence spans one or two lines, a list does not.
// An exemption marker NEAR a claim is not an explanation OF the claim. 2026-08-27: all three of
// DC11, DC12 and DC13 exempted a live defect because an unrelated sentence two lines away happened
// to contain one of their marker words — and every one of those words is ordinary English in this
// codebase's prose. Measured, not theorised:
//
//   DC11  "The studio never guesses a value."      excused a live `blocked` state
//   DC11  "Keep the old notes for reference."      excused a live `blocked` state
//   DC11  "Record it rather than asking."          excused a live `blocked` state
//   DC12  "Antigravity support was removed ..."    excused a live token guarantee
//   DC13  "Antigravity support was removed ..."    excused a live mid-build pop-up
//
// DC12's was found because such a note was added to the end of the very file DC12's own regression
// test appends its fixture to, so the test went green on the defect it exists to catch. The other
// four were then found by trying the same thing deliberately.
//
// What separates a real explanation from an adjacent one is a SENTENCE. A correction retiring a
// thing names the thing in the same breath — "this used to say the publish token had a TTL", "the
// `blocked` state was renamed". An unrelated note is a different sentence, however close. So both
// halves must fall inside one sentence: `[^.]` cannot cross a full stop.
//
// A distance rather than a longer word list, which is the third time on this codebase that
// comparing a quantity has beaten enumerating spellings.
function sameSentenceRe(markerSrc, subjectSrc) {
  const marker = new RegExp(`\\b(?:${markerSrc})\\b`, 'i');
  const subject = new RegExp(`(?:${subjectSrc})`, 'i');
  // Split into real sentences, then require ONE sentence to hold both halves.
  //
  // The first attempt bounded the distance with `[^.]`, treating any full stop as a sentence end.
  // That is wrong here in the most predictable way possible: this codebase's prose is full of
  // filenames. `task-ledger.mjs REFUSES the state \`doing\`` is one sentence containing two dots,
  // so the rule split it and reported two legitimate correction notes as live defects — a check
  // that fires on honest work, which is as serious as one that misses.
  //
  // A sentence ends with `.`/`!`/`?`, optionally a closing bracket or quote, then WHITESPACE.
  // `mjs`, `7.0.0` and `e.g.` all fail that test, because nothing follows their dots but letters.
  const SENTENCE_END = /(?<=[.!?][)\]"'’”]?)\s+/;
  return {
    test: (window) =>
      window
        .split(SENTENCE_END)
        .some((sentence) => marker.test(sentence) && subject.test(sentence)),
  };
}

function explainedNear(lines, i, re, radius = 2) {
  // Whitespace COLLAPSED, not joined with newlines. Prose wraps: "approval is only / ever a
  // fresh AskUserQuestion answer" is one phrase split across two lines, and a window joined with
  // `\n` cannot match it. Found the same way twice — DC12 needed a window because a quotation
  // wrapped, and DC13 then failed to recognise its own exemption phrases for the same reason.
  const window = lines
    .slice(Math.max(0, i - radius), i + radius + 1)
    .join(' ')
    .replace(/\s+/g, ' ');
  return re.test(window);
}

// ---- DC11: the task states the product INSTRUCTS must be states the ledger accepts ------
// 2026-08-27 (contract sweep). `commands/studio-resume.md` told the studio to "set its Status back
// to `doing`" — and `doing` is not a state `hooks/task-ledger.mjs` accepts, so obeying the resume
// command produced a ledger the next gate BLOCKED on. The whole pause/resume cycle dead-ended at
// the step whose only job was to undo the pause. Four other command files and three skills carried
// the same retired vocabulary, including one skill that announced the rename on line 26 and then
// used the old word on line 127.
//
// Nothing could have caught it: the accepted states live in a Set inside a hook, the instructed
// states live in prose, and no gate compared the two. This does — reading the accepted set FROM
// task-ledger.mjs, so there is one source and this check cannot itself go stale when the states
// change.
//
// A retired state may still be MENTIONED — explaining a rename is useful, and the alternative is a
// product that cannot describe its own history. What it may not be is mentioned silently: the line
// must carry one of the retirement words below, which is exactly the sentence a reader needs
// anyway. That is the enumerated-exemption discipline the rest of these gates use: to keep the
// word, say it is retired.
{
  const ledger = read(path.join(pluginRoot, 'hooks', 'task-ledger.mjs'));
  if (ledger === null) {
    fail(
      'hooks/task-ledger.mjs is missing, so the task states this product instructs cannot be checked against the states it accepts (DC11)',
    );
  } else {
    const block = /const STATES = new Set\(\[([\s\S]*?)\]\)/.exec(ledger);
    if (!block) {
      fail(
        'hooks/task-ledger.mjs no longer declares its states as `const STATES = new Set([...])`, so DC11 cannot read them. Restore that shape or update this check — do not leave it reading nothing, which is a gate that passes because it measured nothing.',
      );
    } else {
      const accepted = new Set([...block[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
      if (accepted.size === 0) {
        fail('DC11 read hooks/task-ledger.mjs but extracted no state names from its STATES set');
      }
      // Retired states, named explicitly rather than inferred. `blocked` is here because it was
      // deliberately SPLIT (blocked-on-defect parks a task and the run continues;
      // blocked-on-human stops it) and collapsing them back is the specific regression to catch.
      const RETIRED = ['doing', 'blocked'];
      // Saying, in any of the ways the product actually says it, that the word is retired.
      // The subject is the state name itself: a line retiring `blocked` says `blocked`. See
      // sameSentenceRe — these markers are ordinary English, and three of them were measured
      // excusing a live retired state from two lines away.
      const RETIREMENT_SRC =
        'is now|used to|no longer|no bare|not a state|never|old|retired|renamed|REFUSES|instead of|rather than';
      for (const file of walk(pluginRoot)) {
        if (!file.endsWith('.md')) continue;
        const rel = path.relative(repoRoot, file);
        const text = read(file);
        if (text === null) continue;
        const lines = text.split(/\r?\n/);
        for (const [i, line] of lines.entries()) {
          for (const dead of RETIRED) {
            if (accepted.has(dead)) continue; // still a real state — nothing to say
            if (!new RegExp('`' + dead + '`').test(line)) continue;
            if (explainedNear(lines, i, sameSentenceRe(RETIREMENT_SRC, '`?' + dead + '`?')))
              continue;
            fail(
              `${rel}:${i + 1} names the task state \`${dead}\`, which hooks/task-ledger.mjs does not accept (it accepts ${[...accepted].map((a) => `\`${a}\``).join(', ')}). Following this instruction writes a ledger the gate blocks on — which is how the pause/resume cycle dead-ended. Use the current state name, or, if this line is explaining the rename, say so on the line (DC11 looks for words like "no longer", "used to", "is now") (DC11)`,
            );
          }
        }
      }
    }
  }
}

// ---- DC12: no safety GUARANTEE may rest on machinery that was deleted -----------------------
// 2026-08-27. `skills/command-centre/SKILL.md` told the reader that a scheduled wake-up "can
// never silently trigger a push" BECAUSE "the publish/checkpoint/memory-persist tokens are all
// short-lived (60-minute TTL) and long expired". Those tokens were deleted on 2026-08-16 (X214),
// for the reason recorded in scan.mjs: a token proves nothing, because anything a hook can read
// an agent on the same machine can write. It was ceremony.
//
// So a load-bearing safety promise went on being made, in the product's own words, by a mechanism
// that no longer existed — for eleven days and through an entire rebuild phase, with nothing
// objecting. This was H2 in the rebuild's own bug ledger, the register of defects v7 was supposed
// to prove it does not repeat, and it was still there.
//
// A guarantee resting on nothing is worse than no guarantee: a reader who believes it stops
// looking for the real protection. This refuses the claim wherever it is made, and — like DC11 —
// lets it be DISCUSSED on a line that says it was removed, because explaining why ceremony was
// dropped is worth keeping.
{
  // The phrases that ASSERT the mechanism. Enumerated, not swept: `token` alone is an ordinary
  // word (an auth token in an example, a lexer token), and a gate that fired on it would be
  // switched off within a day.
  const CLAIMS = [
    /\btoken gate\b/i,
    /\b(?:publish|checkpoint|memory-persist)[- ]tokens?\b/i,
    /\btokens?\b[^\n]{0,60}\bTTL\b/i,
    /\bTTL\b[^\n]{0,60}\btokens?\b/i,
  ];
  const REMOVED_WORDS =
    /\b(?:removed|deleted|no longer|no such|there is no|used to|was ceremony|retired|corrected|X214|does not exist|never existed|never required)\b/i;

  // The exemption must be about THIS claim, not merely dated. 2026-08-27: this used REMOVED_WORDS
  // alone, and `removed` is an ordinary word — so an unrelated correction note ("Antigravity
  // support was removed in 7.0.0") landing two lines from a token guarantee exempted it, and
  // DC12's own regression test went green on the exact defect it exists to catch. It surfaced
  // because that note was appended to the end of the same file the test appends its fixture to;
  // it would have happened to any file, silently, at any time.
  //
  // So the window must ALSO name the subject. A genuine correction cannot avoid it: retiring a
  // token guarantee means writing the word "token". The conjunction is the same shape DC13's
  // SCOPED() already uses, for the same reason — a marker NEAR a claim is not an explanation OF
  // the claim.
  // The subject is the token layer itself. See sameSentenceRe for why proximity alone failed —
  // this check is where that was found.
  const RETIRE_SRC =
    'removed|deleted|no longer|no such|there is no|used to|was ceremony|retired|corrected|X214|does not exist|never existed|never required';
  const EXPLAINS_THIS = sameSentenceRe(RETIRE_SRC, 'tokens?|TTL|X214|ceremony');

  for (const file of walk(pluginRoot)) {
    if (!file.endsWith('.md')) continue;
    const rel = path.relative(repoRoot, file);
    const text = read(file);
    if (text === null) continue;
    const dcLines = text.split(/\r?\n/);
    for (const [i, line] of dcLines.entries()) {
      if (!CLAIMS.some((re) => re.test(line))) continue;
      if (explainedNear(dcLines, i, EXPLAINS_THIS)) continue;
      fail(
        `${rel}:${i + 1} states a safety guarantee resting on the publish/checkpoint/memory-persist TOKEN mechanism, which was deleted on 2026-08-16 (X214) because a token proves nothing — anything a hook can read, an agent can write. A promise made by machinery that does not exist is worse than no promise, because a reader stops looking for the real protection. State what actually enforces it, or, if this line is explaining the removal, say so on the line (DC12)`,
      );
    }
  }
}

// ---- DC13: a mid-build pop-up is a run that stops -------------------------------------------
// 2026-08-27. The product's decision 1 is "one interview at kick-off, then silent". An audit of
// every place an unattended run could stop found FOURTEEN mid-build `AskUserQuestion` gates,
// including one at each of eleven stage boundaries, one per phase, and one before every task.
// Every one cited the operating charter's interview clause as its authority. The decision had been
// recorded and nothing implemented it, and the one test that proves the product happened to build
// a Tiny-Tier CLI, which reaches none of them.
//
// So: an instruction to show a pop-up must SAY which of the legitimate contexts it is in. The
// three are the kick-off interview, a publish-or-push path, and an explicit "only when a person is
// present" scoping. Notes about the tool's own limitations count too — several roles correctly
// record that they cannot call it themselves.
//
// This cannot know intent, only whether the context was stated. That is the point: stating it is
// the discipline, and an unqualified pop-up is the shape the fourteen defects had.
{
  // WHAT COUNTS AS INSTRUCTING A STOP. Widened 2026-08-27 (second pass) after measurement: the
  // first trigger was `/AskUserQuestion|pop-up MCQ|pop-up \(MCQ\)/` — CASE-SENSITIVE, and blind
  // to the bare word "pop-up". Six of the thirteen real defect lines this check was written for
  // used exactly that bare phrasing, and one was capitalised, so it would have missed nearly half
  // of them. Worse, an instruction can stop a run without naming the tool at all — "ask the user
  // and wait" is the same defect in plainer words — so those shapes are triggers too.
  const ASK =
    /AskUserQuestion|pop-?up|\bMCQ\b|blocking (?:approval|gate)|ask the (?:user|owner)|wait for (?:the |their )?(?:answer|approval|reply)/i;
  // DISTINCTIVE PHRASES ONLY. The first version of this list carried bare common words —
  // `never`, `recorded`, `cannot`, `push`, `setup`, `confirmation` — and they appear near almost
  // any prose in this repository, so the check exempted everything: measured, it reported ZERO
  // hits on a deliberately reintroduced mid-build pop-up. A gate that passes because its
  // exemption swallowed the input is the defect this whole file is about, written into a new
  // check on the day the old ones were fixed. Every entry below must be a phrase somebody would
  // only write when they actually mean one of the three legitimate contexts.
  // TWO WAYS to be legitimate, because one list of words cannot express it.
  //
  // (a) A DISTINCTIVE PHRASE that only appears when somebody means one of the three permitted
  //     contexts. The first version used bare common words — `never`, `recorded`, `cannot`,
  //     `push`, `setup` — and exempted everything: measured, ZERO hits on the reintroduced
  //     defect. The second version still carried bare `publish`, `onboarding` and `the
  //     interview`, and a later pass measured `publish` alone pre-exempting 11% of every line in
  //     the tree.
  const STRONG = new RegExp(
    [
      'a person is present',
      'asked to be consulted',
      'if a human is',
      'with somebody at the',
      'kick-off',
      'first-run',
      'kick-off interview',
      'one-off setup',
      'publish/push',
      'going public',
      'irreversible',
      'propose it upstream',
      'install it',
      'spending money',
      'pulling a model',
      'cost approval',
      'cannot call',
      'cannot pause',
      'same restriction',
      'needs the main conversation',
      'and relays',
      'only ever comes from',
      'only ever a fresh',
      'Publish stage',
      'before Publish',
      'the Publish gate',
      'publish protocol',
    ].join('|'),
    'i',
  );
  // (b) An UNATTENDED SCOPING, which is a conjunction rather than a word: the window must say it
  //     is about the unattended case AND say what happens instead. "unattended" alone is too
  //     common in this tree to carry the exemption on its own.
  const SCOPED = (w) =>
    /unattended|headless/i.test(w) &&
    /record|continue|carry on|skip|default|never a pop-?up|no pop-?up|proceed|stop/i.test(w);
  // (c) A DATED CORRECTION NOTE. This repository records why something changed, in place, and
  //     those notes necessarily quote the instruction they retired. Recognised by the date or by
  //     the retiring phrase — the same discipline DC11 and DC12 already use.
  // The subject is the human gate being discussed. Measured: "Antigravity support was removed in
  // 7.0.0", two lines above a live mid-build pop-up, excused it — see sameSentenceRe.
  const HISTORICAL_SRC =
    '20\\d\\d-\\d\\d-\\d\\d|used to|this said|before this|no longer|the same defect|was removed|removes a|corrected|never be acted|freeform entry|collected nowhere|puts its pop-up|met four blocking';
  const HISTORICAL = sameSentenceRe(
    HISTORICAL_SRC,
    'pop-?up|AskUserQuestion|MCQ|interview|approval|blocking gate|ask the (?:user|owner)',
  );
  const LEGITIMATE = { test: (w) => STRONG.test(w) || SCOPED(w) || HISTORICAL.test(w) };

  // (d) TWO WHOLE-FILE exemptions, both structural rather than verbal:
  //     * a command carrying `disable-model-invocation: true` cannot fire on its own — a person
  //       typed it, so asking them something is the entire point;
  //     * `agents/interviewer.md`, whose single job IS the kick-off interview.
  //     And frontmatter `description:` lines, which describe a skill rather than instruct a run.
  const fileExempt = (rel, text) =>
    /disable-model-invocation:\s*true/.test(text) || /agents\/interviewer\.md$/.test(rel);

  for (const dir of ['skills', 'agents', 'commands']) {
    for (const file of walk(path.join(pluginRoot, dir))) {
      if (!file.endsWith('.md')) continue;
      const rel = path.relative(repoRoot, file);
      const text = read(file);
      if (text === null) continue;
      if (fileExempt(rel, text)) continue;
      const lines = text.split(/\r?\n/);
      for (const [i, line] of lines.entries()) {
        if (!ASK.test(line)) continue;
        if (/^\s*description:/.test(line)) continue; // frontmatter describes, it does not instruct
        if (explainedNear(lines, i, LEGITIMATE)) continue;
        fail(
          `${rel}:${i + 1} instructs a pop-up (\`AskUserQuestion\`) without saying which context it belongs to. An unattended run cannot answer one: it stops there, and this product's decision 1 is one interview at kick-off then silent — fourteen gates like this were found on 2026-08-27, every one citing the charter as authority. Say the context on or near the line: the kick-off interview, a publish/push path, or "only when a person is present and has asked to be consulted" — and otherwise record the decision in Dev-Memory/decisions/ and carry on (DC13)`,
        );
      }
    }
  }
}

// ---- DC14: no hook may contain a network client ---------------------------------------------
//
// 2026-08-27. `docs/STABILITY.md` promises this for the whole life of 7.0.x, and until this
// check existed the only thing standing behind that promise was a comment in this very file
// saying "the plugin now makes NO outbound network call at all — so the property is finally
// true", followed by "it is still not asserted as a gate here, because nothing checks it".
// A promise in the stability contract with nothing checking it is the defect this repository
// has spent two days on; the comment even named the fix ("a sweep for `fetch(`/`http` in the
// hooks tree"), which is what this is.
//
// It is deliberately the NARROW property. "The plugin makes no network call" is false and was
// removed from STABILITY.md the same day: three roles are instructed to use the host's own web
// search, and `licence-scan.mjs` shells out to `cargo metadata` and `dart pub deps`, either of
// which contacts a registry on a cold cache. Neither is a hook reaching the network under its
// own steam, and neither is something a gate over this tree could honestly forbid. What IS
// checkable is that no hook carries a client of its own — and that is the half a reader relies
// on, because it is the half that would send something without being asked.
//
// The v6 counter-example is real, not hypothetical: `openrouter-models.mjs` read a public
// catalogue with Node's built-in `fetch`. It was deleted with the model integrations, and
// nothing would have noticed it coming back.
{
  const NET_IMPORT =
    /(?:^|[^\w.])fetch\s*\(|require\(\s*['"](?:node:)?(?:https?|net|dns|tls|dgram)['"]\s*\)|from\s+['"](?:node:)?(?:https?|net|dns|tls|dgram)['"]|import\s*\(\s*['"](?:node:)?(?:https?|net|dns|tls|dgram)['"]\s*\)/;
  const hooksDir = path.join(pluginRoot, 'hooks');
  // The test suite lives in this directory and is NOT a hook: it is never wired into
  // hooks.json and never runs as one, and it necessarily contains every forbidden spelling as
  // fixture data — the tests for this very check write `fetch(...)` and `import https` into
  // temporary files to prove it bites. The first version of DC14 flagged hooks.test.mjs on the
  // real tree and took eight unrelated tests down with it, which is how a gate earns being
  // switched off. Narrow by construction: `.test.mjs` cannot be a hook, and excluding it cannot
  // hide a live client, because nothing ever executes it as one.
  const entries = listDir(hooksDir).filter(
    (d) => d.isFile() && d.name.endsWith('.mjs') && !d.name.endsWith('.test.mjs'),
  );
  if (entries.length === 0) {
    fail(
      'DC14 found no .mjs files under plugins/gru953-studio/hooks/, so the no-network-client property promised in docs/STABILITY.md could not be checked. A gate that reads nothing must never report the thing it reads as fine.',
    );
  }
  for (const d of entries) {
    const full = path.join(hooksDir, d.name);
    const text = read(full);
    if (text === null) {
      fail(
        `DC14 could not read plugins/gru953-studio/hooks/${d.name}, so it cannot say whether that hook contains a network client (DC14)`,
      );
      continue;
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Comments are where this property gets DISCUSSED — including in this check's own header,
      // which names `fetch(` twice. Skipping them is not a loophole: a comment cannot open a
      // socket. Code hidden after `//` on a line is still code, so only leading-comment lines
      // and block-comment bodies are skipped, which is what a hook's prose actually looks like.
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
      if (!NET_IMPORT.test(line)) continue;
      fail(
        `plugins/gru953-studio/hooks/${d.name}:${i + 1} contains a network client (\`fetch\`, or an import of http/https/net/dns/tls/dgram). docs/STABILITY.md promises for the life of 7.0.x that no hook has one, and v6 shipped exactly this — openrouter-models.mjs fetched a public catalogue — so the promise needs a check rather than a comment. If a hook genuinely must reach the network, change the contract first, in the open (DC14)`,
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
