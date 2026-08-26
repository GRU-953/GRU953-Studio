// install-targets.js — puts GRU953-Studio into each host found on this machine.
//
// A note on where the Antigravity layout lives, recorded plainly because it is a
// deliberate duplication rather than an oversight:
//
// clients/antigravity/src/install.js contains the same layout logic. The two are
// separate published npm packages, so a relative require across them works in a
// git checkout and breaks the moment either is installed from npm, and making one
// depend on the other couples their versions for about forty lines of code. The
// duplication is the lesser evil — but duplication of a load-bearing layout WILL
// drift, so hooks.test.mjs asserts both implementations produce the same
// structure. If that test fails, the two have diverged and one of them is wrong.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Prefer a link so a `git pull` in the checkout updates every install at once;
 * fall back to a real copy when the filesystem will not allow it.
 *
 * A junction rather than a symlink first on Windows: a plain symlink needs
 * Developer Mode or administrator rights there, which most Windows users have
 * neither enabled nor heard of, while a junction does the same job for a
 * directory with no special privilege. Same reasoning, and the same fallback, as
 * clients/antigravity/src/link-or-copy.js.
 */
function linkOrCopy(sourceDir, targetPath, platform = process.platform) {
    try {
        fs.symlinkSync(sourceDir, targetPath, platform === 'win32' ? 'junction' : undefined);
        return { ok: true, method: 'linked' };
    } catch {
        try {
            fs.cpSync(sourceDir, targetPath, { recursive: true });
            return { ok: true, method: 'copied' };
        } catch (e) {
            return { ok: false, error: e };
        }
    }
}

/** Installs the Claude plugin format: the plugin directory, as-is. */
function installClaudePlugin(host, { pluginSourceDir, platform = process.platform }) {
    const parent = path.dirname(host.installDir);
    try {
        fs.mkdirSync(parent, { recursive: true });
    } catch (e) {
        return { ok: false, message: `Could not create ${parent}: ${e.message}` };
    }
    if (fs.existsSync(host.installDir)) {
        return { ok: true, message: `Already installed at ${host.installDir} — left as it is.`, changed: false };
    }
    const r = linkOrCopy(pluginSourceDir, host.installDir, platform);
    return r.ok
        ? { ok: true, message: `Installed at ${host.installDir} (${r.method}).`, changed: true }
        : { ok: false, message: `Could not install to ${host.installDir}: ${r.error.message}` };
}

/**
 * Installs Antigravity's own layout. Kept in step with
 * clients/antigravity/src/install.js by a test — see the note at the top.
 */
function installAntigravity(host, { pluginSourceDir, platform = process.platform }) {
    const target = host.installDir;
    const steps = [];
    try {
        fs.mkdirSync(target, { recursive: true });
    } catch (e) {
        return { ok: false, message: `Could not create ${target}: ${e.message}` };
    }

    let version = '0.0.0';
    try {
        version =
            JSON.parse(fs.readFileSync(path.join(pluginSourceDir, '.claude-plugin', 'plugin.json'), 'utf8')).version ||
            version;
    } catch {
        /* cosmetic only; a missing version must not stop the install */
    }
    // 2026-08-22, X253: the same correction as clients/antigravity/src/install.js, applied here
    // because the two carry this layout logic on purpose (see the header note) and fixing one twin
    // while leaving the other is the mistake this project calls L14. These three writes are
    // unconditional and reported the same word whether the file was new or replaced, while `skills/`
    // beside them is guarded — so one run could report skills "already present" in the same breath
    // as silently replacing a rules file the user had edited. The writes are unchanged: these are
    // generated projections of the plugin, and a stale copy is worse than a replaced one. What
    // changes is that a replacement now says so.
    try {
        const pluginJsonPath = path.join(target, 'plugin.json');
        const replacing = fs.existsSync(pluginJsonPath);
        fs.writeFileSync(
            pluginJsonPath,
            JSON.stringify({ name: 'gru953-studio', version }, null, 2) + '\n',
            'utf8',
        );
        steps.push(replacing ? 'plugin.json (replaced)' : 'plugin.json');
    } catch (e) {
        return { ok: false, message: `Could not write plugin.json: ${e.message}` };
    }

    const skillsTarget = path.join(target, 'skills');
    if (!fs.existsSync(skillsTarget)) {
        const r = linkOrCopy(path.join(pluginSourceDir, 'skills'), skillsTarget, platform);
        if (!r.ok) return { ok: false, message: `Could not install the skills: ${r.error.message}` };
        steps.push(`skills (${r.method})`);
    }

    const rulesTarget = path.join(target, 'rules');
    try {
        fs.mkdirSync(rulesTarget, { recursive: true });
        const rosterPath = path.join(rulesTarget, 'gru953-roster.md');
        const replacingRoster = fs.existsSync(rosterPath);
        fs.writeFileSync(rosterPath, buildRosterRule(pluginSourceDir), 'utf8');
        steps.push(replacingRoster ? 'rules/gru953-roster.md (replaced)' : 'rules/gru953-roster.md');
        const charter = path.join(pluginSourceDir, 'skills', 'operating-charter', 'SKILL.md');
        if (!fs.existsSync(charter)) return { ok: false, message: `Could not find the operating charter at ${charter}.` };
        const charterPath = path.join(rulesTarget, 'gru953-operating-charter.md');
        const replacingCharter = fs.existsSync(charterPath);
        fs.copyFileSync(charter, charterPath);
        steps.push(
            replacingCharter
                ? 'rules/gru953-operating-charter.md (replaced)'
                : 'rules/gru953-operating-charter.md',
        );
    } catch (e) {
        return { ok: false, message: `Could not write the rules: ${e.message}` };
    }

    return {
        ok: true,
        changed: true,
        message: `Installed at ${target} (${steps.join(', ')}). the roster is provided as a rules file Antigravity follows itself (it does support separate subagents since CLI v1.1.6; installing the 38 as real subagents is not done yet - X43), so the roster is provided as a rules file it follows itself.`,
    };
}

/** Derived from the real agents/ directory, never hand-maintained. */
function buildRosterRule(pluginSourceDir) {
    const agentsDir = path.join(pluginSourceDir, 'agents');
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort();
    const rows = files.map((f) => {
        const name = f.replace(/\.md$/, '');
        let summary = '';
        try {
            const fm = fs.readFileSync(path.join(agentsDir, f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
            const d = fm && fm[1].match(/^description:\s*(.*)$/m);
            if (d) {
                summary = d[1].trim().replace(/^["'>|-]+\s*/, '').replace(/["']\s*$/, '');
                if (summary.length > 240) summary = summary.slice(0, 237) + '...';
                summary = summary.replace(/\|/g, '\\|');
            }
        } catch {
            /* a role with an unreadable file still gets a row */
        }
        return `| \`${name}\` | ${summary} |`;
    });
    return `# GRU953-Studio specialist roster

Antigravity plugins support skills and rules but have no \`agents/\` component
(verified against antigravity.google/docs/plugins, 2026-08-10), so these
specialists are not separate subagents here as they are in Claude Code. When the
studio protocol calls for one, adopt that role yourself and follow its brief.

**${files.length} specialists.**

| Role | What it owns |
| :-- | :-- |
${rows.join('\n')}
`;
}

/**
 * Installs the .vsix through the editor's own CLI, which is the supported route
 * for VS Code and its forks. Copying files into an extensions folder by hand
 * would skip the editor's own registration step and produce an extension it
 * lists but never activates.
 */
function installVscodeFamily(host, { vsixPath, platform = process.platform }) {
    if (!vsixPath || !fs.existsSync(vsixPath)) {
        return {
            ok: false,
            message: `No .vsix file was found to install. Download "gru953-studio-<version>.vsix" from https://github.com/GRU-953/GRU953-Studio/releases and run: ${host.command} --install-extension <the file you downloaded>`,
        };
    }
    // 2026-08-22, X246: `shell: true` is needed on Windows because these hosts ship a `.cmd`
    // launcher, and Node's own documentation warns that it does NOT escape arguments in that mode —
    // so the path went to cmd.exe raw. A `.vsix` path containing a shell metacharacter would break
    // the command, and `&` in particular would end it and start another. Rather than attempt
    // cmd.exe quoting, which is a well-known source of its own bugs, a path that cannot be passed
    // safely is not passed at all: the user is told the exact command to run themselves. Refusing
    // to build a command we cannot build correctly is the only honest option here.
    const UNSAFE_FOR_CMD = /["%&|<>^]/;
    if (platform === 'win32' && UNSAFE_FOR_CMD.test(vsixPath)) {
        return {
            ok: false,
            changed: false,
            message: `The extension file's location contains a character Windows treats specially, so it cannot be installed automatically without risk: ${vsixPath}. Install it by hand with this command, or move the file to a folder whose name has only letters, numbers, spaces, dashes and underscores: ${host.command} --install-extension "${vsixPath}"`,
        };
    }
    const r = spawnSync(host.command, ['--install-extension', vsixPath, '--force'], {
        encoding: 'utf8',
        shell: platform === 'win32',
    });
    if (r.status === 0) return { ok: true, changed: true, message: `Installed into ${host.name}.` };
    return {
        ok: false,
        message: `${host.name} refused the extension: ${(r.stderr || r.stdout || '').trim() || 'no output'}. You can install it by hand with: ${host.command} --install-extension ${vsixPath}`,
    };
}

/**
 * @param {object[]} hosts     from detectHosts().found
 * @returns {{results: Array<{host, ok, message, changed, skipped}>}}
 *   A host whose `confidence` is not 'documented' is SKIPPED unless
 *   `allowUnverified` is set. Claude Desktop is the case that matters: Anthropic
 *   documents installing through the app, not by copying files into a folder, so
 *   guessing a folder and writing to it silently is not something to do on the
 *   user's behalf. It is offered, with the documented route printed alongside.
 */
function installInto(hosts, options = {}) {
    const { pluginSourceDir, vsixPath = null, platform = process.platform, allowUnverified = false } = options;
    const results = [];
    for (const host of hosts) {
        if (host.confidence !== 'documented' && !allowUnverified) {
            results.push({
                host,
                ok: true,
                skipped: true,
                changed: false,
                message: `Skipped on purpose. ${host.note}`,
            });
            continue;
        }
        let r;
        if (host.kind === 'claude-plugin') r = installClaudePlugin(host, { pluginSourceDir, platform });
        else if (host.kind === 'antigravity') r = installAntigravity(host, { pluginSourceDir, platform });
        else if (host.kind === 'vscode-family') r = installVscodeFamily(host, { vsixPath, platform });
        else r = { ok: false, message: `No installer for host kind "${host.kind}".` };
        results.push({ host, skipped: false, changed: false, ...r });
    }
    return { results };
}

module.exports = {
    installInto,
    installClaudePlugin,
    installAntigravity,
    installVscodeFamily,
    buildRosterRule,
    linkOrCopy,
};
