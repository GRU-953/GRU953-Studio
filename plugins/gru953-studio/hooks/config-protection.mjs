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

import { readStdin, deny, stepAside, shellTokensDetailed } from './lib.mjs';

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
  // TEST FIXTURES ARE NOT THE LIVE SUBSTRATE. 2026-08-27: this repository's own committed golden
  // fixture gained a `Dev-Memory/evidence/` directory earlier the same day, and this hook then
  // refused to let anyone maintain it — the product blocking work on its own test data, which is
  // the shape of finding X22 in scan.mjs, reached again by a different route.
  //
  // The rule is general rather than special-cased to this repository: what this hook protects is a
  // project's LIVE measurement substrate, and a path under a fixtures directory is by construction
  // test data. RESIDUAL, STATED: a project that kept real evidence under `test/fixtures/` would go
  // unguarded. That is a strange thing to do and it is named here rather than left to be found.
  const posixAbs = abs.replace(/\\/g, '/');
  if (/(^|\/)(?:tests?|spec)\/fixtures\//.test(posixAbs) || /(^|\/)__fixtures__\//.test(posixAbs)) {
    return null;
  }
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
  // A `cd` in an earlier segment changes what a later relative path MEANS.
  // `cd Dev-Memory/evidence && echo x > tests.json` wrote a guarded file while this hook read
  // "tests.json", resolved it against the project root, found nothing there and stepped aside.
  let rel = '.';
  for (const toks of shellTokensDetailed(command)) {
    if (toks.length === 0) continue;
    const words = toks.filter((t) => !t.redirect && !t.descriptor);
    if (words.length === 0) continue;

    // Unwrap the programs that run another program. `["env","true"]` and `nice true` and
    // `timeout 5 true` all reach `true`, and checking only the first word saw `env`.
    const WRAPPERS = new Set([
      'env',
      'nice',
      'nohup',
      'time',
      'timeout',
      'stdbuf',
      'command',
      'builtin',
      'exec',
      'sudo',
      'doas',
    ]);
    let pi = 0;
    while (
      pi < words.length - 1 &&
      (WRAPPERS.has(path.basename(words[pi].value).toLowerCase()) ||
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[pi].value) ||
        (pi > 0 && words[pi].value.startsWith('-')))
    ) {
      pi += 1;
    }
    const program = path.basename(words[pi].value || '').toLowerCase();

    if (program === 'cd' && words[pi + 1]) {
      rel = path.join(rel, words[pi + 1].value);
      continue;
    }

    const at = (t) => ({ target: t, base: rel });
    const isFlag = (t) => t.value.startsWith('-') && t.value !== '-';

    // Redirection, from the SCANNER's judgement rather than from the token text: a `>` that was
    // quoted is an argument a program receives, not something the shell does.
    for (let i = 0; i < toks.length; i++) {
      if (!toks[i].redirect) continue;
      const next = toks[i + 1];
      if (next && !next.redirect && !next.descriptor && toks[i].value[0] === '>')
        found.push(at(next.value));
    }

    const rest = words
      .slice(pi + 1)
      .filter((t) => !isFlag(t))
      .map((t) => t.value);
    switch (program) {
      case 'tee':
      case 'rm':
      case 'truncate':
      case 'shred':
      case 'unlink':
        found.push(...rest.map(at));
        break;
      case 'sed':
      case 'perl':
      case 'ruby':
        // Clustered flags count: `perl -pi -e` is the canonical in-place spelling and the old
        // exact-match on `-i` never saw the `i` inside `-pi`.
        if (
          words.some(
            (t) =>
              t.value === '--in-place' ||
              /^--in-place=/.test(t.value) ||
              (/^-[A-Za-z]*i/.test(t.value) && !t.value.startsWith('--')),
          )
        ) {
          found.push(...rest.map(at));
        }
        break;
      case 'mv':
        // EVERY operand: a move writes its destination and REMOVES its sources.
        found.push(...rest.map(at));
        break;
      case 'cp':
      case 'install':
      case 'ln':
      case 'rsync':
        if (rest.length >= 1) found.push(at(rest[rest.length - 1]));
        break;
      case 'dd':
        for (const t of words) {
          const of = /^of=(.+)$/.exec(t.value);
          if (of) found.push(at(of[1]));
        }
        break;
      default:
        break;
    }
  }
  return found;
}

// This product's own lib.mjs reads a command from more than one field, because different tools
// spell it differently. Reading only `command` meant this arm did nothing at all on the
// PowerShell / Monitor / run_command surfaces that INV10 now certifies it is wired for.
const shellCommand =
  (typeof ti.command === 'string' && ti.command) ||
  (typeof ti.script === 'string' && ti.script) ||
  (typeof ti.CommandLine === 'string' && ti.CommandLine) ||
  (typeof ti.cmd === 'string' && ti.cmd) ||
  '';
if (target === '' && shellCommand !== '') {
  for (const { target: candidate, base } of writeTargetsIn(shellCommand)) {
    let abs = path.resolve(cwd, base, candidate);
    // A GLOB never matches a real path, so statSync said "does not exist", which this hook reads
    // as first-time creation and waves through: `rm -f Dev-Memory/evidence/*.json` deleted every
    // measurement unchallenged. A pattern cannot be resolved without expanding it, but its
    // DIRECTORY can — and for everything guarded here, the directory is the thing that matters.
    if (/[*?[\]]/.test(candidate)) abs = path.dirname(abs);
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

// ---- dod.json: refuse a WEAKENING, not every edit -------------------------------------------
//
// THE DEADLOCK THIS RESOLVES. Two guards added on 2026-08-27 combine into a trap. dod.mjs now
// refuses `lint: notApplicable` in a project that HAS a linter — correct, and reachable the
// moment a build adds one after `dod.json` was written, which is the normal order of work. The
// only way out is to give `lint` a command, which means editing `dod.json` — which this hook
// refused outright. dod.mjs blocks, the fix is blocked, and an unattended run stops with no
// legal move. Neither guard was wrong on its own; together they were a product that could not
// finish.
//
// The threat was never "dod.json changed". It is "the bar was LOWERED to make a failing build
// pass". So compare the proposal with what is on disk and refuse exactly that:
//   * a dimension losing its command, or moving from a command to `notApplicable`
//   * a coverage floor going DOWN
//   * a dimension disappearing
// Raising the bar — n/a becoming a real command, a floor going up, a new dimension declared —
// is the fix the gates are asking for, and it is allowed.
//
// FAILS CLOSED. If the proposal cannot be reconstructed or does not parse, this falls through to
// the refusal below. A change that cannot be shown to be safe is not shown to be safe.
if (/(^|[\\/])Dev-Memory[\\/]dod\.json$/.test(abs.replace(/\\/g, '/'))) {
  const proposed = (() => {
    if (typeof ti.content === 'string') return ti.content; // Write
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
    const edits =
      Array.isArray(ti.edits) && ti.edits.length
        ? ti.edits
        : typeof ti.old_string === 'string'
          ? [{ old_string: ti.old_string, new_string: ti.new_string }]
          : null;
    if (!edits) return null;
    for (const e of edits) {
      if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string') return null;
      if (!text.includes(e.old_string)) return null;
      text = e.replace_all
        ? text.split(e.old_string).join(e.new_string)
        : text.replace(e.old_string, e.new_string);
    }
    return text;
  })();

  const weakenings = [];
  if (proposed !== null) {
    let before = null;
    let after = null;
    try {
      before = JSON.parse(fs.readFileSync(abs, 'utf8'));
      after = JSON.parse(proposed);
    } catch {
      before = after = null;
    }
    if (before && after && before.dimensions && after.dimensions) {
      for (const [key, was] of Object.entries(before.dimensions)) {
        const now = after.dimensions[key];
        if (now === undefined) {
          weakenings.push(`${key} has been removed entirely`);
          continue;
        }
        const hadCommand = was && Array.isArray(was.command);
        const hasCommand = now && Array.isArray(now.command);
        if (hadCommand && !hasCommand) {
          weakenings.push(
            `${key} loses its command${now && now.notApplicable ? ' and becomes notApplicable' : ''} — a dimension that was being measured would stop being measured`,
          );
        }
        if (
          typeof (was || {}).minPercent === 'number' &&
          typeof (now || {}).minPercent === 'number' &&
          now.minPercent < was.minPercent
        ) {
          weakenings.push(
            `${key}'s floor drops from ${was.minPercent}% to ${now.minPercent}% — that is the bar being lowered by the work it grades`,
          );
        }
      }
      if (weakenings.length === 0) {
        // Nothing here lowers the bar. This is the edit the gates are asking for.
        stepAside();
      }
    }
  }
  deny(
    `studio config protection: this edit changes ${what} — ${path.basename(abs)} — in a way that ` +
      (weakenings.length
        ? `LOWERS the bar: ${weakenings.join('; ')}. `
        : 'this hook cannot verify leaves the bar intact (the proposed content could not be reconstructed or does not parse as JSON). ') +
      'Raising the bar is allowed and is often exactly what a failing gate is asking for — ' +
      'giving a dimension a real command, or raising a coverage floor. Lowering it is not: ' +
      'if a check is failing, fix what it is reporting. Changing the standard itself is a ' +
      'deliberate decision for the person who owns the project.',
  );
}

deny(
  `studio config protection: this edit changes ${what} — ${path.basename(abs)}. ` +
    'That file is part of how this project is MEASURED, so changing it changes the result ' +
    'rather than the work. If a check is failing, fix what it is reporting; if the check ' +
    'itself is genuinely wrong or the standard genuinely needs to change, that is a decision ' +
    'for the person who owns the project to make deliberately, not something to adjust in ' +
    'passing while trying to get a build green. Creating this file for the first time is ' +
    'allowed; modifying it once it exists is not.',
);
