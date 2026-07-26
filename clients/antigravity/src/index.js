#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { linkOrCopy } = require('./link-or-copy');

console.log('Initializing Universal Agentic Studio for Google Antigravity...');

const workspaceDir = process.cwd();
const agentsDir = path.join(workspaceDir, '.agents');
const pluginSourceDir = path.join(__dirname, '..', '..', '..', 'plugins', 'gru953-studio');

if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
    console.log('Created .agents directory.');
}

const targetSkillsDir = path.join(agentsDir, 'skills');
if (!fs.existsSync(targetSkillsDir)) {
    fs.mkdirSync(targetSkillsDir, { recursive: true });
}

// 2026-07-26 audit finding 18. This used to be a bare `fs.symlinkSync` in a
// try/catch that logged the error and carried on regardless — silently
// failing on Windows every time (see link-or-copy.js for the real fix) and
// still printing "initialized successfully!" at the end, with
// `.agents/skills` left completely empty — a false success. Success is now
// reported only when the content is actually there.
let skillsReady = true;
try {
    const sourceSkillsDir = path.join(pluginSourceDir, 'skills');
    if (fs.existsSync(sourceSkillsDir)) {
        const studioSkillLink = path.join(targetSkillsDir, 'studio');
        if (!fs.existsSync(studioSkillLink)) {
            const result = linkOrCopy(path.join(sourceSkillsDir, 'studio'), studioSkillLink);
            if (result.ok) {
                console.log(`Studio skill available at .agents/skills/studio (${result.method}).`);
            } else {
                skillsReady = false;
                console.error(`Could not make the studio skill available at .agents/skills/studio: ${result.error.message}`);
                console.error('Check that .agents/skills is writable, then run this again.');
            }
        }
    } else {
        skillsReady = false;
        console.error(`Could not find the studio skill source at ${sourceSkillsDir} — is this running from inside the GRU953-Studio plugin?`);
    }
} catch (e) {
    skillsReady = false;
    console.error('Failed to set up skills:', e.message);
}

const devMemoryDir = path.join(workspaceDir, 'Dev-Memory');
if (!fs.existsSync(devMemoryDir)) {
    fs.mkdirSync(devMemoryDir, { recursive: true });
    console.log('Created Dev-Memory directory.');
}

if (skillsReady) {
    console.log('Universal Agentic Studio for Google Antigravity initialized successfully!');
    console.log('You can now run agents with Google Antigravity that utilize the studio protocol.');
} else {
    console.error('Universal Agentic Studio for Google Antigravity did NOT initialize successfully — see the errors above.');
    process.exitCode = 1;
}
