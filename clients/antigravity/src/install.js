// install.js — installs GRU953-Studio into Google Antigravity, in the layout
// Antigravity's own documentation describes.
//
// 2026-08-10 rewrite. The previous version wrote to `.agents/skills/` and linked
// exactly ONE skill (`studio`) out of the whole set, then printed
// "initialized successfully". Checked against antigravity.google/docs/plugins on
// 2026-08-10, that is not a shape Antigravity recognises as a plugin at all:
//
//   * A plugin is a DIRECTORY containing `plugin.json` (the required marker
//     file), with optional `skills/`, `rules/`, `mcp_config.json` and
//     `hooks.json` inside it.
//   * Antigravity scans two locations for those directories:
//       - workspace: `.agents/plugins/` or `_agents/plugins/`
//       - global:    `~/.gemini/config/plugins/`
//     Note `.agents/PLUGINS/`, not `.agents/skills/` — the old target was one
//     level and one concept off, with no plugin.json anywhere, so nothing
//     identified it as a plugin.
//   * There is NO `agents/` or `commands/` component. The 38 specialists
//     therefore cannot be installed here as separate subagents; they are
//     projected into a generated `rules/` file (see buildRosterRule) that tells
//     Antigravity to adopt each role itself. Shipping an `agents/` directory
//     Antigravity silently ignores would be the same class of dead reference a
//     2026-07-26 fix had to remove from the Aider config.
//
// Linking is still preferred over copying where the filesystem allows it, so a
// `git pull` in the checkout updates the installed plugin too — reusing
// link-or-copy.js, including its Windows-junction handling, unchanged.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { linkOrCopy } = require('./link-or-copy');

const PLUGIN_DIR_NAME = 'gru953-studio';

/** Where Antigravity looks for plugins. Global unless a workspace is asked for. */
function pluginTargetDir({ scope = 'global', workspaceDir = process.cwd(), homeDir = os.homedir() } = {}) {
    if (scope === 'workspace') {
        return path.join(workspaceDir, '.agents', 'plugins', PLUGIN_DIR_NAME);
    }
    return path.join(homeDir, '.gemini', 'config', 'plugins', PLUGIN_DIR_NAME);
}

/**
 * One line per specialist, generated from the real agents/ directory.
 *
 * Deliberately derived rather than hand-written: a hand-maintained copy of the
 * roster here would be one more place for it to go stale, which is the exact
 * problem ROSTER.md and roster-check.mjs exist to prevent.
 */
function buildRosterRule(pluginSourceDir) {
    const agentsDir = path.join(pluginSourceDir, 'agents');
    let files;
    try {
        files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort();
    } catch {
        // An unreadable agents/ directory means the caller pointed at something
        // that is not the plugin. Reported by installForAntigravity as an error;
        // never silently treated as "a roster with zero roles".
        return null;
    }
    const rows = files.map((f) => {
        const name = f.replace(/\.md$/, '');
        let summary = '';
        try {
            const text = fs.readFileSync(path.join(agentsDir, f), 'utf8');
            const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (fm) {
                const d = fm[1].match(/^description:\s*(.*)$/m);
                if (d) {
                    summary = d[1].trim().replace(/^["'>|-]+\s*/, '').replace(/["']\s*$/, '');
                    if (summary.length > 240) summary = summary.slice(0, 237) + '...';
                    summary = summary.replace(/\|/g, '\\|');
                }
            }
        } catch {
            /* a role with an unreadable file still gets a row, just without a summary */
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
 * @returns {{ok: boolean, target: string, steps: string[], errors: string[]}}
 *   Reports what actually happened rather than assuming success — the defect the
 *   2026-07-26 audit found here was a "successfully initialized" message printed
 *   over an empty directory.
 */
function installForAntigravity(options = {}) {
    const { pluginSourceDir, scope = 'global', workspaceDir = process.cwd(), homeDir = os.homedir() } = options;
    const steps = [];
    const errors = [];
    const target = pluginTargetDir({ scope, workspaceDir, homeDir });

    if (!pluginSourceDir || !fs.existsSync(path.join(pluginSourceDir, 'skills'))) {
        errors.push(
            `Could not find GRU953-Studio's skills at ${pluginSourceDir ? path.join(pluginSourceDir, 'skills') : '(no source directory given)'} — is this running from inside the GRU953-Studio checkout?`,
        );
        return { ok: false, target, steps, errors };
    }

    try {
        fs.mkdirSync(target, { recursive: true });
    } catch (e) {
        errors.push(`Could not create ${target}: ${e.message}`);
        return { ok: false, target, steps, errors };
    }

    // 1. plugin.json — the required marker. Without it the directory is not a
    //    plugin, whatever else it contains.
    let version = '0.0.0';
    try {
        version = JSON.parse(
            fs.readFileSync(path.join(pluginSourceDir, '.claude-plugin', 'plugin.json'), 'utf8'),
        ).version || version;
    } catch {
        /* version is cosmetic here; a missing one must not stop the install */
    }
    // 2026-08-22, X253: these three writes are unconditional, and the message said only
    // "wrote …" whether the file was new or replaced — while `skills/` beside them printed
    // "already present … left as they are". So one run could tell the user its skills had been
    // left alone in the same breath as silently replacing a rules file they had edited. The
    // writes are UNCHANGED: nothing that is written today stops being written, because these
    // three are generated projections of the plugin and a stale copy is worse than a replaced
    // one. What changes is that a replacement now says it is a replacement.
    try {
        const pluginJsonPath = path.join(target, 'plugin.json');
        const replacing = fs.existsSync(pluginJsonPath);
        fs.writeFileSync(
            pluginJsonPath,
            JSON.stringify({ name: PLUGIN_DIR_NAME, version }, null, 2) + '\n',
            'utf8',
        );
        steps.push(replacing ? 'replaced plugin.json' : 'wrote plugin.json');
    } catch (e) {
        errors.push(`Could not write plugin.json: ${e.message}`);
    }

    // 2. skills/ — ALL of them, not just `studio`. The old version linked one,
    //    which left every other protocol (memory, quality gate, YAGNI, the
    //    language packs) unavailable while reporting success.
    const skillsTarget = path.join(target, 'skills');
    if (!fs.existsSync(skillsTarget)) {
        const r = linkOrCopy(path.join(pluginSourceDir, 'skills'), skillsTarget);
        if (r.ok) steps.push(`skills available at ${skillsTarget} (${r.method})`);
        else errors.push(`Could not make the skills available at ${skillsTarget}: ${r.error.message}`);
    } else {
        steps.push(`skills already present at ${skillsTarget} — left as they are`);
    }

    // 3. rules/ — the charter, and the roster projection.
    const rulesTarget = path.join(target, 'rules');
    try {
        fs.mkdirSync(rulesTarget, { recursive: true });
        const roster = buildRosterRule(pluginSourceDir);
        if (roster) {
            const rosterPath = path.join(rulesTarget, 'gru953-roster.md');
            const replacingRoster = fs.existsSync(rosterPath);
            fs.writeFileSync(rosterPath, roster, 'utf8');
            steps.push(
                replacingRoster ? 'replaced rules/gru953-roster.md' : 'wrote rules/gru953-roster.md',
            );
        } else {
            errors.push("Could not read the specialist roster from the plugin's agents/ directory.");
        }
        const charterSource = path.join(pluginSourceDir, 'skills', 'operating-charter', 'SKILL.md');
        if (fs.existsSync(charterSource)) {
            const charterPath = path.join(rulesTarget, 'gru953-operating-charter.md');
            const replacingCharter = fs.existsSync(charterPath);
            fs.copyFileSync(charterSource, charterPath);
            steps.push(
                replacingCharter
                    ? 'replaced rules/gru953-operating-charter.md'
                    : 'wrote rules/gru953-operating-charter.md',
            );
        } else {
            errors.push(`Could not find the operating charter at ${charterSource}.`);
        }
    } catch (e) {
        errors.push(`Could not write the rules directory: ${e.message}`);
    }

    return { ok: errors.length === 0, target, steps, errors };
}

module.exports = { installForAntigravity, pluginTargetDir, buildRosterRule, PLUGIN_DIR_NAME };
