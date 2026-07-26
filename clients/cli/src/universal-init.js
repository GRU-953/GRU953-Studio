const fs = require('fs');
const path = require('path');

const UNIVERSAL_PROMPT = `
# GRU953-Studio Universal Context
You are operating within a GRU953-Studio managed project.
You MUST follow the studio protocol at all times.

## Core Rules:
1. **Engage the Studio**: If the user asks you to build, design, or audit an application, you MUST assume the \`project-lead\` persona and follow the \`studio\` skill guidelines.
2. **Dev-Memory**: Always refer to the \`Dev-Memory\` folder for project context (e.g., PROGRESS.md, PLAN.md, REQUIREMENTS.md).
3. **Command Center**: Use the \`/studio\` commands for task management if supported by your platform, or execute the CLI via \`npx @gru953/studio-cli\`.
4. **Universal Compatibility**: GRU953-Studio is designed to be compatible across Claude Code, Google Antigravity, Cursor, Windsurf, Cline, Roo Code, Aider, and GitHub Copilot Workspace.
`;

const AIDER_CONFIG = `
model-metadata-file: .aider.model.metadata.json
read:
  - Dev-Memory/PROGRESS.md
  - Dev-Memory/PLAN.md
  - Dev-Memory/REQUIREMENTS.md
`;

function initializeUniversalRules(projectRoot = process.cwd()) {
    console.log('Initializing Universal Agentic Studio rules for all platforms...');

    const targets = [
        { file: '.cursorrules', content: UNIVERSAL_PROMPT },
        { file: '.windsurfrules', content: UNIVERSAL_PROMPT },
        { file: '.clinerules', content: UNIVERSAL_PROMPT },
        { file: '.roomodes', content: UNIVERSAL_PROMPT },
        { file: '.aider.conf.yml', content: AIDER_CONFIG },
        { file: '.github/copilot-instructions.md', content: UNIVERSAL_PROMPT },
        { file: '.agents/AGENTS.md', content: UNIVERSAL_PROMPT }
    ];

    for (const target of targets) {
        const fullPath = path.join(projectRoot, target.file);
        
        // Ensure directory exists (e.g., .github, .agents)
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (!fs.existsSync(fullPath)) {
            fs.writeFileSync(fullPath, target.content.trim() + '\n', 'utf8');
            console.log(`[CREATED] ${target.file}`);
        } else {
            // Only append if not already present
            const existing = fs.readFileSync(fullPath, 'utf8');
            if (!existing.includes('GRU953-Studio Universal Context')) {
                fs.appendFileSync(fullPath, '\n' + target.content.trim() + '\n', 'utf8');
                console.log(`[APPENDED] ${target.file}`);
            } else {
                console.log(`[SKIPPED] ${target.file} (Already configured)`);
            }
        }
    }
    
    console.log('Universal Agentic Studio initialization complete.');
}

module.exports = {
    initializeUniversalRules
};
