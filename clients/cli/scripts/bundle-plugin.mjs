#!/usr/bin/env node
//
// bundle-plugin.mjs — copies the studio itself into this package so it can be
// published alongside the command.
//
// WHY THIS EXISTS, which is worth reading before changing anything here.
//
// `gru953-studio install` is meant to find every supported AI tool on a machine
// and set the studio up in each one. Installed from a git checkout it does exactly
// that. Installed from npm — or from Homebrew, which installs the npm package — it
// could not, because the published package shipped `src` and LICENSE only. The
// studio's skills, agents and hooks were simply not there. The command printed an
// honest message pointing the user elsewhere, which was the right behaviour given
// the constraint, but it was not what the README, the Homebrew caveats or the
// wiki's Homebrew route all promised.
//
// Found on 2026-08-11 by running the real Homebrew-installed command rather than
// the checkout. Every automated test had passed, because every automated test ran
// from a checkout, where the plugin is a few directories up and always present.
// That is the same lesson as the winget episode: the thing that fails is the thing
// nobody exercises the way a stranger would.
//
// npm's `files` field cannot reference paths outside the package root, and
// plugins/gru953-studio sits two levels above clients/cli. So the plugin is copied
// in at pack time by this script, wired to npm's `prepack` lifecycle hook — which
// runs for `npm pack` and `npm publish` but NOT for `npm install`, so a normal
// checkout is never polluted by it. The copied directory is gitignored for the
// same reason: it is build output, not source.
//
// Deliberately NOT solved by publishing the plugin as a second npm package: that
// would couple two versions together for the sake of a 1.6MB copy, and a version
// mismatch between the command and the studio it installs would be a far nastier
// failure than a slightly larger tarball.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const SOURCE = path.join(REPO_ROOT, 'plugins', 'gru953-studio');
const TARGET = path.join(PACKAGE_ROOT, 'plugin');

// Never ship build output, dependency trees, or platform litter inside the
// package — the same exclusions tools/build-release-assets.mjs applies.
const EXCLUDE = new Set(['node_modules', '.git', 'dist', 'out', '.DS_Store']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let files = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) files += copyDir(src, dst);
    else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
      files++;
    }
  }
  return files;
}

const marker = path.join(SOURCE, '.claude-plugin', 'plugin.json');
if (!fs.existsSync(marker)) {
  // Fail loudly rather than publish a package whose `install` command silently
  // cannot install anything — the exact defect this script exists to fix.
  console.error(
    `bundle-plugin: cannot find the studio at ${SOURCE}\n` +
      'This script only works from inside the GRU953-Studio repository, where the\n' +
      'plugin sits two directories above this package. Publishing without it would\n' +
      'ship a command that cannot install the studio, so this is a hard failure.',
  );
  process.exit(1);
}

fs.rmSync(TARGET, { recursive: true, force: true });
const count = copyDir(SOURCE, TARGET);

const version = JSON.parse(fs.readFileSync(marker, 'utf8')).version;
const own = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
if (version !== own) {
  // A command that installs a different version of the studio than it claims to be
  // is worse than one that installs nothing, because nothing about it looks wrong.
  console.error(
    `bundle-plugin: version mismatch — this package is ${own} but the studio is ${version}.\n` +
      'Both must agree before publishing. Bump whichever is behind.',
  );
  process.exit(1);
}

console.log(`bundle-plugin: copied ${count} files of the studio (v${version}) into ./plugin`);
