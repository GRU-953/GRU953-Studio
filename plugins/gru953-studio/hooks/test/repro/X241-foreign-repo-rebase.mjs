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

// THE SHIPPED GUARD, IMPORTED — not a copy.
//
// 2026-08-24, X292. This was "the guard, re-implemented here from the two properties it asserts rather
// than by importing the module", with the honest reason that importing `auto-update.mjs` would run the
// updater against this checkout and pull. The reason was sound and the consequence was that all five
// cases below tested an eight-line local duplicate, while the SHIPPED guard was touched only by four
// substring tests over the file's text. So `!crosses && carries` becoming `||`, or the boolean
// inverted, or `relative()` called on the wrong pair of paths, would keep every substring present and
// every case green while the nightly unattended updater rebased a stranger's repository again — which
// is the CRITICAL finding this file exists for.
//
// The fix was to move the guard into `lib.mjs` as `updateRootIsOurs()`, which `auto-update.mjs` now
// imports. lib.mjs has no side effects on import, so the original objection no longer applies: this
// file can import the real implementation and there is no second copy to drift.
const { updateRootIsOurs } = await import(join(HOOKS, 'lib.mjs'));
const rootIsOurs = (start, root) => (root ? updateRootIsOurs(start, root) : false);
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
  // The substring tests are kept — they are cheap and they catch the guard being deleted outright —
  // but they are no longer what this file rests on. Cases A to E now exercise the shipped function.
  const wired = /rootIsOurs/.test(SRC) && /updateRootIsOurs/.test(SRC);
  if (!wired) {
    note(
      'auto-update.mjs no longer imports updateRootIsOurs() from lib.mjs, so either the guard has ' +
        'been deleted or a second copy of it has appeared — and a second copy is what X292 was ' +
        "raised for. findGitRoot's answer would be used unchecked.",
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
    console.log(
      '  A  real Homebrew layout ....................... absent on this machine, skipped',
    );
  } else {
    const root = findGitRoot(found);
    if (rootIsOurs(found, root)) {
      note(
        `case A: the real installed copy at ${found} resolves to ${root} and is treated as ours`,
      );
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
  // Deliberately give the installed copy its OWN manifest, which is what a real package ships.
  //
  // 2026-08-24, X292: this comment used to claim "property 2 alone would pass here, so this case is
  // what makes property 1 load-bearing". THAT CLAIM WAS FALSE, and it was false in a way no assertion
  // in this file could see. `carriesThisPlugin` looks at the ROOT, not at the installed copy, and this
  // fixture's root has no manifest — so property 2 refuses this case on its own and property 1 is
  // never the reason. Proved by mutation once the shipped guard became importable: swapping the
  // arguments of `path.relative` breaks the node_modules test completely and every case here still
  // passed. Case B2 below is the fixture that actually isolates property 1.
  mkdirSync(
    join(tmp, 'proj', 'node_modules', '@gru953', 'studio-cli', 'plugin', '.claude-plugin'),
    {
      recursive: true,
    },
  );
  writeFileSync(
    join(
      tmp,
      'proj',
      'node_modules',
      '@gru953',
      'studio-cli',
      'plugin',
      '.claude-plugin',
      'plugin.json',
    ),
    '{"name":"gru953-studio"}',
  );
  if (rootIsOurs(start, findGitRoot(start))) {
    note('case B: an installed copy under node_modules is treated as our own repository');
  } else {
    console.log('  B  installed copy under node_modules .......... REFUSED');
  }
}

// ---- B2: the case that isolates property 1 -----------------------------------------
//
// A repository that DOES carry a plugin manifest at its root AND has this plugin installed underneath
// it as a dependency. Ordinary rather than contrived: anyone developing their own plugin marketplace
// repo who also installs GRU953-Studio is in exactly this layout. Property 2 PASSES here, so the only
// thing that can refuse it is the node_modules boundary — which makes this the one case where a break
// in property 1 is visible.
{
  const root = mk('mine');
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), '{"name":"someone-elses-plugin"}');
  const start = mk('mine', 'node_modules', '@gru953', 'studio-cli', 'plugin', 'hooks');
  if (rootIsOurs(start, findGitRoot(start))) {
    note(
      'case B2: a repository that carries its own plugin manifest and has this plugin installed ' +
        'under node_modules is treated as ours. Property 2 passes here by design, so this is the ' +
        'case that shows the node_modules boundary is working — and it is the only one that does.',
    );
  } else {
    console.log('  B2 our plugin as a dependency of a plugin repo . REFUSED');
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
