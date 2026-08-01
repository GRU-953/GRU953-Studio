#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatFsError } from './lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2026-07-26 Stage 3 fix (audit finding 23, first half). This used to be a
// flat `path.resolve(__dirname, '..', '..', '..')` — a hardcoded guess that
// the git repository containing this plugin is always exactly three levels
// above hooks/. That holds for the layout THIS repository happens to use
// (plugins/gru953-studio/hooks/), but nothing guarantees every installation
// mechanism preserves that exact depth — a differently-vendored or cached
// install could sit the plugin at a different depth inside its own git
// checkout, and the fixed-depth guess would silently point at the wrong
// directory (or one with no `.git` at all, even though a real one exists
// nearby). `lib.mjs`'s findStudioRoot() already solves the analogous problem
// (locating Dev-Memory) by walking up from a known-correct starting point
// rather than guessing a depth; this does the same for `.git`, verified by
// actually checking for it at every level rather than assuming. Falls back
// to the old fixed-depth guess only if no `.git` is found anywhere up the
// tree at all (a genuine non-git install, where the exact fallback value is
// moot — the `isGitRepo` check below will be false either way).
function findGitRoot(start) {
  let d = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}
const studioRoot = findGitRoot(__dirname) || path.resolve(__dirname, '..', '..', '..');

// Only check once a day automatically. For manual checks, pass '--force'
const force = process.argv.includes('--force');
const checkFile = path.join(studioRoot, '.last-update-check');

// 2026-07-29 maintenance fix (audit finding 3): this used to be two separate,
// unguarded calls (`existsSync` then `statSync`) racing against anything else
// that might touch this path in between — the same race lib.mjs's
// isDirectory() was already fixed for elsewhere, just for a plain file
// instead of a directory. isDirectory() itself doesn't fit here (this needs
// the file's mtime, not an is-a-directory check), so this uses the same
// single-guarded-call idiom scan.mjs already uses for the analogous case.
//
// 2026-07-29 maintenance fix (further pass): the catch block used to
// reassign `stat = null`, which is redundant — `stat` is already `null` from
// its declaration whenever statSync throws before ever assigning it.
// Simplified to an empty catch body, matching this file's own convention
// elsewhere for a deliberately-ignored error.
if (!force) {
  let stat = null;
  try {
    stat = fs.statSync(checkFile);
  } catch {
    // checkFile doesn't exist yet, or couldn't be statted — stat stays null.
  }
  if (stat) {
    const now = new Date();
    const diffMs = now - stat.mtime;
    // 24 hours in milliseconds
    if (diffMs < 24 * 60 * 60 * 1000) {
      process.exit(0);
    }
  }
}

// Touch the file to record the check time.
// 2026-07-29 maintenance fix (audit finding 3): this was a bare, unguarded
// fs.writeFileSync — the same "never show a raw stack trace" gap lib.mjs's
// formatFsError()/writeConfirmationRecordOrExit() already closed elsewhere
// (see dashboard.mjs's write, wrapped the same way). Not fatal: losing this
// bookkeeping write only means the check runs more than once a day, so it is
// reported (when running with --force, matching this file's own existing
// convention for non-fatal check failures below) rather than aborting the
// update check that follows.
try {
  fs.writeFileSync(checkFile, new Date().toISOString(), 'utf8');
} catch (e) {
  if (force) {
    console.error(
      `GRU953-Studio: could not record the update-check time at ${checkFile} (${formatFsError(e)}).`,
    );
  }
}

const isGitRepo = fs.existsSync(path.join(studioRoot, '.git'));
if (isGitRepo) {
  try {
    // Check if there are updates available on the remote
    execSync('git remote update', { cwd: studioRoot, stdio: 'ignore' });
    // 2026-07-26 Stage 3 fix (audit finding 23, second half). This used to
    // parse `git status -uno`'s human-facing text for the literal English
    // phrase "Your branch is behind" — git translates that phrase (and
    // every other porcelain status line) via gettext whenever a matching
    // locale is installed and LANG/LC_ALL selects it, so this silently
    // never detected an available update for anyone not running git in
    // English. (This exact translated string could not be reproduced
    // directly in this sandbox — no git locale catalogs are installed
    // here — but git's own localisation of this porcelain message is
    // well-documented and not in question; what WAS verified directly is
    // the replacement below staying numeric under a bogus LC_ALL, which
    // is the property the fix actually depends on.)
    //
    // `git rev-list --count HEAD..@{u}` reports how many commits the
    // upstream is ahead of HEAD as a bare number — no natural-language
    // text at all, so no locale can change it. Verified: identical output
    // under LC_ALL=C, a real non-English locale tag, and a nonsense one.
    // `@{u}` throws if no upstream tracking branch is configured; that is
    // treated as "can't check", not "up to date" — the same fail-honest
    // choice this file already makes for a genuine network/remote error
    // just below.
    const behindCount = parseInt(
      execSync('git rev-list --count HEAD..@{u}', { cwd: studioRoot, encoding: 'utf8' }).trim(),
      10,
    );

    if (Number.isFinite(behindCount) && behindCount > 0) {
      console.log('GRU953-Studio: Update available. Applying now...');
      // 2026-07-26, found during a further pass. Two distinct bugs here,
      // and the first fix attempt at this only caught the first one.
      //
      // Bug A: this used to spawn the pull DETACHED and unref()'d, then
      // fall through to `process.exit(0)` a few lines below without
      // waiting for it — so the parent reported success before the child
      // had necessarily even started. Fixed by making the pull synchronous.
      //
      // Bug B, NOT caught by simply checking execSync's thrown/not-thrown
      // outcome: `git pull --rebase --autostash` exits 0 even when the
      // autostash POP afterwards leaves conflict markers in a real file.
      // The rebase itself (a clean fast-forward here) is what the exit
      // code reflects; the stash-pop conflict is reported only as text on
      // stderr, with no non-zero exit. Reproduced: a local uncommitted
      // edit conflicting with the incoming change left literal
      // `<<<<<<< Updated upstream` markers in a tracked file and an
      // un-popped `stash@{0}: autostash` entry — while `execSync` returned
      // normally and this code, before this second fix, printed "update
      // applied successfully."
      //
      // Deliberately NOT matched by parsing English stderr text like
      // "resulted in conflicts" — this file's OWN "behind" detection
      // above used to do exactly that (locale-dependent parsing of
      // `git status` output, now fixed as part of the same Stage 3
      // pass), and repeating the mistake here while fixing an adjacent
      // one would be perverse. Instead: `git diff --name-only
      // --diff-filter=U` lists unmerged (conflicted) paths directly, in
      // a machine-readable, locale-independent form — this is the
      // actual ground truth of "did a conflict get left behind,"
      // regardless of what git printed.
      //
      // This script is only invoked from the explicit `/studio-update`
      // command now (session-start.mjs no longer calls it automatically),
      // whose own instructions tell the assistant to "execute this script
      // now... then report the result back to the user" — so what this
      // prints has to be actually true.
      //
      // Deliberately does NOT attempt to auto-resolve a conflict or
      // auto-abort the rebase on failure — that would be a second,
      // unconfirmed mutation on top of the one that just left conflicts.
      // It reports plainly and leaves the repository exactly as git left
      // it, so the assistant can see the real state and tell the user
      // the truth.
      try {
        const pullOutput = execSync('git pull --rebase --autostash', {
          cwd: studioRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const conflicted = execSync('git diff --name-only --diff-filter=U', {
          cwd: studioRoot,
          encoding: 'utf8',
        })
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        if (conflicted.length > 0) {
          console.error('GRU953-Studio: the update did NOT apply cleanly.');
          console.error(
            `Your own uncommitted changes conflicted with the update in: ${conflicted.join(', ')}`,
          );
          console.error(
            'Those files now contain conflict markers (<<<<<<< / ======= / >>>>>>>) and your original changes are also saved in the stash.',
          );
          console.error(
            'Resolve the conflicts in the listed files, or run `git checkout --theirs -- <file>` / `--ours` to pick a side, then `git stash drop`. Do not leave the conflict markers in place.',
          );
          process.exitCode = 1;
        } else {
          console.log('GRU953-Studio: update applied successfully.');
          if (pullOutput.trim()) console.log(pullOutput.trim());
        }
      } catch (pullError) {
        const rebaseInProgress =
          fs.existsSync(path.join(studioRoot, '.git', 'rebase-merge')) ||
          fs.existsSync(path.join(studioRoot, '.git', 'rebase-apply'));
        console.error('GRU953-Studio: the update did NOT apply cleanly.');
        if (rebaseInProgress) {
          console.error(
            'A rebase is still in progress and some files may contain unresolved conflict markers.',
          );
          console.error(
            'Run `git status` in the plugin directory to see what changed, then either resolve the conflicts and run `git rebase --continue`, or run `git rebase --abort` to return to how things were before this update.',
          );
        } else {
          console.error((pullError.stderr || pullError.message || '').toString().trim());
        }
        process.exitCode = 1;
      }
    } else if (force) {
      console.log('GRU953-Studio is up to date.');
    }
  } catch (e) {
    // Network/remote errors reaching `git remote update` or `git status`
    // itself (before any pull was attempted) — nothing was changed locally.
    if (force) console.error('Update check failed:', e.message);
  }
} else {
  // 2026-07-29 maintenance fix (audit finding 1): `@gru953/studio-cli` has
  // never been published to npm (confirmed 404 from the registry) and there
  // is no publish step anywhere in .github/workflows/, so `npm install -g
  // @gru953/studio-cli@latest` can never succeed — this used to tell users
  // to run a command that always fails. This branch only runs when no `.git`
  // was found anywhere above this file (see findGitRoot above), so the
  // git-based update path above cannot apply either: the honest answer is
  // that there is currently no automatic update mechanism for this kind of
  // installation.
  // 2026-07-29 maintenance fix (audit finding 10): the try/catch around this
  // single console.log with an empty catch block was dead code — nothing
  // here can throw — so it is removed along with the fix above rather than
  // kept for a single non-throwing call.
  if (force) {
    console.log(
      'No automatic update is available for this installation (it is not a git checkout). ' +
        'Re-clone https://github.com/GRU-953/GRU953-Studio.git to get the latest version.',
    );
  }
}

// Deliberately NOT process.exit(0) — that would silently overwrite
// process.exitCode = 1, set above when the pull did not apply cleanly. Letting
// the process exit naturally preserves whichever exit code was actually set.
