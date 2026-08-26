// deps.js — checks the free tools GRU953-Studio relies on, and when one is
// missing, gives the exact numbered steps to get it.
//
// It never installs system software. Installing Node.js, git or the GitHub CLI
// changes the user's machine well beyond this project's remit, and doing it
// unasked is not something this project does anywhere else either (see the
// former ollama-integration skill's confirm-before-install rule (removed in v7.0.0), which applied the same
// principle to a much smaller download).
//
// The instructions are written to the operating charter's "WHEN YOU NEED ME TO
// DO SOMETHING" clause: one action per step, saying exactly what to open and
// what to type.

const { spawnSync } = require('child_process');

const MIN_NODE_MAJOR = 22;

function runVersion(command, args = ['--version']) {
    try {
        const r = spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32' });
        if (r.status !== 0) return null;
        return String(r.stdout || r.stderr).trim();
    } catch {
        return null;
    }
}

function nodeGuidance(platform) {
    const download =
        platform === 'darwin'
            ? 'the macOS installer (.pkg)'
            : platform === 'win32'
              ? 'the Windows installer (.msi)'
              : 'the Linux package for your distribution';
    return [
        'Open https://nodejs.org in your web browser.',
        `Download the version marked "LTS" — ${download}.`,
        'Open the downloaded file and follow its instructions.',
        'Close your terminal window completely, then open a new one.',
        'Type: gru953-studio doctor',
    ];
}

function ghGuidance(platform) {
    const install =
        platform === 'darwin'
            ? 'On a Mac, if you have Homebrew you can instead type: brew install gh'
            : platform === 'win32'
              ? 'On Windows, if you have winget you can instead type: winget install GitHub.cli'
              : 'On Linux, your distribution may package it as "gh" — your package manager can install it.';
    return [
        'Open https://cli.github.com in your web browser.',
        'Download and install it for your computer.',
        install,
        'Close your terminal window completely, then open a new one.',
        'Type: gh auth login  — and follow the questions it asks.',
    ];
}

/**
 * @returns {{ok: boolean, checks: Array<{name, required, present, version, problem, steps}>}}
 *   `required` separates a genuine blocker from something only needed later:
 *   Node is required for anything to work at all, but the GitHub CLI is needed
 *   only when publishing, so its absence must not be reported as a failure to a
 *   user who has not got that far yet.
 */
function checkDependencies({ platform = process.platform } = {}) {
    const checks = [];

    const nodeVersion = process.version.replace(/^v/, '');
    const nodeMajor = parseInt(nodeVersion.split('.')[0], 10);
    const nodeOk = Number.isFinite(nodeMajor) && nodeMajor >= MIN_NODE_MAJOR;
    checks.push({
        name: 'Node.js',
        required: true,
        present: nodeOk,
        version: nodeVersion,
        problem: nodeOk
            ? null
            : `Node.js ${nodeVersion} is too old — GRU953-Studio needs ${MIN_NODE_MAJOR} or newer.`,
        steps: nodeOk ? [] : nodeGuidance(platform),
        why: 'Runs the safety checks that stop passwords or half-finished work being published.',
    });

    const gitVersion = runVersion('git');
    checks.push({
        name: 'git',
        required: true,
        present: !!gitVersion,
        version: gitVersion,
        problem: gitVersion ? null : 'git is not installed.',
        steps: gitVersion
            ? []
            : [
                  'Open https://git-scm.com/downloads in your web browser.',
                  'Download and install the version for your computer.',
                  'Close your terminal window completely, then open a new one.',
                  'Type: gru953-studio doctor',
              ],
        why: 'Keeps a history of your project so nothing is ever lost.',
    });

    const ghVersion = runVersion('gh');
    checks.push({
        name: 'GitHub CLI',
        required: false,
        present: !!ghVersion,
        version: ghVersion ? ghVersion.split('\n')[0] : null,
        problem: ghVersion ? null : 'The GitHub CLI is not installed. You only need it when you publish.',
        steps: ghVersion ? [] : ghGuidance(platform),
        why: 'Publishes your finished app to your own GitHub account. Not needed until then.',
    });

    // Signed in, not merely installed: `gh` present but unauthenticated is the
    // state that fails at the worst moment — the publish step — so it is
    // reported now rather than discovered later.
    if (ghVersion) {
        const authed = runVersion('gh', ['auth', 'status']) !== null;
        checks.push({
            name: 'GitHub sign-in',
            required: false,
            present: authed,
            version: null,
            problem: authed ? null : 'The GitHub CLI is installed but not signed in.',
            steps: authed ? [] : ['Type: gh auth login', 'Answer the questions it asks (the defaults are fine).'],
            why: 'Lets the studio publish to your account when you ask it to.',
        });
    }

    return { ok: checks.every((c) => c.present || !c.required), checks };
}

module.exports = { checkDependencies, MIN_NODE_MAJOR };
