#!/usr/bin/env node
//
// Reproduction for X249 — the statusline hook relabelled OTHER plugins' subagents as this plugin's
// own, and showed an empty pair of brackets when a task had no status.
//
// `shortRoleName` did `String(name).split(':').pop()` and matched that bare tail against this
// plugin's own `agents/*.md` filenames. The Agent tool names a plugin-shipped subagent
// "<plugin>:<role>", so another plugin's `theirplugin:reviewer` matched on `reviewer` and its row
// was rewritten to "GRU953-Studio — reviewer (working)".
//
// EIGHT of this plugin's 38 role names are ordinary English words another plugin could plausibly
// use: architect, builder, fixer, interviewer, publisher, researcher, reviewer, tester. So this is
// not a contrived collision.
//
// And the file's own header promised the opposite, in so many words: "every other subagent (another
// plugin's, or a built-in one) is left with the platform's own default `name · description · token
// count` rendering by simply not including its id in the output, exactly as documented." So the hook
// mislabelled other people's work AND contradicted its own documentation — the shape this programme
// has found more often than any other.
//
// The second half is smaller and worth fixing in the same pass: `String(t.status || '')` meant a
// task whose status the host omitted rendered as "GRU953-Studio — reviewer ()". An empty bracket, in
// a hook whose entire stated purpose is "no jargon, no walls of text" for a non-technical reader.
//
// Found by the completeness critic. The adjudicator examined the token-figure question in this same
// block — and graded it CANNOT-DETERMINE, correctly, since it depends on a platform rendering
// contract this machine cannot observe — and did not name the misattribution sitting beside it,
// which is the more serious half and needs no platform knowledge at all.
//
//   case                                                       required
//   A  another plugin's qualified subagent                      NOT claimed
//   B  a task with no status                                     no empty bracket
//   C  control: this plugin's own qualified subagent             still claimed
//   D  control: a bare role name                                 still claimed
//   E  control: our prefix but not a real role                   not claimed
//   F  control: the plugin name is read, not hardcoded           a rename cannot silently void it
//
// Controls C and D are the ones that stop this being "fixed" by claiming nothing at all, which would
// pass A and B and quietly remove the feature. E stops the prefix check being the ONLY check. F
// exists because a check written against a hardcoded name becomes a check for nothing the day the
// plugin is renamed, and nothing would fail.
//
// Usage:
//   node X249-statusline-claims-other-plugins.mjs                # asserts the fixed state
//   node X249-statusline-claims-other-plugins.mjs --expect-bug   # asserts the defects

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOK = join(here, '..', '..', 'subagent-statusline.mjs');
const MANIFEST = join(here, '..', '..', '..', '.claude-plugin', 'plugin.json');

const problems = [];
const note = (s) => problems.push(s);

// Drive the real hook, so this cannot pass by re-implementing the predicate charitably.
const run = (tasks, columns = 80) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ columns, tasks }),
    encoding: 'utf8',
  });
  return (r.stdout || '')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { id: '(unparseable)', content: l };
      }
    });
};

const pluginName = (() => {
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8')).name || 'gru953-studio';
  } catch {
    return 'gru953-studio';
  }
})();

// ---- A: another plugin's subagent must be left alone -------------------------------
{
  const out = run([
    { id: 'theirs', name: 'theirplugin:reviewer', status: 'running' },
    { id: 'theirs2', name: 'some-other-plugin:tester', status: 'completed' },
  ]);
  if (out.length) {
    note(
      `case A: ${out.length} row(s) belonging to another plugin were claimed and relabelled: ` +
        out.map((o) => `${o.id} -> "${o.content}"`).join('; '),
    );
  } else {
    console.log("  A  another plugin's subagents ................ left on the default rendering");
  }
}

// ---- B: a missing status must not render an empty bracket --------------------------
{
  const out = run([{ id: 'nostatus', name: `${pluginName}:reviewer` }]);
  const empty = out.filter((o) => /\(\s*\)/.test(o.content));
  if (empty.length) {
    note(
      `case B: a task with no status rendered an empty bracket: "${empty[0].content}" — shown to a ` +
        'non-technical reader by a hook whose stated purpose is no jargon and no walls of text',
    );
  } else if (!out.length) {
    note(
      'case B: a task with no status now produces NO ROW at all. That is a different regression — ' +
        'the row should still be labelled, just without an empty bracket',
    );
  } else {
    console.log(
      `  B  missing status ............................ no empty bracket ("${out[0].content}")`,
    );
  }
}

// ---- C: our own qualified subagent must still be claimed ---------------------------
{
  const out = run([{ id: 'ours', name: `${pluginName}:reviewer`, status: 'running' }]);
  if (out.length !== 1 || !/GRU953-Studio/.test(out[0].content || '')) {
    note(
      "control C: this plugin's own qualified subagent is no longer claimed, so the fix has removed " +
        'the feature rather than narrowing it',
    );
  } else {
    console.log('  C  control: our own qualified subagent ....... still claimed');
  }
}

// ---- D: a bare role name must still be claimed -------------------------------------
{
  const out = run([{ id: 'bare', name: 'reviewer', status: 'completed' }]);
  if (out.length !== 1) {
    note(
      'control D: a BARE role name is no longer claimed. The hook documents that the caller may pass ' +
        'either the qualified or the bare form, so dropping the bare form breaks the documented case',
    );
  } else {
    console.log('  D  control: a bare role name ................. still claimed');
  }
}

// ---- E: our prefix with a name that is not a role must not be claimed --------------
{
  const out = run([
    { id: 'notarole', name: `${pluginName}:definitely-not-a-role`, status: 'running' },
  ]);
  if (out.length) {
    note(
      'control E: a name carrying our prefix but naming no real role was claimed, so the prefix ' +
        'check has replaced the role check instead of joining it',
    );
  } else {
    console.log('  E  control: our prefix, not a real role ...... not claimed');
  }
}

// ---- F: the plugin name must be read, not hardcoded --------------------------------
{
  const src = readFileSync(HOOK, 'utf8');
  const reads = /plugin\.json/.test(src) && /PLUGIN_NAME/.test(src);
  if (!reads) {
    note(
      'control F: the owning-plugin check does not read the plugin manifest, so it rests on a ' +
        'hardcoded name — and the day the plugin is renamed the check silently matches nothing and ' +
        "every other plugin's subagents are claimed again, with no test failing",
    );
  } else {
    console.log('  F  control: plugin name read from manifest ... yes');
  }
}

if (expectBug) {
  if (!problems.length) {
    console.error('FAIL: --expect-bug found nothing; this is not the defective state.');
    process.exit(1);
  }
  console.log(`\nREPRODUCED (${problems.length}):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(0);
}
if (problems.length) {
  console.error(`FAIL (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  "\nPASS: only this plugin's own subagents are relabelled, a missing status shows no empty bracket, " +
    'and the owning-plugin check is read from the manifest rather than hardcoded.',
);
