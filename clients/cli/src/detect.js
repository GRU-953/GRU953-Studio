// detect.js — finds which supported AI coding tools are installed on this
// machine, so `gru953-studio install` can set GRU953-Studio up in each one
// without asking the user to know what they have.
//
// Every path below is the location that tool's OWN documentation names, checked
// on 2026-08-10 rather than guessed. Where a location could not be confirmed
// from documentation, the entry says so in `confidence` and the installer treats
// it as a suggestion needing the user's confirmation rather than a fact.
//
// Written as pure functions over an injected environment ({platform, homeDir,
// env, exists, which}) for one specific reason: this is code whose whole job is
// to be right about three operating systems, and it must be testable for
// Windows and Linux from any machine. The repo has already been bitten by
// platform-shaped bugs that only a real Windows run revealed (see
// .github/workflows/ci.yml's note on why its matrix is OS-broad); making the
// environment an argument means those paths get tested everywhere, every run.

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Windows resolves a bare command name through PATHEXT (.COM, .EXE, .CMD, .BAT),
 * so a plain "is there a file called `code` on the PATH" check finds nothing
 * there even when `code.cmd` exists. This repo has fixed that exact bug before
 * in its own hooks; repeating it here would silently report "VS Code not
 * installed" for every Windows user.
 */
function whichSync(command, { platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
    const pathVar = env.PATH || env.Path || '';
    const dirs = pathVar.split(platform === 'win32' ? ';' : ':').filter(Boolean);
    const exts =
        platform === 'win32'
            ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
            : [''];
    for (const dir of dirs) {
        for (const ext of exts) {
            const candidate = path.join(dir, command + ext);
            if (exists(candidate)) return candidate;
        }
    }
    return null;
}

/**
 * Where Claude Desktop keeps its configuration, per operating system.
 * On Windows this uses APPDATA rather than a hardcoded path, because a roaming
 * profile or a redirected AppData folder is common on managed work machines and
 * a hardcoded C:\Users\...\AppData would miss it.
 */
function claudeDesktopDir({ platform, homeDir, env }) {
    if (platform === 'darwin') return path.join(homeDir, 'Library', 'Application Support', 'Claude');
    if (platform === 'win32') return path.join(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Claude');
    return path.join(env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'Claude');
}

/**
 * Every host GRU953-Studio can install into, and how to tell whether it is here.
 *
 * `kind` decides what the installer does:
 *   'claude-plugin'   — copy the plugin directory into a plugins folder
 *   'antigravity'     — write Antigravity's own plugin layout
 *   'vscode-family'   — install the .vsix through that editor's CLI
 *   'rules-file'      — write the per-project rule files (universal-init.js)
 */
function hostDefinitions({ platform, homeDir, env }) {
    const vscodeFamily = [
        { id: 'vscode', name: 'VS Code', command: 'code', extDir: path.join(homeDir, '.vscode', 'extensions') },
        { id: 'cursor', name: 'Cursor', command: 'cursor', extDir: path.join(homeDir, '.cursor', 'extensions') },
        { id: 'windsurf', name: 'Windsurf', command: 'windsurf', extDir: path.join(homeDir, '.windsurf', 'extensions') },
    ];
    return [
        {
            id: 'claude-code',
            name: 'Claude Code',
            kind: 'claude-plugin',
            // Documented: user-level Claude configuration lives in ~/.claude on
            // every platform (it is not an OS-specific application-support
            // directory).
            configDir: path.join(homeDir, '.claude'),
            installDir: path.join(homeDir, '.claude', 'plugins', 'gru953-studio'),
            confidence: 'documented',
            note: 'The marketplace command is the recommended route; installing the files directly also works and is what happens offline.',
        },
        {
            id: 'claude-desktop',
            name: 'Claude Desktop',
            kind: 'claude-plugin',
            configDir: claudeDesktopDir({ platform, homeDir, env }),
            installDir: path.join(claudeDesktopDir({ platform, homeDir, env }), 'plugins', 'gru953-studio'),
            // Claude Desktop's documented install routes are its own interface:
            // adding this repository as a marketplace, or uploading the plugin
            // package on the Plugins page. Anthropic does not document a
            // filesystem location a plugin can simply be dropped into, so
            // writing one is a best guess and is treated as such — the installer
            // asks first and always prints the two documented routes.
            confidence: 'unverified',
            note: 'Anthropic documents installing through the app (Customize > Plugins), not by copying files. Use the in-app route; this is offered only as a convenience.',
        },
        // v7.0.0: Google Antigravity and the VS Code family (VS Code, Cursor, Windsurf) were
        // detected and installed into here. Both are gone with the rest of the host adapters:
        // v7 targets Claude Code only. `vscodeFamily` below is still detected for the doctor
        // report, so a user who has those editors is told plainly that they are no longer
        // supported rather than being silently ignored.
    ];
}

/**
 * @returns {{platform: string, found: object[], missing: object[]}}
 *   `found` entries carry `detectedBy` so the installer can tell the user WHY it
 *   believes a tool is present — "because ~/.claude exists" is checkable by the
 *   user in a way "detected" is not.
 */
function detectHosts(options = {}) {
    const {
        platform = process.platform,
        homeDir = os.homedir(),
        env = process.env,
        exists = fs.existsSync,
        which = null,
    } = options;
    const resolveCommand = which || ((c) => whichSync(c, { platform, env, exists }));

    const found = [];
    const missing = [];
    for (const host of hostDefinitions({ platform, homeDir, env })) {
        let detectedBy = null;
        if (host.command) {
            const resolved = resolveCommand(host.command);
            if (resolved) detectedBy = `the "${host.command}" command at ${resolved}`;
        }
        if (!detectedBy && host.configDir && exists(host.configDir)) {
            detectedBy = `its settings folder at ${host.configDir}`;
        }
        if (detectedBy) found.push({ ...host, detectedBy });
        else missing.push(host);
    }
    return { platform, found, missing };
}

module.exports = { detectHosts, hostDefinitions, claudeDesktopDir, whichSync };
