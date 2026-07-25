#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
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
            console.log('Universal Agentic Studio: Update available. Applying in background...');
            // Spawn a detached background process to pull updates so it doesn't block
            const child = spawn('git', ['pull', '--rebase', '--autostash'], {
                cwd: studioRoot,
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
        } else if (force) {
            console.log('Universal Agentic Studio is up to date.');
        }
    } catch (e) {
        // Ignore network errors in background update
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

process.exit(0);
