#!/usr/bin/env node
//
// build-release-assets.mjs — builds every downloadable installer this project
// attaches to a GitHub release. Zero dependencies (see tools/lib/zip.mjs for why
// there is a hand-written ZIP writer rather than a package or a shell command).
//
// User-requested 2026-08-10: "dedicated downloadable GRU953-Studio installers
// for Claude Desktop, VS Code, & Antigravity as assets for every release".
//
// WHAT EACH TARGET ACTUALLY ACCEPTS — verified 2026-08-10 against each vendor's
// own current documentation, because guessing a packaging format produces a
// download that silently does nothing:
//
//   Claude Code    — a plugin directory with .claude-plugin/plugin.json at its
//                    root. Normally installed from a marketplace; a downloadable
//                    copy exists for offline or air-gapped use.
//   Claude Desktop — takes the SAME Claude Code plugin format. Its documented
//                    routes are (a) add a GitHub repo as a marketplace and
//                    (b) "install from a file" by uploading a plugin package on
//                    the Customize > Plugins page. Documented limits: 200MB
//                    uncompressed and 5,000 files per package, both asserted
//                    below. NOTE, stated honestly: the docs say "select the
//                    plugin package" without naming a file extension, so .zip is
//                    a reasoned choice, not a documented one — which is exactly
//                    why every INSTALL.txt leads with the marketplace route,
//                    which IS documented, and offers the file as the fallback.
//   Antigravity    — a DIFFERENT layout: plugin.json at the root, skills/ and
//                    rules/ subdirectories, installed to
//                    ~/.gemini/config/plugins/ (global) or .agents/plugins/
//                    (per workspace). Critically, Antigravity's plugin format
//                    has NO agents/ or commands/ component at all, so the 38
//                    specialists cannot be shipped as agents there. They are
//                    projected into a generated rules/ file instead — see
//                    buildRosterRule(). Inventing an agents/ directory
//                    Antigravity would ignore would be a dead reference of
//                    exactly the kind this repo has had to fix before.
//   VS Code        — a .vsix, built by @vscode/vsce, which also serves Cursor
//                    and Windsurf (both VS Code forks).
//
// Usage:
//   node tools/build-release-assets.mjs [--out dist] [--skip-vsix]
//
// --skip-vsix exists because packaging the extension shells out to npx and
// needs its dependencies installed; the three zips and the checksums must still
// be buildable (and testable) without that.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createZip } from './lib/zip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'gru953-studio');

// Claude Desktop's documented package limits. Asserted rather than assumed: a
// package that quietly exceeds them fails at upload time, in front of the user,
// which is the worst place to discover it.
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 5000;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Every file under `dir`, as { name (posix, relative), data, mode }. */
function collectFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    // node_modules and build output must never reach a shipped package, and
    // .DS_Store is a macOS artefact that would otherwise be published to every
    // user who downloads this.
    if (['node_modules', '.git', 'dist', 'out', '.DS_Store'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, rel));
    } else if (entry.isFile()) {
      out.push({
        name: rel,
        data: fs.readFileSync(full),
        mode: fs.statSync(full).mode & 0o777 || 0o644,
      });
    }
  }
  return out;
}

// The leading boundary must allow an opening bracket, not just whitespace:
// ai-developer's real description reads "...feature (e.g. calling the Claude
// API...", where "e.g." is preceded by "(". A whitespace-only boundary missed it
// and the truncation bug survived its first fix — caught by reading the
// generated file a second time rather than trusting the fix.
const SENTENCE_ABBREVIATIONS = /(?:^|[\s([{])(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|No|approx)\.$/i;

/**
 * The first real sentence of a role description.
 *
 * Not simply `indexOf('. ')`: several of these descriptions contain "e.g." and
 * "i.e." early on, and the naive version cut ai-developer's entry off at
 * "any AI/LLM (Large Language Model) feature (e.g." — found by reading the
 * generated file rather than assuming it looked right. Abbreviations are skipped
 * over, and a sentence shorter than 60 characters is treated as a false stop and
 * the search continues, so an unusually short opener does not produce a stub.
 * Falls back to the whole description if no clean break is found.
 */
export function firstSentence(text, minLength = 60) {
  let from = 0;
  for (;;) {
    const stop = text.indexOf('. ', from);
    if (stop === -1) return text;
    const candidate = text.slice(0, stop + 1);
    if (candidate.length >= minLength && !SENTENCE_ABBREVIATIONS.test(candidate)) return candidate;
    from = stop + 1;
  }
}

/**
 * Projects the real specialist roster into a single Antigravity rules file.
 *
 * Generated from agents/*.md frontmatter rather than hand-written, so it can
 * never drift from the actual roster — the same discipline ROSTER.md and
 * roster-check.mjs already enforce for the count. A hand-maintained list here
 * would be a 39th place for the roster to go stale.
 */
function buildRosterRule() {
  const agentsDir = path.join(PLUGIN_ROOT, 'agents');
  const roles = [];
  for (const f of fs.readdirSync(agentsDir).sort()) {
    if (!f.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(agentsDir, f), 'utf8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const name = f.replace(/\.md$/, '');
    let description = '';
    if (fm) {
      const m = fm[1].match(/^description:\s*(.*)$/m);
      if (m) {
        // Frontmatter values may be quoted (ai-developer's is). Strip one layer
        // from both ends, then take the first real sentence — the full text
        // lives in the plugin proper, and a rules table needs one clear line.
        description = m[1]
          .trim()
          .replace(/^["'>|-]+\s*/, '')
          .replace(/["']\s*$/, '');
        description = firstSentence(description);
      }
    }
    roles.push({ name, description });
  }
  const rows = roles
    .map((r) => `| \`${r.name}\` | ${r.description.replace(/\|/g, '\\|')} |`)
    .join('\n');
  return `# GRU953-Studio specialist roster

Antigravity's plugin format supports skills and rules, but has no \`agents/\`
component (verified against antigravity.google/docs/plugins on 2026-08-10), so
GRU953-Studio's specialists cannot be installed here as separate subagents the
way they are in Claude Code. This file is how they still reach you: when the
studio protocol calls for a specialist, adopt the matching role below and follow
its brief, rather than treating the request as unavailable.

The authoritative definition of each role lives in the plugin itself
(\`agents/<name>.md\` in the GRU953-Studio repository). This is a summary for a
host that cannot load those files.

**${roles.length} specialists.**

| Role | What it owns |
| :-- | :-- |
${rows}

Antigravity's own Subagents feature is configured separately from plugins and is
not set up by this package — that is a limitation, stated plainly rather than
worked around.
`;
}

// The Windows portable package (2026-08-11, added when the winget manifests were
// actually submitted rather than merely drafted).
//
// This exists because of a real mistake caught before it reached anyone: the first
// winget manifest declared a `gru953-studio` command and pointed at the Claude Code
// plugin package — 128 markdown files with no executable in them. winget would have
// rejected it, and submitting it would have wasted Microsoft's reviewers' time on a
// package that could never work.
//
// winget's portable installer type puts a file on the PATH; it does not run an
// installer. The CLI is a Node script, so what goes on the PATH has to be a shim
// that finds Node and hands off to it. Node itself is declared as a winget package
// dependency (OpenJS.NodeJS) rather than bundled, which is both smaller and honest —
// bundling a second Node runtime for a machine that probably has one is the wrong
// trade.
const WINDOWS_SHIM = `@echo off
REM GRU953-Studio launcher for Windows.
REM
REM winget's "portable" installer type puts this file on your PATH. It finds Node.js
REM and runs the studio's command-line helper with whatever arguments you gave.
REM
REM Node.js is declared as a dependency of this winget package, so winget installs it
REM for you. If you somehow have this file without Node, the message below tells you
REM exactly what to do rather than failing with something cryptic.
where /q node
if errorlevel 1 (
  echo GRU953-Studio needs Node.js, which does not appear to be installed.
  echo.
  echo To install it:
  echo   1. Open https://nodejs.org in your web browser.
  echo   2. Download the version marked "LTS".
  echo   3. Open the downloaded file and follow its instructions.
  echo   4. Close this window, open a new one, and try again.
  echo.
  echo Or, if you have winget:  winget install OpenJS.NodeJS
  exit /b 1
)
node "%~dp0src\\index.js" %*
`;

const INSTALL_CLAUDE_CODE = (version) => `GRU953-Studio ${version} — installing in Claude Code
======================================================

The easiest way does not need this download at all. Type these two lines into
Claude Code, one at a time:

    /plugin marketplace add GRU-953/GRU953-Studio
    /plugin install gru953-studio@gru953-studio

Use this downloaded copy instead only if you have no internet access to GitHub
from the machine running Claude Code, or you want to pin this exact version.

To install from this download:

 1. Unzip this file. You will get a folder called "gru953-studio".
 2. Move that folder into the "plugins" folder inside your Claude Code
    configuration directory:
       macOS / Linux:  ~/.claude/plugins/
       Windows:        %USERPROFILE%\\.claude\\plugins\\
    Create the "plugins" folder if it is not there yet.
 3. Restart Claude Code.
 4. Type /studio to begin.

You will also need two free tools, which the studio checks for and explains if
they are missing: Node.js (https://nodejs.org) and, only when you publish, the
GitHub CLI (https://cli.github.com).

Everything in this package is plain text you can read. Nothing runs during
installation.
`;

const INSTALL_CLAUDE_DESKTOP = (version) => `GRU953-Studio ${version} — installing in Claude Desktop
=========================================================

Claude Desktop can install GRU953-Studio in two ways. The first is the one
Anthropic documents, and the one to try first.

WAY 1 — from the GitHub repository (recommended)
------------------------------------------------
 1. Open Claude Desktop.
 2. In the sidebar, click "Customize".
 3. Click "Plugins".
 4. Click "Add marketplace".
 5. Type:  GRU-953/GRU953-Studio
 6. Press Enter, then find GRU953-Studio in the list and click "Install".
 7. Open the installed plugin to see its skills and agents.

That route also updates itself: click "Update" on the marketplace later to pull
the newest version.

WAY 2 — from this downloaded file
---------------------------------
Use this if the machine cannot reach GitHub, or you want this exact version.
 1. Open Claude Desktop.
 2. In the sidebar, click "Customize".
 3. Click "Plugins".
 4. Choose the upload option on that page.
 5. Select this file.

One honest note: Anthropic's documentation describes uploading "the plugin
package" without stating which file type it expects. This download is a .zip
containing the plugin folder. If Claude Desktop does not accept it, that is why,
and WAY 1 above is the documented route that always works.

Plugins are supported in Claude Desktop's Cowork and Code surfaces. They are not
used in plain Chat.
`;

const INSTALL_WINDOWS_PORTABLE = (
  version,
) => `GRU953-Studio ${version} — the Windows command (portable)
=============================================================

Most people should not need this file. An easier route exists:

  npm install -g @gru953/studio-cli     (if you have Node.js)

Or paste the one-line installer from the project's README, which sets the studio up
in every AI tool on this computer at once.

This package is here for anyone who would rather have the plain files, or who cannot
use npm.

(GRU953-Studio is deliberately NOT on winget. winget only accepts a .exe for this
kind of package, and this is a Node.js tool — see tools/packaging/README.md in the
repository for the full reasoning. That is a decision, not an oversight.)

WHAT YOU NEED FIRST
-------------------
Node.js. GRU953-Studio is written to run on it.
 1. Open https://nodejs.org in your web browser.
 2. Download the version marked "LTS".
 3. Open the downloaded file and follow its instructions.

TO USE IT
---------
 1. Unzip this file to a folder you will keep, for example:
      C:\\Program Files\\GRU953-Studio
 2. Open that folder and check you can see "gru953-studio.cmd".
 3. Open PowerShell and run it by its full path, for example:
      & "C:\\Program Files\\GRU953-Studio\\gru953-studio.cmd" doctor
 4. To type just "gru953-studio" from anywhere, add that folder to your PATH:
      setx PATH "%PATH%;C:\\Program Files\\GRU953-Studio"
    Then close and reopen PowerShell.

WHAT TO RUN
-----------
  gru953-studio doctor     Checks everything is in place, and says what is not.
  gru953-studio install    Sets the studio up in every AI tool on this computer.
  gru953-studio help       Lists everything it can do.

Everything here is plain text you can read. Nothing runs during installation.
`;

const INSTALL_ANTIGRAVITY = (
  version,
) => `GRU953-Studio ${version} — installing in Google Antigravity
=============================================================

This package is laid out the way Antigravity's own documentation describes for a
plugin: a plugin.json file, a skills folder, and a rules folder.

To install for every project (recommended)
------------------------------------------
 1. Unzip this file. You will get a folder called "gru953-studio".
 2. Move that folder into this location in your home directory:
       ~/.gemini/config/plugins/
    On Windows that is:  %USERPROFILE%\\.gemini\\config\\plugins\\
    Create any of those folders that do not exist yet.
 3. Restart Antigravity.
 4. Ask it to build something, and it will follow the studio protocol.

To install for one project only
-------------------------------
Put the same "gru953-studio" folder in a ".agents/plugins/" folder at the top of
that project instead.

Two limitations, stated plainly rather than hidden
-------------------------------------------------
 * Antigravity's plugin format has no place for separate specialist agents, so
   the ${'specialists'} are provided as a rules file (rules/gru953-roster.md)
   that tells Antigravity to adopt each role itself. In Claude Code they run as
   genuinely separate agents, which works better.
 * The studio's slash commands (/studio, /studio-status and the rest) are a
   Claude Code feature. In Antigravity, ask in plain words instead — "carry on
   with my project", "where are we up to" — which the studio skill handles.

The safety hooks are not included here: Antigravity supports hooks through a
hooks.json file, but its exact format could not be verified from the published
documentation, and shipping a guessed configuration is worse than shipping none.
Publishing to GitHub from Antigravity therefore has fewer automatic checks than
in Claude Code, so read what it proposes before you agree to it.
`;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function assertWithinDesktopLimits(files, label) {
  const total = files.reduce((n, f) => n + f.data.length, 0);
  if (files.length > MAX_FILES) {
    throw new Error(
      `${label}: ${files.length} files exceeds Claude Desktop's documented 5,000-file limit`,
    );
  }
  if (total > MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `${label}: ${total} uncompressed bytes exceeds Claude Desktop's documented 200MB limit`,
    );
  }
  return { files: files.length, uncompressed: total };
}

export function buildAssets({ outDir, skipVsix = false, log = console.log } = {}) {
  const version = readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')).version;
  if (!version) throw new Error('plugin.json has no version');
  fs.mkdirSync(outDir, { recursive: true });

  const pluginFiles = collectFiles(PLUGIN_ROOT);
  if (!pluginFiles.some((f) => f.name === '.claude-plugin/plugin.json')) {
    throw new Error('the plugin package would have no .claude-plugin/plugin.json at its root');
  }
  const written = [];

  // --- Claude Code and Claude Desktop: the same plugin format, different guide.
  for (const [target, install] of [
    ['claude-code', INSTALL_CLAUDE_CODE],
    ['claude-desktop', INSTALL_CLAUDE_DESKTOP],
  ]) {
    const entries = [
      ...pluginFiles.map((f) => ({ ...f, name: `gru953-studio/${f.name}` })),
      { name: 'INSTALL.txt', data: install(version) },
    ];
    const stats = assertWithinDesktopLimits(entries, target);
    const name = `gru953-studio-${target}-${version}.zip`;
    fs.writeFileSync(path.join(outDir, name), createZip(entries));
    written.push(name);
    log(
      `built ${name} (${stats.files} files, ${(stats.uncompressed / 1024 / 1024).toFixed(1)}MB uncompressed)`,
    );
  }

  // --- Antigravity: its own documented layout, not the Claude one.
  const skillFiles = collectFiles(path.join(PLUGIN_ROOT, 'skills'));
  const agEntries = [
    {
      name: 'gru953-studio/plugin.json',
      data: JSON.stringify({ name: 'gru953-studio', version }, null, 2) + '\n',
    },
    ...skillFiles.map((f) => ({ ...f, name: `gru953-studio/skills/${f.name}` })),
    { name: 'gru953-studio/rules/gru953-roster.md', data: buildRosterRule() },
    {
      name: 'gru953-studio/rules/gru953-operating-charter.md',
      data: fs.readFileSync(path.join(REPO_ROOT, '.agents', 'OPERATING-CHARTER.md'), 'utf8'),
    },
    { name: 'INSTALL.txt', data: INSTALL_ANTIGRAVITY(version) },
  ];
  const agName = `gru953-studio-antigravity-${version}.zip`;
  fs.writeFileSync(path.join(outDir, agName), createZip(agEntries));
  written.push(agName);
  log(`built ${agName} (${agEntries.length} files, Antigravity plugin.json + skills/ + rules/)`);

  // --- The Windows portable package winget installs. Deliberately built from
  // --- clients/cli only: it is the COMMAND, not the studio's skills and agents,
  // --- which the plugin packages above carry.
  const cliFiles = collectFiles(path.join(REPO_ROOT, 'clients', 'cli', 'src'));
  if (!cliFiles.some((f) => f.name === 'index.js')) {
    throw new Error('the Windows portable package would contain no CLI entry point');
  }
  const winEntries = [
    { name: 'gru953-studio.cmd', data: WINDOWS_SHIM.replace(/\n/g, '\r\n') },
    ...cliFiles.map((f) => ({ ...f, name: `src/${f.name}` })),
    { name: 'LICENSE', data: fs.readFileSync(path.join(REPO_ROOT, 'clients', 'cli', 'LICENSE')) },
    { name: 'INSTALL.txt', data: INSTALL_WINDOWS_PORTABLE(version).replace(/\n/g, '\r\n') },
  ];
  const winName = `gru953-studio-windows-portable-${version}.zip`;
  fs.writeFileSync(path.join(outDir, winName), createZip(winEntries));
  written.push(winName);
  log(`built ${winName} (${winEntries.length} files, a .cmd shim + the CLI)`);

  // --- The one-command installer scripts, shipped alongside so a release page
  // --- is self-sufficient rather than sending people elsewhere for them.
  for (const script of ['install.sh', 'install.ps1']) {
    const src = path.join(HERE, 'installers', script);
    if (!fs.existsSync(src))
      throw new Error(`missing installer script: tools/installers/${script}`);
    fs.copyFileSync(src, path.join(outDir, script));
    written.push(script);
    log(`copied ${script}`);
  }

  // --- VS Code (and Cursor / Windsurf, both VS Code forks).
  if (skipVsix) {
    log('skipped the .vsix (--skip-vsix)');
  } else {
    const vscodeDir = path.join(REPO_ROOT, 'clients', 'vscode');
    const vsixName = `gru953-studio-${version}.vsix`;
    execFileSync(
      'npx',
      ['--yes', '@vscode/vsce', 'package', '--out', path.join(outDir, vsixName)],
      {
        cwd: vscodeDir,
        stdio: 'inherit',
      },
    );
    written.push(vsixName);
    log(`built ${vsixName}`);
  }

  // --- Checksums, so a download can be verified. Meaningful only because the
  // --- ZIP writer stamps fixed timestamps: see tools/lib/zip.mjs.
  const sums = written
    .filter((n) => n !== 'SHA256SUMS.txt')
    .sort()
    .map((n) => `${sha256(fs.readFileSync(path.join(outDir, n)))}  ${n}`)
    .join('\n');
  fs.writeFileSync(path.join(outDir, 'SHA256SUMS.txt'), sums + '\n');
  written.push('SHA256SUMS.txt');
  log('wrote SHA256SUMS.txt');

  return { version, written };
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[/\\]/).pop());
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outDir = path.resolve(REPO_ROOT, outIdx >= 0 ? argv[outIdx + 1] : 'dist');
  try {
    const { version, written } = buildAssets({ outDir, skipVsix: argv.includes('--skip-vsix') });
    console.log(`\nGRU953-Studio ${version}: ${written.length} release assets in ${outDir}`);
  } catch (e) {
    console.error(`\nRelease packaging failed: ${e.message}`);
    process.exitCode = 1;
  }
}
