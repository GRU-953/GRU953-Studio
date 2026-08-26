#!/usr/bin/env node
//
// config-protection.mjs — stops an agent from weakening the instruments that measure it.
//
// THE FAILURE MODE, precisely. An unattended agent told "make the build pass" has two routes
// available: fix the code, or edit the thing that decides whether the code is acceptable. The
// second is faster, always works, and leaves every downstream gate reporting green while
// measuring nothing. With a person watching, they notice a commit that lowers a coverage
// threshold. With nobody watching, nothing notices — and this repository's own findings log
// (X348-X368) is a long record of what "reports green while measuring nothing" costs.
//
// WHAT IT GUARDS, in two groups.
//
// (1) The quality tooling's own configuration — ESLint, Prettier, Biome, Ruff, mypy, tsconfig,
//     Stylelint, clippy/rustfmt, golangci, SwiftLint, detekt, Dart analysis options. Editing
//     one of these is how "make lint pass" becomes "make lint stop looking".
//
// (2) **This product's own Definition-of-Done substrate**, which matters more than group (1)
//     and is specific to v7:
//       * `Dev-Memory/dod.json`      — declares the coverage floor and the commands each
//                                      dimension is proven by. An agent that can lower
//                                      `minPercent`, or swap a real test command for `true`,
//                                      makes hooks/dod.mjs measure whatever it likes.
//       * `Dev-Memory/evidence/*`    — the recorded exit codes. Writing evidence is dod.mjs's
//                                      job, done by executing something. An agent that can
//                                      hand-write an evidence file can hand-write a pass, and
//                                      the entire executed-Definition-of-Done substrate
//                                      collapses back into the self-attestation it replaced.
//       * `Dev-Memory/QUALITY-GATE.md` — generated from that evidence.
//
//     No conflict with dod.mjs itself: this is a PreToolUse hook on Claude's file-editing
//     tools, and dod.mjs writes through Node's own fs. The gate that produces evidence is not
//     the agent being graded, and only the latter goes through a tool call.
//
// TWO EXCEPTIONS, both of which you would get wrong on the first attempt.
//
//   * **First-time creation is allowed.** Setting a project's tooling up is legitimate work,
//     and a project with no linter cannot acquire one if creating the config is refused. The
//     rule is therefore about MODIFYING an existing config, not about the filename.
//   * **`pyproject.toml` and `setup.cfg` are excluded on purpose.** Both carry project
//     metadata — dependencies, packaging, entry points — alongside any tool section, so
//     blocking them blocks ordinary work several times a day. A hook that fires on legitimate
//     work gets switched off, and a switched-off hook guards nothing. Test-runner configs
//     (jest/vitest and friends) are excluded for the same reason: they change legitimately and
//     often, and in v7 the coverage floor does not live there — it lives in `dod.json`, which
//     IS guarded.
//
// It never emits `permissionDecision: "allow"`. INV17 forbids that outright, and for good
// reason: "allow" suppresses the prompt the user would otherwise have seen, which is not the
// same as having no objection. This hook either denies or says nothing at all.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { readStdin, deny, stepAside } from './lib.mjs';

// Matched on the BASENAME, lowercased. A curated list is the whole intellectual content here:
// the value is in knowing that `eslint.config.mts` and `.eslintrc.cjs` are both real and both
// authoritative, and that a near-miss spelling is a hole.
const GUARDED_BASENAMES = new Set([
  // ESLint
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.mjs',
  '.eslintrc.json',
  '.eslintrc.yaml',
  '.eslintrc.yml',
  '.eslintignore',
  'eslint.config.js',
  'eslint.config.cjs',
  'eslint.config.mjs',
  'eslint.config.ts',
  'eslint.config.cts',
  'eslint.config.mts',
  // Prettier
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.json5',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  '.prettierrc.toml',
  '.prettierignore',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  // Biome
  'biome.json',
  'biome.jsonc',
  // Python linters/type checkers (pyproject.toml and setup.cfg deliberately absent — see above)
  'ruff.toml',
  '.ruff.toml',
  '.flake8',
  'mypy.ini',
  '.mypy.ini',
  '.pylintrc',
  'pylintrc',
  // TypeScript — the `types` dimension's instrument
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.build.json',
  'jsconfig.json',
  // Stylelint
  '.stylelintrc',
  '.stylelintrc.json',
  '.stylelintrc.yaml',
  '.stylelintrc.yml',
  '.stylelintrc.js',
  '.stylelintrc.cjs',
  'stylelint.config.js',
  'stylelint.config.cjs',
  '.stylelintignore',
  // Rust
  'clippy.toml',
  '.clippy.toml',
  'rustfmt.toml',
  '.rustfmt.toml',
  // Go
  '.golangci.yml',
  '.golangci.yaml',
  '.golangci.toml',
  '.golangci.json',
  // Swift / Kotlin / Java
  '.swiftlint.yml',
  '.swiftlint.yaml',
  '.swiftformat',
  'detekt.yml',
  'detekt.yaml',
  'checkstyle.xml',
  'spotbugs-exclude.xml',
  // Dart / Flutter
  'analysis_options.yaml',
  // Editor-enforced formatting, which real formatters read
  '.editorconfig',
]);

function isGuardedPath(abs) {
  const base = path.basename(abs).toLowerCase();
  if (GUARDED_BASENAMES.has(base)) return 'quality tooling configuration';

  // The Definition-of-Done substrate, matched on POSITION rather than on name, because the
  // filename `dod.json` is only meaningful inside a Dev-Memory folder.
  const posix = abs.split(path.sep).join('/');
  if (/(^|\/)Dev-Memory\/dod\.json$/.test(posix)) {
    return "this project's Definition of Done (Dev-Memory/dod.json)";
  }
  if (/(^|\/)Dev-Memory\/evidence\//.test(posix)) {
    return 'recorded Definition-of-Done evidence (Dev-Memory/evidence/)';
  }
  if (/(^|\/)Dev-Memory\/QUALITY-GATE\.md$/.test(posix)) {
    return 'the generated quality-gate table (Dev-Memory/QUALITY-GATE.md)';
  }
  return null;
}

// ---- read the tool call -------------------------------------------------------------------
// Deny on an unreadable payload, following scan.mjs's precedent verbatim: losing the payload
// means losing the path this hook exists to inspect, so standing aside would let through
// precisely the edit it was invoked to consider.
let INPUT;
try {
  INPUT = readStdin();
} catch (e) {
  deny(
    'studio config protection: refusing to allow — could not reliably read the tool-call ' +
      `payload (${(e && e.message) || e}), so the file this edit targets is unknown. A guard ` +
      'that cannot see its input must not wave it through.',
  );
}

let payload;
try {
  payload = JSON.parse(INPUT);
} catch {
  deny(
    'studio config protection: refusing to allow — the tool-call payload was not valid JSON, ' +
      'so the file this edit targets is unknown.',
  );
}

const ti =
  payload &&
  payload.tool_input &&
  typeof payload.tool_input === 'object' &&
  !Array.isArray(payload.tool_input)
    ? payload.tool_input
    : {};

// Write/Edit/MultiEdit/NotebookEdit all name their target the same way. A payload with no
// path is not an edit this hook has an opinion about.
const target =
  (typeof ti.file_path === 'string' && ti.file_path) ||
  (typeof ti.notebook_path === 'string' && ti.notebook_path) ||
  '';

if (target === '') stepAside();

const abs = path.resolve(target);
const what = isGuardedPath(abs);
if (!what) stepAside();

// First-time creation is legitimate setup. Only an EXISTING file is protected — the rule is
// about weakening an instrument that already exists, not about the filename.
let exists;
try {
  exists = fs.statSync(abs).isFile();
} catch {
  exists = false;
}
if (!exists) stepAside();

deny(
  `studio config protection: this edit changes ${what} — ${path.basename(abs)}. ` +
    'That file is part of how this project is MEASURED, so changing it changes the result ' +
    'rather than the work. If a check is failing, fix what it is reporting; if the check ' +
    'itself is genuinely wrong or the standard genuinely needs to change, that is a decision ' +
    'for the person who owns the project to make deliberately, not something to adjust in ' +
    'passing while trying to get a build green. Creating this file for the first time is ' +
    'allowed; modifying it once it exists is not.',
);
