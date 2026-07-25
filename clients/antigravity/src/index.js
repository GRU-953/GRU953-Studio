#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

// Copy skills if needed or symlink.
try {
    const sourceSkillsDir = path.join(pluginSourceDir, 'skills');
    if (fs.existsSync(sourceSkillsDir)) {
        // Just symlink for now to keep it lightweight and auto-updating
        const studioSkillLink = path.join(targetSkillsDir, 'studio');
        if (!fs.existsSync(studioSkillLink)) {
            fs.symlinkSync(path.join(sourceSkillsDir, 'studio'), studioSkillLink);
            console.log('Symlinked core studio skill to .agents/skills/studio');
        }
    }
} catch (e) {
    console.error('Failed to link skills:', e);
}

const devMemoryDir = path.join(workspaceDir, 'Dev-Memory');
if (!fs.existsSync(devMemoryDir)) {
    fs.mkdirSync(devMemoryDir, { recursive: true });
    console.log('Created Dev-Memory directory.');
}

console.log('Universal Agentic Studio for Google Antigravity initialized successfully!');
console.log('You can now run agents with Google Antigravity that utilize the studio protocol.');
