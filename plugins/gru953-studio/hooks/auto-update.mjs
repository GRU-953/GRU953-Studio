#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const studioRoot = path.resolve(__dirname, '..', '..', '..');

// Only check once a day automatically. For manual checks, pass '--force'
const force = process.argv.includes('--force');
const checkFile = path.join(studioRoot, '.last-update-check');

if (!force) {
    if (fs.existsSync(checkFile)) {
        const stat = fs.statSync(checkFile);
        const now = new Date();
        const diffMs = now - stat.mtime;
        // 24 hours in milliseconds
        if (diffMs < 24 * 60 * 60 * 1000) {
            process.exit(0);
        }
    }
}

// Touch the file to record the check time
fs.writeFileSync(checkFile, new Date().toISOString(), 'utf8');

const isGitRepo = fs.existsSync(path.join(studioRoot, '.git'));
if (isGitRepo) {
    try {
        // Check if there are updates available on the remote
        execSync('git remote update', { cwd: studioRoot, stdio: 'ignore' });
        const status = execSync('git status -uno', { cwd: studioRoot, encoding: 'utf8' });
        
        if (status.includes('Your branch is behind')) {
            console.log('Universal Agentic Studio: Update available. Applying now...');
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
            // "resulted in conflicts" — this file already has one documented,
            // known bug (locale-dependent parsing of `git status` output,
            // scheduled separately) from doing exactly that, and repeating the
            // mistake here while fixing an adjacent one would be perverse.
            // Instead: `git diff --name-only --diff-filter=U` lists unmerged
            // (conflicted) paths directly, in a machine-readable, locale-
            // independent form — this is the actual ground truth of "did a
            // conflict get left behind," regardless of what git printed.
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
                }).split('\n').map((l) => l.trim()).filter(Boolean);
                if (conflicted.length > 0) {
                    console.error('Universal Agentic Studio: the update did NOT apply cleanly.');
                    console.error(`Your own uncommitted changes conflicted with the update in: ${conflicted.join(', ')}`);
                    console.error('Those files now contain conflict markers (<<<<<<< / ======= / >>>>>>>) and your original changes are also saved in the stash.');
                    console.error('Resolve the conflicts in the listed files, or run `git checkout --theirs -- <file>` / `--ours` to pick a side, then `git stash drop`. Do not leave the conflict markers in place.');
                    process.exitCode = 1;
                } else {
                    console.log('Universal Agentic Studio: update applied successfully.');
                    if (pullOutput.trim()) console.log(pullOutput.trim());
                }
            } catch (pullError) {
                const rebaseInProgress = fs.existsSync(path.join(studioRoot, '.git', 'rebase-merge')) || fs.existsSync(path.join(studioRoot, '.git', 'rebase-apply'));
                console.error('Universal Agentic Studio: the update did NOT apply cleanly.');
                if (rebaseInProgress) {
                    console.error('A rebase is still in progress and some files may contain unresolved conflict markers.');
                    console.error('Run `git status` in the plugin directory to see what changed, then either resolve the conflicts and run `git rebase --continue`, or run `git rebase --abort` to return to how things were before this update.');
                } else {
                    console.error((pullError.stderr || pullError.message || '').toString().trim());
                }
                process.exitCode = 1;
            }
        } else if (force) {
            console.log('Universal Agentic Studio is up to date.');
        }
    } catch (e) {
        // Network/remote errors reaching `git remote update` or `git status`
        // itself (before any pull was attempted) — nothing was changed locally.
        if (force) console.error('Update check failed:', e.message);
    }
} else {
    // If installed globally via npm (as @gru953/studio-cli for instance)
    try {
        // In a background process, we could run npm update, but for now just output a message if forced
        if (force) {
            console.log('Run `npm install -g @gru953/studio-cli@latest` to update.');
        }
    } catch (e) {}
}

// Deliberately NOT process.exit(0) — that would silently overwrite
// process.exitCode = 1, set above when the pull did not apply cleanly. Letting
// the process exit naturally preserves whichever exit code was actually set.
