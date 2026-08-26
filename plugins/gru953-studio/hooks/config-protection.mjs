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

import { readStdin, deny, stepAside, shellSegments, shellTokens } from './lib.mjs';

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
  // Matched with the trailing slash OPTIONAL. With it required, `Dev-Memory/evidence` named as a
  // whole — which is how a directory is deleted — matched nothing, so `rm -rf Dev-Memory/evidence`
  // removed every measurement at once while each individual file inside it was protected. Found
  // 2026-08-27 while reviewing the fix that added the shell arm: the arm guarded writes to files
  // and the commonest destructive spelling names a directory.
  if (/(^|\/)Dev-Memory\/evidence(\/|$)/.test(posix)) {
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

// The directory the tool call is being made FROM. A relative path in a tool payload is relative
// to the session's working directory, not to wherever this hook happens to be executed — and
// resolving against the wrong root silently produced "that file does not exist", which this hook
// reads as first-time creation and waves through. Measured 2026-08-27: an Edit of an EXISTING
// Dev-Memory/evidence/tests.json was stepped aside, because the path resolved against the plugin
// directory instead of the project. The guard was failing open on its own commonest input.
const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : process.cwd();

// Write/Edit/MultiEdit/NotebookEdit all name their target the same way. A payload with no
// path is not an edit this hook has an opinion about.
const target =
  (typeof ti.file_path === 'string' && ti.file_path) ||
  (typeof ti.notebook_path === 'string' && ti.notebook_path) ||
  '';

// ---- the shell surface --------------------------------------------------------------------
// This hook was wired to the four file-editing tools only, so every guarded file was one
// redirection away from being written anyway: `echo '{"verdict":"pass"}' > Dev-Memory/evidence/
// tests.json` was refused as an Edit and allowed as a Bash command. Found 2026-08-27 (contract
// sweep). The thing being protected is a MEASUREMENT, and it does not matter which tool
// overwrites it.
//
// WHAT THIS DOES AND DOES NOT CLAIM. It enumerates the ways a write is ordinarily spelled —
// redirection, `tee`, an in-place editor, a copy or move onto the path, a deletion. It is not a
// shell interpreter and does not pretend to be one. `python -c "open('Dev-Memory/dod.json','w')"`
// is not caught, nor is a write from inside a script file. That residual is stated rather than
// papered over, and it is the reason this hook is one layer and not the whole answer: the other
// layer is that quality-gate.mjs now reads the evidence back and cross-checks it against the
// table, so a forged file has to be forged consistently, in several places, on purpose.
//
// It never ALLOWS anything: every path here ends in either deny() or stepAside(), so a command
// this cannot parse is left to the other hooks exactly as before.
function writeTargetsIn(command) {
  const found = [];
  for (const seg of shellSegments(command)) {
    const toks = shellTokens(seg);
    if (toks.length === 0) continue;
    const program = path.basename(toks[0]).toLowerCase();
    const isFlag = (t) => t.startsWith('-') && t !== '-';

    // Redirection, whether spaced (`> path`) or attached (`>path`, `2>path`).
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const m = /^\d*>>?(.*)$/.exec(t);
      if (!m) continue;
      if (m[1] !== '') found.push(m[1]);
      else if (toks[i + 1] && !isFlag(toks[i + 1])) found.push(toks[i + 1]);
    }

    const rest = toks.slice(1).filter((t) => !isFlag(t) && !/^\d*>>?/.test(t));
    switch (program) {
      case 'tee':
      case 'rm':
      case 'truncate':
      case 'shred':
      case 'unlink':
        found.push(...rest);
        break;
      case 'sed':
      case 'perl':
      case 'ruby':
        // Only in-place editing writes a file. `sed -i ''` on BSD takes a suffix argument, which
        // the filter above already dropped as a non-flag token only if it were a flag — it is
        // an empty string, so it never survives shellTokens. Both spellings land here.
        if (toks.some((t) => t === '-i' || /^-i\S/.test(t) || t === '--in-place')) {
          found.push(...rest);
        }
        break;
      case 'mv':
        // EVERY operand. A move writes its destination and REMOVES its sources, so
        // `mv Dev-Memory/evidence /tmp/gone` destroys the measurements just as surely as deleting
        // them — and checking only the destination, as the copy family below correctly does,
        // waved it straight through.
        found.push(...rest);
        break;
      case 'cp':
      case 'install':
      case 'ln':
        // The destination is the last operand; the others are only READ.
        if (rest.length >= 1) found.push(rest[rest.length - 1]);
        break;
      case 'dd': {
        for (const t of toks) {
          const of = /^of=(.+)$/.exec(t);
          if (of) found.push(of[1]);
        }
        break;
      }
      default:
        break;
    }
  }
  return found;
}

const shellCommand = typeof ti.command === 'string' ? ti.command : '';
if (target === '' && shellCommand !== '') {
  for (const candidate of writeTargetsIn(shellCommand)) {
    const abs = path.resolve(cwd, candidate);
    const what = isGuardedPath(abs);
    if (!what) continue;
    // A file OR a directory. `rm -rf Dev-Memory/evidence` is a write to the substrate however it
    // is spelled, and requiring isFile() here would have let the most destructive form through.
    let exists;
    try {
      const st = fs.statSync(abs);
      exists = st.isFile() || st.isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) continue;
    deny(
      `studio config protection: this command writes to ${what} — ${path.basename(abs)}. ` +
        'That file is part of how this project is MEASURED, so changing it changes the result ' +
        'rather than the work. Going through the shell rather than an edit tool makes no ' +
        'difference to that. If a check is failing, fix what it is reporting; if the standard ' +
        'itself genuinely needs to change, that is a deliberate decision for the person who owns ' +
        'the project, not an adjustment made in passing while trying to get a build green.',
    );
  }
  stepAside();
}

if (target === '') stepAside();

const abs = path.resolve(cwd, target);
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
