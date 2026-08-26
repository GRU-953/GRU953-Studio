// install-targets.js — puts GRU953-Studio into each host found on this machine.
//
// A note on where the Antigravity layout lives, recorded plainly because it is a
// deliberate duplication rather than an oversight:
//
// (Until v7.0.0 clients/antigravity/src/install.js contained the same layout logic. The two were
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
 * the former clients/antigravity/src/link-or-copy.js (removed in v7.0.0).
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
 * the former clients/antigravity/src/install.js by a test, until v7.0.0 removed it.
 */

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
(verified against Antigravity's plugin documentation, 2026-08-10; that host is no longer
supported as of v7.0.0), so these
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
        else r = { ok: false, message: `No installer for host kind "${host.kind}".` };
        results.push({ host, skipped: false, changed: false, ...r });
    }
    return { results };
}

module.exports = {
    installInto,
    installClaudePlugin,
    buildRosterRule,
    linkOrCopy,
};
