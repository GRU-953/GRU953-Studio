#!/usr/bin/env node
//
// roster-check.mjs — mechanically checks the agent-role count against the
// baseline recorded in the most recent Dev-Memory/decisions/*roster*.md
// entry. Added 2026-07-10 Round 2 audit fix: `scope-guardian`'s "mechanical
// check" was, until this script existed, still just prose inside its own
// agent file — real progress over Round 1 (a falsifiable, human-checkable
// claim) but not yet an actual script. This is that script. Like
// licence-scan.mjs and verify-progress.mjs, it is intentionally NOT wired
// into hooks.json/PreToolUse (there is no natural trigger for "an agent
// file was added" the way there is for "a push happened") — run it
// manually via scope-guardian at any stage boundary, and as part of the
// Publish pre-flight.
//
// Usage: node roster-check.mjs [pluginRoot] [devMemoryRoot]
// pluginRoot defaults to the directory this script lives in, one level up
// from hooks/. devMemoryRoot defaults to the current working directory.
// Exit 0 = agent count matches (or is covered by) the most recent recorded
// baseline. Exit 1 = agent count exceeds the last recorded baseline with no
// newer decision file explaining the growth.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { formatFsError } from './lib.mjs';

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // 2026-08-15, finding X114 (High, reproduced). Two roots is correct by design — an
  // installed plugin lives outside the project whose baseline governs it. What was wrong
  // is that they were defaulted INDEPENDENTLY, so a bare invocation paired "the plugin
  // next to this script" with "any file matching /roster/i under whatever directory you
  // happened to be standing in", and nobody had asserted that those belong together.
  //
  // Both directions were reachable, and the second is why this is High:
  //   a foreign baseline of 5  -> BLOCKED for apparent scope creep that does not exist
  //   a foreign baseline of 90 -> CLEAN, so this plugin could grow from 38 roles to 89
  //                               unnoticed, measured against another project's number
  //
  // No cleverer rule settles it. A project baseline may legitimately EXCEED the plugin's
  // own ROSTER.md — recording a deliberate addition with its reason is exactly what it is
  // for — so comparing the numbers cannot distinguish legitimate from accidental. Nor can
  // "is the plugin inside the project": for an installed plugin it never is.
  //
  // What can be distinguished is whether anybody asserted the pairing. Both roots given
  // means the caller asserted it; both defaulted means nobody did. So a defaulted pairing
  // that would adopt a project baseline is refused below, naming the exact command to run.
  // Reproduction: hooks/test/repro/X114-cross-project-baseline.mjs.
  const pluginRootGiven = typeof process.argv[2] === 'string' && process.argv[2] !== '';
  const devMemoryRootGiven = typeof process.argv[3] === 'string' && process.argv[3] !== '';
  const rootsAsserted = pluginRootGiven && devMemoryRootGiven;

  // 2026-08-24, X280, on the owner's decision. X114's repair made the two counts safe by requiring
  // the CALLER to name both roots — and not one of the four shipped callers was ever updated to do
  // so. All four ran it bare, as did the packaged copy an installing user receives, while every
  // sibling gate in the same pre-flight lists was invoked with a root (`licence-scan.mjs .`,
  // `verify-progress.mjs .`, `content-check.mjs .`). So the reproduction proved a property of an
  // invocation the product never made.
  //
  // The four call sites are fixed in the same commit. This refuses the bare form outright rather than
  // falling back to a guess, because a guess is what X114 was about: without both roots this counted
  // the INSTALLED plugin's agents against the USER'S project baseline, which is two different trees.
  // A check whose safety depends on an argument nobody passes has never been safe.
  //
  // It is a BREAKING change for anyone outside the product invoking it bare, which is why it needed
  // the owner's word. The message says exactly what to type.
  if (!rootsAsserted) {
    console.log(
      JSON.stringify({
        status: 'BLOCKED',
        reason:
          'roster-check needs both roots named, and will not guess them (finding X280). Run it as ' +
          '`node roster-check.mjs <plugin-root> <project-root>` — for example ' +
          '`node "${CLAUDE_PLUGIN_ROOT}/hooks/roster-check.mjs" "${CLAUDE_PLUGIN_ROOT}" .`. Without ' +
          'both, it counted the agents of the INSTALLED plugin against the baseline of YOUR project, ' +
          'which are two different trees, and reported the difference as a roster change (X114).',
        pluginRootGiven,
        devMemoryRootGiven,
      }),
    );
    process.exit(1);
  }

  const pluginRoot = process.argv[2];
  const devMemoryRoot = process.argv[3];

  const agentsDir = path.join(pluginRoot, 'agents');
  let agentFiles = [];
  try {
    agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
  } catch {
    console.log(JSON.stringify({ status: 'no agents/ directory found', agentsDir }));
    process.exit(1);
  }
  const currentCount = agentFiles.length;

  // 2026-07-11 v2.0.0 fix: fall back to the committed product baseline
  // (plugins/gru953-studio/ROSTER.md) when no per-project Dev-Memory baseline
  // exists. A project BUILT BY the studio records its baseline in
  // Dev-Memory/decisions/*roster*.md; the PRODUCT repo itself has no
  // Dev-Memory, so before this fallback existed this check could never pass
  // on GRU953-Studio's own repository (and CI therefore couldn't run it).
  const decisionsDir = path.join(devMemoryRoot, 'Dev-Memory', 'decisions');
  let decisionFiles = [];
  try {
    decisionFiles = fs.readdirSync(decisionsDir).filter((f) => /roster/i.test(f));
  } catch {
    decisionFiles = [];
  }

  // X114: a project baseline was found, but nobody said this project governs this plugin.
  // Refusing here rather than adopting it is the whole fix — the alternative is a number
  // from an unrelated project silently deciding whether this roster has grown.
  if (decisionFiles.length > 0 && !rootsAsserted) {
    console.log(
      JSON.stringify(
        {
          status: 'BLOCKED',
          reason:
            `a roster baseline was found at ${decisionsDir} (${decisionFiles.join(', ')}), but neither root was given, so nothing establishes that this project's baseline governs the roster at ${pluginRoot}. ` +
            `A baseline from an unrelated project can both block a healthy roster and, worse, pass a grown one — it is only a number. ` +
            `Re-run naming both roots to assert the pairing: node roster-check.mjs <pluginRoot> <projectRoot> (finding X114)`,
          pluginRoot,
          devMemoryRoot,
          currentCount,
          rootsAsserted,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  if (decisionFiles.length === 0) {
    // No per-project baseline — try the committed product baseline.
    const rosterFile = path.join(pluginRoot, 'ROSTER.md');
    let rosterText = null;
    try {
      rosterText = fs.readFileSync(rosterFile, 'utf8');
    } catch {
      rosterText = null;
    }
    if (rosterText === null) {
      console.log(
        JSON.stringify(
          {
            status: 'BLOCKED',
            reason: `agents/ has ${currentCount} roles but no Dev-Memory/decisions/*roster*.md baseline and no committed ROSTER.md to check against`,
            currentCount,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    // 2026-07-12 Round 7 audit fix: bounded-but-arbitrary-gap search still
    // false-blocked legitimate longer prose around the count — tightened to
    // require immediate adjacency (see repo-integrity.mjs's matching INV 8
    // comment for the full reproduction and rationale).
    // 2026-07-21 audit fix: take the LAST match, not the first — a ROSTER.md that
    // narrates an earlier/hypothetical count before the authoritative one ("...50
    // considered (role count: 50) but settled on baseline = 5") would otherwise
    // read the wrong number, which in one direction hides real scope creep.
    // 2026-08-26, v7. "Take the LAST match" was fixed in 2026-07-21 for a ROSTER.md that
    // narrates a hypothetical count BEFORE the authoritative one. But this file's authoritative
    // count is its bold header on line 3, and everything after it is dated history — which
    // states the count as it was at the time, correctly. So the last match is a HISTORICAL
    // number, and the rule only appeared to work while history happened to agree with the
    // present. The first time the roster actually changed (38 -> 36) it read 38 from a v4.5.0
    // section and reported the new roster as exceeding a baseline it had itself just set.
    //
    // Fixed by preferring the bold `**role count: N**` declaration — the committed-baseline form
    // this file's own header uses — and falling back to the previous last-match rule only when
    // no such declaration exists, so the 2026-07-21 case stays covered.
    const bold = [...rosterText.matchAll(/\*\*\s*role count[ \t]*[:=]?[ \t]*(\d+)\s*\*\*/gi)];
    const rmAll = bold.length
      ? bold
      : [...rosterText.matchAll(/(?:role count|baseline)[ \t]*[:=]?[ \t]*(\d+)/gi)];
    const rm = rmAll.length ? (bold.length ? rmAll[0] : rmAll[rmAll.length - 1]) : null;
    if (!rm) {
      console.log(
        JSON.stringify(
          {
            status: 'BLOCKED',
            reason: `ROSTER.md exists but states no numeric "role count: <n>"`,
            currentCount,
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    const recordedBaseline = parseInt(rm[1], 10);
    if (currentCount > recordedBaseline) {
      console.log(
        JSON.stringify(
          {
            status: 'BLOCKED',
            reason: `agents/ has ${currentCount} roles, exceeding the committed ROSTER.md baseline of ${recordedBaseline} — update ROSTER.md with a named reason before this count is acceptable`,
            currentCount,
            recordedBaseline,
            source: 'ROSTER.md',
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    console.log(
      JSON.stringify(
        { status: 'clean', currentCount, recordedBaseline, source: 'ROSTER.md' },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  // 2026-07-12 audit fix (MAJOR, found by execution, both directions):
  // decision files are named YYYY-MM-DD-*.md, and this used to rely on
  // lexical string sort being chronological — which silently breaks the
  // moment any file uses a non-zero-padded month/day (e.g. `2026-9-5-...`
  // for September instead of `2026-09-05-...`), since JS string comparison
  // puts `'9'` after `'1'` as characters even though month 9 < month 12
  // numerically. Reproduced live in both directions: a stale `2026-9-5`
  // decision sorted AFTER a true-latest `2026-12-01` rollback, silently
  // reviving a superseded, higher baseline (false-clean, the worse
  // direction — defeats this script's whole anti-growth purpose); the
  // reverse ordering also produced a false-BLOCK against a legitimate
  // newer, higher baseline. Fixed by parsing the leading YYYY-M-D (allowing
  // 1-2 digit month/day so an existing non-padded filename still parses
  // correctly, rather than only masking the bug going forward) and sorting
  // by the actual numeric date, not the raw filename string.
  function decisionFileDate(name) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})-/.exec(name);
    if (!m) return null;
    return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  }
  decisionFiles.sort((a, b) => {
    const da = decisionFileDate(a);
    const db = decisionFileDate(b);
    if (da === null && db === null) return a < b ? -1 : a > b ? 1 : 0;
    if (da === null) return -1; // undated names sort before any dated one
    if (db === null) return 1;
    return da - db;
  });
  const latest = decisionFiles[decisionFiles.length - 1];
  const latestPath = path.join(decisionsDir, latest);
  // 2026-07-26 audit fix: this read was unguarded, unlike every other read in
  // this file (the ROSTER.md fallback above, and both readdirSync calls, all
  // have a try/catch). Reproduced by execution: replacing the just-listed
  // file with a dangling symlink between the readdirSync above and this read
  // (a real TOCTOU window — a rename, a git operation, or a corrupt symlink
  // synced in) throws ENOENT with a raw Node stack trace and exit 1, instead
  // of this script's own structured BLOCKED JSON contract every other failure
  // path here uses.
  let text;
  try {
    text = fs.readFileSync(latestPath, 'utf8');
  } catch (e) {
    console.log(
      JSON.stringify(
        {
          status: 'BLOCKED',
          reason: `could not read the latest roster decision file (${latest}): ${formatFsError(e)}`,
          currentCount,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  // 2026-07-12 Round 7 audit fix: same immediate-adjacency tightening as
  // above — checked this project's own real Dev-Memory decision files
  // (e.g. "agent role count = 16") to confirm the tighter pattern still
  // matches the actual phrasing used, not just ROSTER.md's.
  // 2026-07-21 audit fix: last match wins (see the ROSTER.md fallback above) so a
  // decision file that mentions an earlier count before the authoritative one
  // cannot silently set the wrong baseline.
  const mAll = [...text.matchAll(/(?:role count|baseline)[ \t]*[:=]?[ \t]*(\d+)/gi)];
  const m = mAll.length ? mAll[mAll.length - 1] : null;
  if (!m) {
    console.log(
      JSON.stringify(
        {
          status: 'BLOCKED',
          reason: `latest roster decision file (${latest}) doesn't state a numeric baseline`,
          currentCount,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const recordedBaseline = parseInt(m[1], 10);

  if (currentCount > recordedBaseline) {
    console.log(
      JSON.stringify(
        {
          status: 'BLOCKED',
          reason: `agents/ has ${currentCount} roles, exceeding the last recorded baseline of ${recordedBaseline} (${latest}) — add a new *roster* decision file naming the gap and reason before this count is acceptable`,
          currentCount,
          recordedBaseline,
          latestDecisionFile: latest,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      { status: 'clean', currentCount, recordedBaseline, latestDecisionFile: latest },
      null,
      2,
    ),
  );
  process.exit(0);
}

main();
