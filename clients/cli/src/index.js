#!/usr/bin/env node

// 2026-07-26 audit finding 17. `start`/`pause`/`resume` were removed rather
// than fixed: pausing and resuming a project's build is something the AI
// team does to Dev-Memory (recording state, deciding what to pick back up),
// which a standalone CLI has no honest way to perform — these three only
// ever printed a message and did nothing real. `status` stays, and now
// actually reports on the project's real Dev-Memory files (see status.js)
// instead of printing "Checking status..." and stopping there.

const { printStatus } = require('./status');

console.log('Universal Agentic Studio CLI initializing...');

const command = process.argv[2] || 'help';

switch (command) {
    case 'status':
        printStatus();
        break;
    case 'init':
        console.log('Initializing universal platform support...');
        const { initializeUniversalRules } = require('./universal-init');
        initializeUniversalRules();
        break;
    case 'help':
    default:
        console.log('Usage: gru953-studio [status|init|help]');
        break;
}
