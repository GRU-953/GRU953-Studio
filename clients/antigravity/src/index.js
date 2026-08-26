#!/usr/bin/env node

// 2026-08-10 rewrite. This used to create `.agents/skills/studio` and a
// `Dev-Memory/` folder, then print "initialized successfully". Two things were
// wrong with that, both confirmed against antigravity.google/docs/plugins on
// 2026-08-10:
//
//  1. `.agents/skills/` is not a location Antigravity scans, and there was no
//     `plugin.json` anywhere, so nothing there was ever recognised as a plugin.
//     The real locations are `.agents/plugins/<name>/` (per workspace) and
//     `~/.gemini/config/plugins/<name>/` (global), each containing a
//     `plugin.json`. See install.js for the full layout.
//  2. Only ONE skill of the whole set was linked, so every other protocol the
//     studio depends on — memory, the quality gate, YAGNI, the language packs —
//     was simply absent while the script reported success.
//
// It also created `Dev-Memory/` eagerly in whatever directory it was run from.
// That is dropped: Dev-Memory belongs to a PROJECT and is created by the studio
// when a project actually starts, and making an empty one in an arbitrary
// working directory (a home folder, say) leaves confusing litter behind.

const path = require('path');
const { installForAntigravity } = require('./install');

const args = process.argv.slice(2);
const scope = args.includes('--workspace') ? 'workspace' : 'global';

console.log('Setting up GRU953-Studio for Google Antigravity...');

const result = installForAntigravity({
    pluginSourceDir: path.join(__dirname, '..', '..', '..', 'plugins', 'gru953-studio'),
    scope,
});

for (const step of result.steps) console.log(`  ${step}`);

if (result.ok) {
    console.log('');
    console.log(`GRU953-Studio is installed for Antigravity at:\n  ${result.target}`);
    console.log('');
    console.log('Restart Antigravity, then ask it to build something and it will follow the');
    console.log('studio protocol. Two things to know, so nothing comes as a surprise:');
    console.log('  * The roster is provided as a rules file Antigravity follows itself.');
    console.log('    In Claude Code the specialists run as genuinely separate agents, which');
    console.log('    works better. (Antigravity does support separate subagents too, since');
    console.log('    CLI v1.1.6 - installing the 38 that way is simply not built yet: see');
    console.log('    finding X43, 2026-08-22.)');
    console.log('  * The /studio slash commands are a Claude Code feature. Here, just ask in');
    console.log('    plain words — "carry on with my project", "where are we up to".');
    if (scope === 'global') {
        console.log('');
        console.log('Run this again with --workspace to install it for one project only instead.');
    }
} else {
    console.error('');
    console.error('GRU953-Studio was NOT fully set up for Antigravity:');
    for (const err of result.errors) console.error(`  - ${err}`);
    console.error('');
    console.error(`Check that ${result.target} is writable, then run this again.`);
    process.exitCode = 1;
}
