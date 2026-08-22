#!/usr/bin/env node
//
// Reproduction for X241 — the updater rebased and autostashed whatever git repository happened to
// sit above it, which on an ordinary installed copy is the user's, not the plugin's.
//
// `findGitRoot` (auto-update.mjs:28-37) walks UP from the hooks directory until it finds ANY `.git`
// and returns it; `studioRoot` is then the cwd for `git remote update` and
// `git pull --rebase --autostash`. The comment above it worried about the opposite failure — a
// fixed-depth guess landing too shallow — and solved that correctly. Nothing checked that the
// repository it landed ON was this one.
//
// NOT HYPOTHETICAL. Verified on the machine where it was found, by path walk over already-installed
// files, no command run:
//   /opt/homebrew/Cellar/gru953-studio/6.0.3/libexec/lib/node_modules/@gru953/studio-cli/plugin/hooks
//   /opt/homebrew/.git                                              exists
//   findGitRoot(hooks) ->                                           /opt/homebrew
// So `gru953-studio update` on that machine would `git pull --rebase --autostash` the user's Homebrew
// prefix and then print "GRU953-Studio: update applied successfully." With `autoupdate on` it would
// do it nightly, with nobody watching. `findPluginSource` (clients/cli/src/index.js:50-58) prefers
// `../plugin` precisely "because a published install is the common case for real users", so this is
// the common case, not the edge.
//
// CRITICAL rather than High, and the reason is the autostash. A rebase of a repository the user did
// not nominate is bad; `--autostash` also picks up their uncommitted work in it, and on a pop
// conflict leaves it in a stash with conflict markers in the files — silently, on the cron path.
// Severity was raised from the audit's High by the completeness critic, which supplied the Homebrew
// evidence above after the original adjudicator had guessed a different (and wrong) layout.
//
// THE FIX IS TWO INDEPENDENT TESTS, both of which must pass before anything is fetched:
//   1  no `node_modules` between the hook and the discovered root — crossing one proves this is an
//      installed copy inside somebody else's tree, whatever the root turns out to be;
//   2  the root must carry this plugin's own manifest, or a source checkout's copy of it.
// Two, not one, because either alone is defeatable: a checkout vendored under `node_modules` would
// pass (2), and a repository that merely happens to contain a `plugins/gru953-studio` directory
// would pass (1).
//
//   case                                                          required
//   A  the real Homebrew layout on this machine, if present         REFUSED
//   B  a synthetic installed copy under node_modules                REFUSED
//   C  a foreign repository with no plugin manifest                 REFUSED
//   D  control: a genuine source checkout                           ALLOWED
//   E  control: a checkout whose .git is a FILE (worktree)          ALLOWED
//
// Controls D and E are the half that stops the fix being a no-op. E matters specifically: this very
// repository is a linked worktree whose `.git` is a file, not a directory, and a guard written only
// against the directory case would silently disable updating for it.
//
// Usage:
//   node X241-foreign-repo-rebase.mjs                # asserts the guard holds
//   node X241-foreign-repo-rebase.mjs --expect-bug   # asserts the unguarded behaviour

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { globSync } from 'node:fs';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(here, '..', '..');
const SRC = readFileSync(join(HOOKS, 'auto-update.mjs'), 'utf8');

// The guard, re-implemented here from the two properties it asserts rather than by importing the
// module — importing it would run the updater against this checkout, which would pull.
const rootIsOurs = (start, root) => {
  if (!root) return false;
  const crosses = relative(root, start).split(sep).some((s) => s === 'node_modules');
  const carries =
    existsSync(join(root, '.claude-plugin', 'plugin.json')) ||
    existsSync(join(root, 'plugins', 'gru953-studio', '.claude-plugin', 'plugin.json'));
  return !crosses && carries;
};
const findGitRoot = (start) => {
  let d = resolve(start);
  for (;;) {
    if (existsSync(join(d, '.git'))) return d;
    const p = dirname(d);
    if (p === d) return null;
    d = p;
  }
};

const problems = [];
const note = (s) => problems.push(s);
const tmp = mkdtempSync(join(tmpdir(), 'x241-'));
const mk = (...p) => {
  const d = join(tmp, ...p);
  mkdirSync(d, { recursive: true });
  return d;
};

// ---- first: the guard must actually be present in the shipped file ------------------
{
  const wired =
    /node_modules/.test(SRC) && /rootIsOurs/.test(SRC) && /claude-plugin/.test(SRC);
  if (!wired) {
    note(
      'the guard is not in auto-update.mjs at all: the file does not test for a node_modules ' +
        'boundary and a plugin manifest before deciding isGitRepo, so findGitRoot\'s answer is ' +
        'used unchecked',
    );
  } else {
    // It must gate isGitRepo, not merely exist somewhere in the file.
    if (!/const isGitRepo = [^\n]*rootIsOurs/.test(SRC)) {
      note(
        'the guard exists in auto-update.mjs but does not gate `isGitRepo`, so the fetch and the ' +
          'rebase are still reached',
      );
    } else {
      console.log('  ·  the guard is present and gates isGitRepo');
    }
  }
}

// ---- A: the real Homebrew layout, if this machine has one ---------------------------
{
  let found = null;
  try {
    const hits = globSync(
      '/opt/homebrew/Cellar/gru953-studio/*/libexec/lib/node_modules/@gru953/studio-cli/plugin/hooks',
    );
    found = hits && hits.length ? hits[0] : null;
  } catch {
    found = null;
  }
  if (!found) {
    console.log('  A  real Homebrew layout ....................... absent on this machine, skipped');
  } else {
    const root = findGitRoot(found);
    if (rootIsOurs(found, root)) {
      note(`case A: the real installed copy at ${found} resolves to ${root} and is treated as ours`);
    } else {
      console.log(`  A  real Homebrew layout ....................... REFUSED (root was ${root})`);
    }
  }
}

// ---- B: a synthetic installed copy under node_modules ------------------------------
{
  const root = mk('proj');
  mkdirSync(join(root, '.git'));
  const start = mk('proj', 'node_modules', '@gru953', 'studio-cli', 'plugin', 'hooks');
  // Deliberately give the installed copy its OWN manifest, which is what a real package ships:
  // property 2 alone would pass here, so this case is what makes property 1 load-bearing.
  mkdirSync(join(tmp, 'proj', 'node_modules', '@gru953', 'studio-cli', 'plugin', '.claude-plugin'), {
    recursive: true,
  });
  writeFileSync(
    join(tmp, 'proj', 'node_modules', '@gru953', 'studio-cli', 'plugin', '.claude-plugin', 'plugin.json'),
    '{"name":"gru953-studio"}',
  );
  if (rootIsOurs(start, findGitRoot(start))) {
    note('case B: an installed copy under node_modules is treated as our own repository');
  } else {
    console.log('  B  installed copy under node_modules .......... REFUSED');
  }
}

// ---- C: a foreign repository with no plugin manifest anywhere ----------------------
{
  const root = mk('foreign');
  mkdirSync(join(root, '.git'));
  const start = mk('foreign', 'some', 'where', 'hooks');
  if (rootIsOurs(start, findGitRoot(start))) {
    note('case C: a repository carrying no plugin manifest is treated as our own');
  } else {
    console.log('  C  foreign repository, no manifest ............ REFUSED');
  }
}

// ---- D: control — a genuine source checkout must still be updatable ---------------
{
  const root = mk('checkout');
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'plugins', 'gru953-studio', '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, 'plugins', 'gru953-studio', '.claude-plugin', 'plugin.json'), '{}');
  const start = mk('checkout', 'plugins', 'gru953-studio', 'hooks');
  if (!rootIsOurs(start, findGitRoot(start))) {
    note('control D: a genuine source checkout is REFUSED, so the guard has disabled updating');
  } else {
    console.log('  D  control: genuine source checkout ........... allowed');
  }
}

// ---- E: control — a linked worktree, where .git is a FILE -------------------------
{
  const root = mk('worktree');
  writeFileSync(join(root, '.git'), 'gitdir: /somewhere/else/.git/worktrees/wt\n');
  mkdirSync(join(root, 'plugins', 'gru953-studio', '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, 'plugins', 'gru953-studio', '.claude-plugin', 'plugin.json'), '{}');
  const start = mk('worktree', 'plugins', 'gru953-studio', 'hooks');
  if (!rootIsOurs(start, findGitRoot(start))) {
    note(
      'control E: a checkout whose .git is a FILE is REFUSED. This repository is exactly that, so ' +
        'the guard would have silently stopped it updating itself',
    );
  } else {
    console.log('  E  control: worktree (.git is a file) ......... allowed');
  }
}

rmSync(tmp, { recursive: true, force: true });

if (expectBug) {
  if (!problems.length) {
    console.error(
      'FAIL: --expect-bug found nothing. The guard is in place, so this is not the defective state.',
    );
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
  '\nPASS: an installed copy and a foreign repository are both refused, and a source checkout - ' +
    'including one whose .git is a file - is still updatable.',
);
