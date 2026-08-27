// detect.test.mjs — 2026-08-10, with the universal installer.
//
// Every test below fixes `platform`, `homeDir`, `env` and `exists` explicitly, so
// the Windows and Linux paths are exercised on whatever machine happens to run
// this. That is the whole reason detect.js takes its environment as an argument:
// this repo has been bitten repeatedly by platform-shaped bugs a single-OS run
// could never reveal (see .github/workflows/ci.yml's note on its OS-broad
// matrix), and detection is exactly that kind of code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { detectHosts, hostDefinitions, claudeDesktopDir, whichSync } = require('../src/detect.js');

/** An `exists` stand-in that answers true for exactly the given paths. */
function existsOnly(paths) {
    const set = new Set(paths);
    return (p) => set.has(p);
}

/**
 * The same, but case-insensitive — the accurate model for Windows.
 *
 * Needed because PATHEXT is conventionally UPPERCASE (".CMD") while the file on
 * disk is conventionally lowercase ("code.cmd"), and Windows' filesystem simply
 * does not care. A case-SENSITIVE fake is a worse model of Windows than Windows
 * is, and would fail a test the real platform passes — which is exactly what it
 * did on the first run of the PATHEXT test below.
 */
function existsOnlyCaseInsensitive(paths) {
    const set = new Set(paths.map((p) => p.toLowerCase()));
    return (p) => set.has(String(p).toLowerCase());
}

test('finds Claude Code by its settings folder, and says why it believes that', () => {
    const home = path.join(path.sep, 'home', 'sam');
    const r = detectHosts({
        platform: 'linux',
        homeDir: home,
        env: { PATH: '' },
        exists: existsOnly([path.join(home, '.claude')]),
    });
    const claude = r.found.find((h) => h.id === 'claude-code');
    assert.ok(claude, 'Claude Code must be found');
    assert.match(claude.detectedBy, /settings folder/, 'the reason must be checkable by the user, not just "detected"');
    assert.ok(claude.detectedBy.includes(path.join(home, '.claude')));
    assert.equal(claude.installDir, path.join(home, '.claude', 'plugins', 'gru953-studio'));
});

test('reports nothing found on a machine with none of them, rather than guessing', () => {
    const r = detectHosts({ platform: 'linux', homeDir: '/home/sam', env: { PATH: '' }, exists: () => false });
    assert.equal(r.found.length, 0);
    // v7.0.0: was `>= 6` when the CLI installed into Claude Code, Claude Desktop, Antigravity
    // and three VS Code-family editors. v7 targets Claude Code only, so the supported list is
    // shorter — but the point of the assertion is unchanged: every host it CLAIMS to support
    // must be accounted for, so an empty machine reports them missing rather than reporting
    // nothing at all and looking like a successful scan.
    assert.ok(r.missing.length >= 2, 'every supported host must be listed as missing');
});

test("Claude Desktop's folder is the right one for each operating system", () => {
    assert.equal(
        claudeDesktopDir({ platform: 'darwin', homeDir: '/Users/sam', env: {} }),
        path.join('/Users/sam', 'Library', 'Application Support', 'Claude'),
    );
    // APPDATA rather than a hardcoded path: a roaming or redirected profile is
    // normal on a managed work machine, and a hardcoded C:\Users\... misses it.
    assert.equal(
        claudeDesktopDir({ platform: 'win32', homeDir: 'C:\\Users\\sam', env: { APPDATA: 'D:\\Roaming' } }),
        path.join('D:\\Roaming', 'Claude'),
    );
    assert.equal(
        claudeDesktopDir({ platform: 'win32', homeDir: 'C:\\Users\\sam', env: {} }),
        path.join('C:\\Users\\sam', 'AppData', 'Roaming', 'Claude'),
        'falls back sensibly when APPDATA is unset',
    );
    assert.equal(
        claudeDesktopDir({ platform: 'linux', homeDir: '/home/sam', env: { XDG_CONFIG_HOME: '/cfg' } }),
        path.join('/cfg', 'Claude'),
    );
});



test('whichSync honours PATHEXT on Windows — a bare name never matches there', () => {
    // The bug this prevents: on Windows the executable is `code.cmd`, so looking
    // for a file called exactly `code` finds nothing and every Windows user is
    // told VS Code is not installed. This repo has fixed the same class of bug in
    // its own hooks before.
    const env = { Path: 'C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    const exists = existsOnlyCaseInsensitive([path.join('C:\\tools', 'code.cmd')]);
    const found = whichSync('code', { platform: 'win32', env, exists });
    assert.ok(found, 'code.cmd must be found via PATHEXT');
    assert.match(found.toLowerCase(), /code\.cmd$/);
    assert.equal(
        whichSync('code', {
            platform: 'win32',
            env: { Path: 'C:\\tools' },
            exists: existsOnlyCaseInsensitive([path.join('C:\\tools', 'code')]),
        }),
        null,
        'an extensionless file is not executable on Windows, so it must not count',
    );
});

test('whichSync splits the PATH with the right separator per platform', () => {
    // Same lesson as the test above: the expected value has to be built the way
    // path.join builds it, or this passes on POSIX and fails on Windows for a
    // reason that has nothing to do with separator SPLITTING, which is what it
    // actually tests.
    const a = path.join(path.sep, 'a');
    const b = path.join(path.sep, 'b');
    assert.equal(
        whichSync('gh', {
            platform: 'linux',
            env: { PATH: [a, b].join(':') },
            exists: existsOnly([path.join(b, 'gh')]),
        }),
        path.join(b, 'gh'),
    );
    // A colon-split on Windows would break every path containing a drive letter.
    assert.equal(
        whichSync('gh', {
            platform: 'win32',
            env: { Path: 'C:\\a;C:\\b', PATHEXT: '.EXE' },
            exists: existsOnlyCaseInsensitive([path.join('C:\\b', 'gh.EXE')]),
        }),
        path.join('C:\\b', 'gh.EXE'),
    );
});

test('Claude Desktop is marked unverified, so the installer does not write to a guessed folder', () => {
    // Anthropic documents installing through the app, not by dropping files into
    // a directory. Marking that honestly is what stops the installer silently
    // writing somewhere Claude Desktop may never read.
    const hosts = hostDefinitions({ platform: 'darwin', homeDir: '/Users/sam', env: {} });
    const desktop = hosts.find((h) => h.id === 'claude-desktop');
    assert.equal(desktop.confidence, 'unverified');
    assert.match(desktop.note, /Customize > Plugins/, 'the note must name the documented route');
    const code = hosts.find((h) => h.id === 'claude-code');
    assert.equal(code.confidence, 'documented');
});

test('every host definition carries what the installer needs to act on it', () => {
    for (const h of hostDefinitions({ platform: 'linux', homeDir: '/home/sam', env: {} })) {
        assert.ok(h.id && h.name && h.kind, `${h.id || 'a host'} is missing an id, name or kind`);
        // 2026-08-27: this permitted 'antigravity' and 'vscode-family' too, and the exemption
        // below let a vscode-family host omit its installDir. Both hosts went in 7.0.0, so the
        // list was permitting kinds nothing produces — which is not merely dead, it is the test
        // that would stay green if they were reintroduced un-noticed. Every host now needs an
        // installDir, with no exemption, which is what makes `uninstall` able to act on it.
        assert.equal(h.kind, 'claude-plugin', `unknown kind: ${h.kind} — 7.0.0 targets Claude Code only`);
        assert.ok(['documented', 'unverified'].includes(h.confidence), `${h.id} must state its confidence`);
        assert.ok(h.installDir, `${h.id} needs an installDir`);
    }
});
