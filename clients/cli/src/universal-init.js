const fs = require('fs');
const path = require('path');

// 2026-07-29 maintenance fix (audit finding 1): `@gru953/studio-cli` has
// never been published to npm (confirmed 404 from the registry) and there is
// no publish step anywhere in .github/workflows/, so `npx @gru953/studio-cli`
// — written into every user's .cursorrules/.windsurfrules/.clinerules/
// .roomodes/.github/copilot-instructions.md by this file — could never have
// worked. Replaced with a direct `node` invocation and a placeholder for the
// checkout path (deliberately NOT a real, computed __dirname-based path: this
// template's exact text is also the committed reference copy every AI-host
// rule file at the repo root is checked against byte-for-byte — see
// repo-integrity.mjs's INV15 — so it must stay identical across every
// checkout, not resolve to a different absolute path on each one).
const UNIVERSAL_PROMPT = `
# GRU953-Studio Universal Context
You are operating within a GRU953-Studio managed project.
You MUST follow the studio protocol at all times.

## Core Rules:
1. **Engage the Studio**: If the user asks you to build, design, or audit an application, you MUST assume the \`project-lead\` persona and follow the \`studio\` skill guidelines.
2. **Dev-Memory**: Always refer to the \`Dev-Memory\` folder for project context (e.g., PROGRESS.md, PLAN.md, REQUIREMENTS.md).
3. **Command Center**: Use the \`/studio\` commands for task management if supported by your platform, or execute the CLI directly (there is no published \`npx\`-installable package) via \`node <path-to-your-GRU953-Studio-checkout>/clients/cli/src/index.js\`.
4. **Universal Compatibility**: GRU953-Studio is designed to be compatible across Claude Code, Google Antigravity, Cursor, Windsurf, Cline, Roo Code, Aider, and GitHub Copilot Workspace.
`;

// 2026-07-26 audit finding 11 (dropped from stage 4's list by oversight;
// swept up in stage 5 — see AUDIT-2026-07.md §9's stage-4 verification row,
// which already promised this exact property). Aider has its own built-in
// model metadata; GRU953-Studio never creates a .aider.model.metadata.json,
// so telling Aider to look for one it will never find is a reference to a
// file that doesn't exist for no benefit — dropped rather than fixed by
// also generating that file, which YAGNI doesn't justify here.
const AIDER_CONFIG = `
read:
  - Dev-Memory/PROGRESS.md
  - Dev-Memory/PLAN.md
  - Dev-Memory/REQUIREMENTS.md
`;

// 2026-07-26 audit finding 11. Every target file used one shared marker
// string, "GRU953-Studio Universal Context" — but AIDER_CONFIG never
// contained that phrase at all, so the "already configured" check below was
// always false for .aider.conf.yml specifically, and three runs produced
// three duplicate copies of the same block in the user's own config file.
// Reproduced directly: running initializeUniversalRules() three times in a
// row against the same project left .aider.conf.yml with three copies.
// Fixed by wrapping every target's content in its own explicit begin/end
// markers (comment syntax matched to each file's own format — YAML uses
// `#`, everything else here is free-form prose/markdown where an HTML-style
// comment is inert) and REPLACING the marked region on every re-run instead
// of appending a fresh copy — so three runs leave exactly one copy, and any
// of the user's own content outside the markers is left untouched.
function markers(commentStyle) {
    if (commentStyle === 'yaml') {
        return { begin: '# GRU953-STUDIO:BEGIN', end: '# GRU953-STUDIO:END' };
    }
    return { begin: '<!-- GRU953-STUDIO:BEGIN -->', end: '<!-- GRU953-STUDIO:END -->' };
}

function writeManagedBlock(fullPath, content, commentStyle) {
    const { begin, end } = markers(commentStyle);
    const block = `${begin}\n${content.trim()}\n${end}`;
    if (!fs.existsSync(fullPath)) {
        fs.writeFileSync(fullPath, block + '\n', 'utf8');
        return 'CREATED';
    }
    const existing = fs.readFileSync(fullPath, 'utf8');
    const regionRe = new RegExp(
        `${begin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    );
    if (regionRe.test(existing)) {
        const replaced = existing.replace(regionRe, block);
        if (replaced === existing) return 'SKIPPED';
        fs.writeFileSync(fullPath, replaced, 'utf8');
        return 'REPLACED';
    }
    fs.appendFileSync(fullPath, '\n' + block + '\n', 'utf8');
    return 'APPENDED';
}

function initializeUniversalRules(projectRoot = process.cwd()) {
    console.log('Initializing Universal Agentic Studio rules for all platforms...');

    const targets = [
        { file: '.cursorrules', content: UNIVERSAL_PROMPT, commentStyle: 'html' },
        { file: '.windsurfrules', content: UNIVERSAL_PROMPT, commentStyle: 'html' },
        { file: '.clinerules', content: UNIVERSAL_PROMPT, commentStyle: 'html' },
        { file: '.roomodes', content: UNIVERSAL_PROMPT, commentStyle: 'html' },
        { file: '.aider.conf.yml', content: AIDER_CONFIG, commentStyle: 'yaml' },
        { file: '.github/copilot-instructions.md', content: UNIVERSAL_PROMPT, commentStyle: 'html' },
        { file: '.agents/AGENTS.md', content: UNIVERSAL_PROMPT, commentStyle: 'html' }
    ];

    for (const target of targets) {
        const fullPath = path.join(projectRoot, target.file);

        // Ensure directory exists (e.g., .github, .agents)
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const result = writeManagedBlock(fullPath, target.content, target.commentStyle);
        console.log(`[${result}] ${target.file}`);
    }

    console.log('Universal Agentic Studio initialization complete.');
}

module.exports = {
    initializeUniversalRules,
    writeManagedBlock,
};
