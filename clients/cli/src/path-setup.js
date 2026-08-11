// path-setup.js — makes the `gru953-studio` command available in a new terminal.
//
// Usually nothing is needed: `npm install -g` puts its binaries somewhere already
// on the PATH. This module exists for the case where it does not — most often
// after the user has been told to set a custom npm prefix to avoid permission
// errors, which is exactly the advice install.sh gives.
//
// Two deliberate constraints:
//
//  1. It edits ONE file, the user's own shell profile, inside a clearly marked
//     block, and rewrites that block in place on a re-run rather than appending
//     a second copy. That marked-block idiom is not invented here — it is the
//     same one universal-init.js already uses, added by a 2026-07-26 fix after
//     three runs left three duplicate copies in a user's config file.
//  2. It never touches a system-wide PATH, and never needs administrator rights.
//
// The caller decides whether to write at all. `plan()` reports what WOULD change
// so the user can be asked first, which matters more here than almost anywhere
// else in this project: a broken shell profile is the one failure that can stop
// a terminal opening properly.

const fs = require('fs');
const os = require('os');
const path = require('path');

const BEGIN = '# GRU953-STUDIO:BEGIN';
const END = '# GRU953-STUDIO:END';

/**
 * The profile file to edit, chosen from the shell the user is actually running
 * rather than from the platform. Guessing ~/.bashrc for someone using zsh writes
 * a file their terminal never reads, and the command still would not be found.
 */
function profileFor({ platform = process.platform, homeDir = os.homedir(), env = process.env } = {}) {
    if (platform === 'win32') return null; // Windows uses the registry, not a profile file
    const shell = path.basename(env.SHELL || '');
    if (shell === 'zsh') return path.join(homeDir, '.zshrc');
    if (shell === 'fish') return path.join(homeDir, '.config', 'fish', 'config.fish');
    if (shell === 'bash') {
        // On macOS a login shell reads .bash_profile and not .bashrc, which is a
        // long-standing source of "I added it and it still does not work".
        return platform === 'darwin' ? path.join(homeDir, '.bash_profile') : path.join(homeDir, '.bashrc');
    }
    return platform === 'darwin' ? path.join(homeDir, '.zshrc') : path.join(homeDir, '.profile');
}

function blockFor(binDir, { fish = false } = {}) {
    const body = fish
        ? `fish_add_path "${binDir}"`
        : `export PATH="${binDir}:$PATH"`;
    return `${BEGIN}\n# Added by GRU953-Studio so the "gru953-studio" command can be found.\n# Safe to delete this whole block if you no longer want it.\n${body}\n${END}`;
}

/** True when `binDir` is already on the PATH, so nothing needs doing. */
function alreadyOnPath(binDir, { env = process.env, platform = process.platform } = {}) {
    const sep = platform === 'win32' ? ';' : ':';
    const entries = (env.PATH || env.Path || '').split(sep).filter(Boolean);
    const norm = (p) => (platform === 'win32' ? p.toLowerCase().replace(/[\\/]+$/, '') : p.replace(/\/+$/, ''));
    return entries.some((e) => norm(e) === norm(binDir));
}

/**
 * @returns {{needed: boolean, reason: string, file: string|null, block: string|null, manualInstruction: string|null}}
 *   Pure: reads nothing and writes nothing, so a caller can show the user exactly
 *   what would change before anything does.
 */
function plan(binDir, options = {}) {
    const { platform = process.platform, homeDir = os.homedir(), env = process.env } = options;
    if (alreadyOnPath(binDir, { env, platform })) {
        return { needed: false, reason: 'It is already on your PATH — nothing to change.', file: null, block: null, manualInstruction: null };
    }
    if (platform === 'win32') {
        return {
            needed: true,
            reason: 'The folder holding the command is not on your PATH.',
            file: null,
            block: null,
            manualInstruction: `setx PATH "%PATH%;${binDir}"`,
        };
    }
    const file = profileFor({ platform, homeDir, env });
    const fish = !!file && file.endsWith('config.fish');
    return {
        needed: true,
        reason: 'The folder holding the command is not on your PATH.',
        file,
        block: blockFor(binDir, { fish }),
        manualInstruction: fish ? `fish_add_path "${binDir}"` : `export PATH="${binDir}:$PATH"`,
    };
}

/**
 * Writes the marked block, replacing any previous one. Only ever call this after
 * the user has agreed — see the note at the top of this file.
 * @returns {{changed: boolean, file: string, action: string}}
 */
function apply(binDir, options = {}) {
    const p = plan(binDir, options);
    if (!p.needed || !p.file) return { changed: false, file: p.file, action: 'nothing-to-do' };

    fs.mkdirSync(path.dirname(p.file), { recursive: true });
    const existing = fs.existsSync(p.file) ? fs.readFileSync(p.file, 'utf8') : '';
    const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const region = new RegExp(`${escaped(BEGIN)}[\\s\\S]*?${escaped(END)}`);
    if (region.test(existing)) {
        const replaced = existing.replace(region, p.block);
        if (replaced === existing) return { changed: false, file: p.file, action: 'already-correct' };
        fs.writeFileSync(p.file, replaced, 'utf8');
        return { changed: true, file: p.file, action: 'replaced' };
    }
    const joiner = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
    fs.writeFileSync(p.file, `${existing}${joiner}\n${p.block}\n`, 'utf8');
    return { changed: true, file: p.file, action: existing.length === 0 ? 'created' : 'appended' };
}

module.exports = { plan, apply, profileFor, alreadyOnPath, blockFor, BEGIN, END };
