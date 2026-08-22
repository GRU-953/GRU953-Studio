#!/usr/bin/env node

// The GRU953-Studio command.
//
// 2026-07-26 audit finding 17 (still true, and the reason `start`/`pause`/
// `resume` are absent): pausing and resuming a project's build is something the
// AI team does to Dev-Memory — recording state, deciding what to pick back up —
// which a standalone CLI has no honest way to perform. Those three only ever
// printed a message and did nothing real, so they were removed rather than
// faked. Use /studio-pause and /studio-resume inside Claude Code instead.
//
// 2026-08-10: this became the universal installer the owner asked for — one
// command that finds every supported AI coding tool on the machine and sets
// GRU953-Studio up in each, on macOS, Windows and Linux. Each concern lives in
// its own small module so all three platforms can be tested from any one of them
// (see detect.js's note on why the environment is an argument).

const fs = require('fs');
const path = require('path');

const { printStatus } = require('./status');
const { detectHosts } = require('./detect');
const { checkDependencies } = require('./deps');
const { installInto } = require('./install-targets');
const pathSetup = require('./path-setup');
const autoupdate = require('./autoupdate');

/**
 * The plugin directory to install FROM — the studio itself, not this command.
 *
 * Two places it can legitimately be, checked in this order:
 *
 *   1. `../plugin`, inside this package. That is where scripts/bundle-plugin.mjs
 *      copies it at pack time so the published package carries the studio. Checked
 *      FIRST because a published install is the common case for real users.
 *   2. `../../../plugins/gru953-studio`, i.e. the repository checkout this file
 *      lives in during development.
 *
 * Returns null when neither exists, and every caller then says so plainly rather
 * than installing an empty directory — the same trap a previous version of the
 * Antigravity bridge fell into, reporting success over an empty folder.
 *
 * 2026-08-11: the bundled location is new. Before it, an npm or Homebrew install
 * had no studio to install at all, so `install` and `models` could not do their
 * jobs — while the README, the Homebrew caveats and the wiki all said they could.
 * Found by running the real Homebrew-installed command instead of the checkout;
 * every test passed beforehand because every test ran from a checkout, where the
 * plugin is always a few directories up.
 */
function findPluginSource() {
    const candidates = [
        path.join(__dirname, '..', 'plugin'),
        path.join(__dirname, '..', '..', '..', 'plugins', 'gru953-studio'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(path.join(c, '.claude-plugin', 'plugin.json'))) return c;
    }
    return null;
}

/** A downloaded .vsix sitting next to the checkout's dist/, if one was built. */
// 2026-08-22, X261: this took the LAST entry of a plain alphabetical sort, which is not the newest
// version — "gru953-studio-10.0.0.vsix" sorts before "gru953-studio-9.0.0.vsix", so the first time a
// major version reaches double digits the installer would silently pick the older file. It is
// installed with `--force`, so nothing downstream would object. Sorted by parsed version now, with
// the alphabetical order kept only as the tie-break for names that carry no version at all.
function findVsix() {
    const distDir = path.join(__dirname, '..', '..', '..', 'dist');
    const versionKey = (name) => {
        const m = /(\d+)\.(\d+)\.(\d+)/.exec(name);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [-1, -1, -1];
    };
    try {
        const vsix = fs.readdirSync(distDir).filter((f) => f.endsWith('.vsix'));
        if (!vsix.length) return null;
        vsix.sort((a, b) => {
            const [aM, aN, aP] = versionKey(a);
            const [bM, bN, bP] = versionKey(b);
            return aM - bM || aN - bN || aP - bP || a.localeCompare(b);
        });
        return path.join(distDir, vsix[vsix.length - 1]);
    } catch {
        return null;
    }
}

function heading(text) {
    console.log('');
    console.log(text);
    console.log('-'.repeat(text.length));
}

function cmdDoctor() {
    heading('Is everything GRU953-Studio needs in place?');
    const { ok, checks } = checkDependencies();
    for (const c of checks) {
        const mark = c.present ? 'yes' : c.required ? 'NO ' : 'not yet';
        console.log(`  ${mark.padEnd(7)} ${c.name}${c.version ? ` (${c.version})` : ''}`);
        console.log(`          ${c.why}`);
        if (!c.present) {
            console.log(`          ${c.problem}`);
            c.steps.forEach((s, i) => console.log(`            ${i + 1}. ${s}`));
        }
    }

    heading('Which AI coding tools are on this computer?');
    const { found, missing } = detectHosts();
    if (found.length === 0) {
        console.log('  None found. That is unusual — GRU953-Studio needs at least one of these:');
        for (const m of missing) console.log(`    - ${m.name}`);
    } else {
        for (const f of found) console.log(`  found     ${f.name}  (recognised by ${f.detectedBy})`);
        for (const m of missing) console.log(`  not here  ${m.name}`);
    }

    heading('Daily update check');
    console.log(`  ${autoupdate.status().message}`);

    console.log('');
    if (ok) {
        console.log('Everything essential is in place. Run "gru953-studio install" to set the studio up.');
    } else {
        console.log('Something essential is missing — follow the numbered steps above, then run this again.');
        process.exitCode = 1;
    }
}

function cmdInstall(argv) {
    const allowUnverified = argv.includes('--include-unverified');
    const pluginSourceDir = findPluginSource();

    heading('Checking what GRU953-Studio needs');
    const { ok, checks } = checkDependencies();
    for (const c of checks.filter((x) => !x.present)) {
        console.log(`  ${c.required ? 'MISSING' : 'not yet'}  ${c.name} — ${c.problem}`);
        c.steps.forEach((s, i) => console.log(`      ${i + 1}. ${s}`));
    }
    if (!ok) {
        console.log('');
        console.log('Stopping here: something essential is missing. Nothing has been changed.');
        console.log('Follow the numbered steps above, then run "gru953-studio install" again.');
        process.exitCode = 1;
        return;
    }
    console.log('  All good.');

    heading('Looking for AI coding tools on this computer');
    const { found, missing } = detectHosts();
    for (const f of found) console.log(`  found     ${f.name}  (recognised by ${f.detectedBy})`);
    for (const m of missing) console.log(`  not here  ${m.name}`);
    if (found.length === 0) {
        console.log('');
        console.log('No supported tool was found, so there is nothing to install into yet.');
        console.log('Install Claude Code from https://claude.com/claude-code and run this again.');
        return;
    }

    if (!pluginSourceDir) {
        // 2026-08-11: this used to say "installed from npm, which does not include
        // the studio itself" and stop there — true at the time, and the defect
        // 6.0.2 fixed by bundling the studio into the published package. Reaching
        // this branch now means something genuinely unexpected, so it says so
        // rather than blaming a normal install.
        heading('Something is wrong with this installation');
        console.log('  The GRU953-Studio command is here, but the studio itself (the skills and');
        console.log('  specialist roles) is not, and it should be. This is not a normal state.');
        console.log('');
        console.log('  The most likely cause is a part-finished install. Try reinstalling:');
        console.log('      npm install -g @gru953/studio-cli@latest');
        console.log('  or, if you used Homebrew:');
        console.log('      brew reinstall gru953-studio');
        console.log('');
        console.log('  You can also install the studio directly in Claude Code, which needs');
        console.log('  nothing from this command:');
        console.log('      /plugin marketplace add GRU-953/GRU953-Studio');
        console.log('      /plugin install gru953-studio@gru953-studio');
        console.log('');
        console.log('  If reinstalling does not fix it, please report it at');
        console.log('      https://github.com/GRU-953/GRU953-Studio/issues');
        process.exitCode = 1;
        return;
    }

    heading('Setting GRU953-Studio up');
    const { results } = installInto(found, {
        pluginSourceDir,
        vsixPath: findVsix(),
        allowUnverified,
    });
    let failures = 0;
    for (const r of results) {
        const label = r.skipped ? 'skipped' : r.ok ? 'done' : 'FAILED';
        console.log(`  ${label.padEnd(8)} ${r.host.name}`);
        console.log(`           ${r.message}`);
        if (!r.ok) failures++;
    }
    const skipped = results.filter((r) => r.skipped);
    if (skipped.length && !allowUnverified) {
        console.log('');
        console.log('  Those skipped above were skipped deliberately, not by accident: their own');
        console.log('  makers document installing through the app rather than by copying files, so');
        console.log('  following their documented route is more reliable than guessing a folder.');
        console.log('  Run with --include-unverified to try anyway.');
    }

    heading('Making the command easy to run');
    const binDir = commandBinDir();
    if (!binDir) {
        console.log('  Could not work out where the command was installed, so nothing was changed.');
        console.log('  If typing "gru953-studio" in a new terminal works, there is nothing to do.');
        console.log('  If it does not, run "npm prefix -g" and add that folder\'s "bin" to your PATH.');
    } else {
        printPathAdvice(binDir);
    }

    console.log('');
    if (failures === 0) {
        console.log('Finished. In Claude Code, type /studio-start to begin.');
        // 2026-08-22, X247: this said "GRU953-Studio checks once a day, the first time you use
        // it." No code does that. X233 corrected the same falsehood in four places on 2026-08-18
        // and missed this one — which is the line printed at the END of `install`, so it was the
        // first thing a new user was told about updates. The same binary already says the opposite
        // 75 lines further down (`autoupdate` prints "nothing checks on its own"), so it
        // contradicted itself.
        console.log('Updates: nothing checks on its own. Run `gru953-studio update` when you want one.');
        console.log('For a scheduled daily check instead, run: gru953-studio autoupdate on');
    } else {
        console.log(`Finished, but ${failures} of the tools above did not install. See the messages for what to do.`);
        process.exitCode = 1;
    }
}

/**
 * The folder the `gru953-studio` command itself lives in — the thing that has to
 * be on the PATH.
 *
 * Deliberately NOT derived from process.argv[1]. An npm global install puts a
 * symlink (or a .cmd shim) in npm's bin folder pointing at this file inside the
 * package, and Node resolves argv[1] through that symlink — so argv[1] is the
 * package's own src/index.js, and its directory is emphatically not the folder
 * that needs to be on the PATH. Found by running the real install and reading
 * the advice it printed, which named the checkout's src/ directory.
 *
 * Order: if the command already resolves on the PATH there is nothing to do at
 * all, which is the common case. Otherwise ask npm where it puts global
 * binaries, since that is where it just installed the shim.
 */
function commandBinDir() {
    const { whichSync } = require('./detect');
    const resolved = whichSync('gru953-studio');
    if (resolved) return path.dirname(resolved);
    const { spawnSync } = require('child_process');
    const r = spawnSync('npm', ['prefix', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status !== 0) return null;
    const prefix = String(r.stdout || '').trim();
    if (!prefix) return null;
    // npm puts global binaries directly in the prefix on Windows, and in
    // <prefix>/bin everywhere else.
    return process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
}

function printPathAdvice(binDir) {
    const p = pathSetup.plan(binDir);
    if (!p.needed) {
        console.log(`  ${p.reason}`);
    } else if (p.manualInstruction && !p.file) {
        console.log(`  ${p.reason}`);
        console.log('  To fix it, run this once:');
        console.log(`      ${p.manualInstruction}`);
    } else {
        // Deliberately NOT written automatically. A shell profile is the one file
        // where a bad edit can stop a terminal opening properly, and the charter's
        // "never change anything I have specified without asking" applies to the
        // user's own machine settings most of all.
        console.log(`  ${p.reason}`);
        console.log(`  Add this one line to the end of ${p.file}:`);
        console.log(`      ${p.manualInstruction}`);
        console.log('  Then close and reopen your terminal. (Not done for you on purpose — that');
        console.log('  file belongs to you, and a mistake in it can stop your terminal working.)');
    }
}

function cmdAutoupdate(argv) {
    const sub = argv[0] || 'status';
    if (sub === 'on') {
        console.log('Setting up a daily update check using your operating system\'s own scheduler...');
        const r = autoupdate.enable();
        console.log(r.ok ? `  ${r.message}` : `  ${r.message}`);
        if (r.ok) {
            console.log('  Turn it off again at any time with: gru953-studio autoupdate off');
        } else {
            process.exitCode = 1;
        }
        return;
    }
    if (sub === 'off') {
        const r = autoupdate.disable();
        console.log(`  ${r.message}`);
        // 2026-08-22, X233: this promised a daily default check that NO code performs. Only two
        // call sites invoke auto-update.mjs and both pass --force (index.js cmdUpdate and
        // studio-update.md); it is not in hooks.json, and session-start.mjs stopped running it
        // (its own comment records that removal). The 24-hour .last-update-check window inside
        // auto-update.mjs is therefore unreachable.
        console.log('  Nothing will check on its own. Run `gru953-studio update` when you want one.');
        return;
    }
    console.log(`  ${autoupdate.status().message}`);
    console.log('  Change it with: gru953-studio autoupdate on   |   gru953-studio autoupdate off');
}

async function cmdModels(argv) {
    const pluginSourceDir = findPluginSource();
    if (!pluginSourceDir) {
        console.error('The studio itself is missing from this installation, which is not a normal state.');
        console.error('Try reinstalling: npm install -g @gru953/studio-cli@latest');
        console.error('(or "brew reinstall gru953-studio" if you used Homebrew).');
        console.error('Inside Claude Code, /studio-models does the same thing without this command.');
        process.exitCode = 1;
        return;
    }
    const modulePath = path.join(pluginSourceDir, 'hooks', 'openrouter-models.mjs');
    // Imported rather than reimplemented: the free-versus-paid decision is the
    // one place in this project where being wrong costs the user money, so it
    // exists exactly once, in the plugin, with its own tests.
    const { pathToFileURL } = require('url');
    const mod = await import(pathToFileURL(modulePath).href);
    process.exitCode = await mod.main(argv);
}

function cmdUpdate() {
    const pluginSourceDir = findPluginSource();
    if (!pluginSourceDir) {
        console.log('This copy was installed as a package rather than as a git checkout, so it');
        console.log('updates through whichever tool installed it:');
        console.log('    npm:      npm install -g @gru953/studio-cli@latest');
        console.log('    Homebrew: brew update && brew upgrade gru953-studio');
        console.log('In Claude Code, the studio updates itself — type /studio-update.');
        return;
    }
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [path.join(pluginSourceDir, 'hooks', 'auto-update.mjs'), '--force'], {
        stdio: 'inherit',
    });
    process.exitCode = r.status === null ? 1 : r.status;
}

// 2026-08-22, X251: read from clients/vscode/package.json where it can be, rather than hardcoded,
// because a printed command that goes stale is worse than no command — the user would run it, see it
// fail, and have no idea why. Falls back to the current literal if that file is not in the package,
// which is the normal case for an installed copy.
const VSCODE_EXTENSION_ID = (() => {
    const fallback = 'GRU953.gru953-studio';
    try {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(__dirname, '..', '..', 'vscode', 'package.json'), 'utf8'),
        );
        return pkg.publisher && pkg.name ? `${pkg.publisher}.${pkg.name}` : fallback;
    } catch {
        return fallback;
    }
})();

function cmdUninstall() {
    heading('Removing GRU953-Studio from this computer');
    const { found } = detectHosts();
    let removed = 0;
    let left = 0;
    for (const host of found) {
        // 2026-08-22, X251: this was a bare `continue`. The three VS Code-family hosts are built
        // with a configDir and NO installDir (detect.js:109-117), so every one of them was skipped
        // in complete silence — and then the closing line reported how many places it had removed
        // from, with no mention of the editor extension still sitting installed. `install` sets
        // those hosts up; `uninstall` cannot, because there is no directory of ours to delete: the
        // extension is managed by the editor. So the honest answer is to say so and give the command.
        //
        // The command is PRINTED, never run. Running `--uninstall-extension` would be a new
        // destructive action against the user's editor, and that needs their explicit say-so rather
        // than being folded into a fix for a missing message.
        if (!host.installDir) {
            if (host.kind === 'vscode-family') {
                console.log(`  left      ${host.name} — the extension is still installed.`);
                console.log(`            Remove it with: ${host.command} --uninstall-extension ${VSCODE_EXTENSION_ID}`);
                left++;
            }
            continue;
        }
        if (!fs.existsSync(host.installDir)) {
            console.log(`  nothing   ${host.name} — was not installed there.`);
            continue;
        }
        try {
            // rmSync removes a symlink itself rather than following it, so a
            // linked install never deletes the checkout it points at. Verified
            // behaviour, not assumed — this is the one destructive path here.
            fs.rmSync(host.installDir, { recursive: true, force: true });
            console.log(`  removed   ${host.name} (${host.installDir})`);
            removed++;
        } catch (e) {
            console.log(`  FAILED    ${host.name}: ${e.message}`);
        }
    }
    const au = autoupdate.status();
    if (au.enabled) console.log(`  ${autoupdate.disable().message}`);
    console.log('');
    console.log(`Removed from ${removed} place${removed === 1 ? '' : 's'}. Your projects and their files are untouched.`);
    if (left > 0) {
        console.log(
            `${left} editor extension${left === 1 ? '' : 's'} ${left === 1 ? 'is' : 'are'} still installed — see the "left" line${left === 1 ? '' : 's'} above. This command does not remove them for you.`,
        );
    }
    console.log('Any line added to your shell profile was left alone — remove the GRU953-STUDIO block by hand if you want it gone.');
}

function cmdHelp() {
    console.log(`GRU953-Studio — the command-line helper

  gru953-studio install        Find every supported AI coding tool on this
                               computer and set GRU953-Studio up in each one.
  gru953-studio doctor         Check everything is in place, and say what is not.
  gru953-studio status         Report on the project in the current folder.
  gru953-studio models         Show the AI models that are free to use right now.
  gru953-studio update         Check for a newer version and apply it.
  gru953-studio autoupdate on  Schedule a daily update check (off by default).
  gru953-studio autoupdate off Remove that scheduled check.
  gru953-studio init           Write the rule files that let Cursor, Windsurf,
                               Cline, Roo Code, Aider and Copilot follow the
                               studio protocol in the current project.
  gru953-studio uninstall      Remove GRU953-Studio. Leaves your projects alone.

Nothing here changes your computer without telling you what it did.
For the full plain-English guide: https://github.com/GRU-953/GRU953-Studio/wiki`);
}

/** Read from the package's own manifest rather than hardcoded, so it cannot drift. */
function ownVersion() {
    try {
        return require('../package.json').version;
    } catch {
        return 'unknown';
    }
}

async function main() {
    const [, , command, ...rest] = process.argv;
    switch (command) {
        // 2026-08-11: `--version` and `-v` used to fall through to the help text with
        // "Unknown command: --version". They are close to universal convention, so a
        // user typing one has done nothing wrong and should not be told otherwise.
        case '--version':
        case '-v':
        case 'version':
            console.log(ownVersion());
            break;
        case '--help':
        case '-h':
            cmdHelp();
            break;
        case 'install':
            cmdInstall(rest);
            break;
        case 'uninstall':
            cmdUninstall();
            break;
        case 'doctor':
            cmdDoctor();
            break;
        case 'status':
            printStatus();
            break;
        case 'models':
            await cmdModels(rest);
            break;
        case 'update':
            cmdUpdate();
            break;
        case 'autoupdate':
            cmdAutoupdate(rest);
            break;
        case 'init': {
            console.log('Setting up the rule files for every other AI coding tool...');
            const { initializeUniversalRules } = require('./universal-init');
            initializeUniversalRules();
            break;
        }
        case 'help':
        case undefined:
        default:
            if (command && command !== 'help') console.log(`Unknown command: ${command}\n`);
            cmdHelp();
            break;
    }
}

// Only run when invoked as a command, so the tests can require the module.
if (require.main === module) {
    main().catch((e) => {
        console.error(`GRU953-Studio: ${e && e.message ? e.message : String(e)}`);
        process.exitCode = 1;
    });
}

module.exports = { findPluginSource, findVsix };
