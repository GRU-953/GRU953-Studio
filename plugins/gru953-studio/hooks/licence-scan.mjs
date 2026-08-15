#!/usr/bin/env node
//
// licence-scan.mjs — GRU953-Studio dependency-licence scan.
// Zero dependencies (Node stdlib only). Run explicitly by the
// Security & Compliance Auditor as a required, blocking step before every
// Publish gate (Gold Standard plan §9-§10) — NOT wired into hooks.json,
// because "have dependencies been installed yet" cannot be judged reliably
// from a single Bash command the way a push can. The publish-github skill
// documents this as a mandatory manual step instead.
//
// Scope (stated honestly, not silently): this checks the LICENSE metadata
// already present in installed dependency folders. It cannot invent licence
// data for ecosystems with nothing installed yet — in that case it reports
// "not checked" for that ecosystem rather than a false pass, and the
// project must not be published until every present ecosystem has been
// installed and re-scanned clean.
//
// Usage: node licence-scan.mjs [projectRoot]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ALLOWED = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'Python-2.0',
  'BlueOak-1.0.0',
  'WTFPL',
]);
// Licences that require sharing your own source back ("copyleft") — these
// conflict with this project's own licence (Polyform Noncommercial +
// separate paid commercial licence) and are always flagged, never
// allow-listed.
const FLAG_SUBSTRINGS = ['GPL', 'AGPL', 'LGPL', 'MPL', 'EPL', 'CDDL', 'SSPL', 'CPAL'];

function isAllowed(licenceStr) {
  if (!licenceStr) return null; // unknown — reported, not silently passed
  const s = String(licenceStr).trim();
  if (ALLOWED.has(s)) return true;
  if (FLAG_SUBSTRINGS.some((f) => s.toUpperCase().includes(f))) return false;
  // 2026-07-26 audit finding 2 (found while making licence-scan.mjs recursive
  // and finally scanning it against this repo's own real npm packages): a
  // compound SPDX expression such as "(MIT OR CC0-1.0)" — a real, fully
  // permissive licence choice — was reported "needs-review" here, because
  // this function only ever compared the WHOLE string against the flat
  // ALLOWED set, never parsing it as an expression the way
  // classifySpdxExpr() below already does for Dart/Cargo/Maven. Delegate to
  // the same parser for any string that looks like a compound expression,
  // so an npm package doesn't get a worse answer than a Dart one for
  // identical licence text.
  if (/[()]|\bOR\b|\bAND\b/i.test(s)) {
    const parsed = classifySpdxExpr(s);
    if (parsed !== null) return parsed;
  }
  return null; // present but not recognised — needs a human look
}

// 2026-07-25: Lockfile-based scanning for all ecosystems.
// When lockfiles are present, we can scan without requiring full install.
// Falls back to installed-deps scanning when lockfiles not available.

// ---- npm (Node.js) ----
function scanNode(root) {
  const nm = path.join(root, 'node_modules');
  // Check package-lock.json / npm-shrinkwrap.json for lockfile-based scanning
  const lockFile = fs.existsSync(path.join(root, 'package-lock.json'))
    ? path.join(root, 'package-lock.json')
    : fs.existsSync(path.join(root, 'npm-shrinkwrap.json'))
      ? path.join(root, 'npm-shrinkwrap.json')
      : null;

  // If lockfile exists and node_modules doesn't, use lockfile
  if (!fs.existsSync(nm) && lockFile) {
    return scanNodeFromLockfile(root, lockFile);
  }

  // Otherwise use node_modules (existing logic) but also check lockfile for
  // packages that might not be in node_modules (e.g., optional deps)
  const nodeModulesResult = fs.existsSync(nm)
    ? scanNodeFromNodeModules(root)
    : { ecosystem: 'npm', checked: false, findings: [] };

  if (lockFile) {
    const lockResult = scanNodeFromLockfile(root, lockFile);
    return mergeNodeFindings(nodeModulesResult, lockResult);
  }
  return nodeModulesResult;
}

function scanNodeFromNodeModules(root) {
  const nm = path.join(root, 'node_modules');
  const findings = [];
  const dirs = fs.readdirSync(nm, { withFileTypes: true });
  const pkgDirs = [];
  const isDirLike = (dirent, full) => {
    if (dirent.isDirectory()) return true;
    if (dirent.isSymbolicLink()) {
      try {
        return fs.statSync(full).isDirectory();
      } catch {
        return false;
      }
    }
    return false;
  };
  for (const d of dirs) {
    if (!isDirLike(d, path.join(nm, d.name))) continue;
    if (d.name.startsWith('@')) {
      const scoped = fs.readdirSync(path.join(nm, d.name), { withFileTypes: true });
      for (const s of scoped)
        if (isDirLike(s, path.join(nm, d.name, s.name))) pkgDirs.push(path.join(d.name, s.name));
    } else if (d.name.startsWith('.') || d.name.startsWith('_')) {
      continue;
    } else {
      pkgDirs.push(d.name);
    }
  }
  for (const p of pkgDirs) {
    const pkgJsonPath = path.join(nm, p, 'package.json');
    let licence = null;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      licence =
        typeof pkg.license === 'string' ? pkg.license : (pkg.license && pkg.license.type) || null;
    } catch {
      findings.push({
        package: p,
        licence: 'unreadable (missing or invalid package.json)',
        verdict: 'needs-review',
      });
      continue;
    }
    const verdict = isAllowed(licence);
    if (verdict === false) findings.push({ package: p, licence, verdict: 'blocked' });
    else if (verdict === null)
      findings.push({ package: p, licence: licence || 'unknown', verdict: 'needs-review' });
  }

  // 2026-08-13 (reproduced by execution — see
  // test/repro/phase1-gate-honesty.mjs case P9). This returned `checked: true`
  // unconditionally, purely because a node_modules DIRECTORY existed. So a
  // project declaring `"dependencies": {"some-copyleft-lib": "^3.0.0"}` beside an
  // EMPTY node_modules and no lockfile examined zero packages and reported
  // `{"status":"clean"}`. A pruned or `--production` install silently narrowed
  // the scan the same way, with no signal at all.
  //
  // This file already states the governing principle for exactly this situation:
  // "node_modules is an install-artefact that is routinely not present/committed
  // and can itself be stale, so it can never paper over a lockfile we failed to
  // read. Any unchecked side now keeps the whole npm result honest." An empty or
  // partial node_modules IS that stale artefact.
  //
  // So the declared dependency set is now cross-checked against what was actually
  // resolved on disk. Anything declared but not found makes the result
  // `checked: false`, which the caller turns into INCOMPLETE rather than a pass.
  // devDependencies are deliberately included: a copyleft dev dependency still
  // ships in a source-available release and still needs review.
  const resolved = new Set(pkgDirs.map((p) => p.split(path.sep).join('/')));
  let declared = [];
  try {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    // 2026-08-13, independent-review finding F10 (reproduced).
    // optionalDependencies were included here and made a legitimately-absent
    // platform-specific package a PERMANENT incomplete: `fsevents` is macOS-only,
    // so on Linux CI `npm ci` will never install it and the advice ("run npm ci
    // and re-scan") can never fix it. That is the "gate that cries wolf gets
    // routed around" failure this project's own changelog warns about, so optional
    // dependencies are excluded. devDependencies stay: a copyleft dev dependency
    // still ships in a source-available release and still needs review.
    declared = [
      ...Object.keys(rootPkg.dependencies || {}),
      ...Object.keys(rootPkg.devDependencies || {}),
    ];
  } catch {
    declared = []; // no readable root package.json — nothing to cross-check against
  }
  const unresolved = declared.filter((name) => !resolved.has(name));
  if (unresolved.length > 0) {
    return {
      ecosystem: 'npm',
      checked: false,
      findings,
      note:
        `package.json declares ${unresolved.length} dependenc${unresolved.length === 1 ? 'y' : 'ies'} that ` +
        `${unresolved.length === 1 ? 'is' : 'are'} not installed in node_modules, so ${unresolved.length === 1 ? 'its' : 'their'} ` +
        `licence could not be examined: ${unresolved.slice(0, 8).join(', ')}` +
        `${unresolved.length > 8 ? `, and ${unresolved.length - 8} more` : ''}. ` +
        `Run \`npm ci\` (or \`npm install\`) and re-scan — an empty or pruned node_modules must never read as a clean pass.`,
    };
  }
  return { ecosystem: 'npm', checked: true, findings };
}

function scanNodeFromLockfile(root, lockFilePath) {
  try {
    const lockContent = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
    const findings = [];
    // 2026-07-26, found during a further pass over licence-scan.mjs. This
    // defaulted straight to `{}` whenever `packages` was absent, and then
    // returned `checked: true` regardless — so a lockfileVersion 1
    // package-lock.json (npm 5/6, which nests dependencies under
    // `dependencies` rather than the flat `packages` map npm 7+ introduced)
    // silently examined ZERO packages while still reporting a full pass.
    // Reproduced: a v1-shaped lockfile recording a real GPL dependency
    // returned {"status":"clean"}.
    //
    // v1 lockfiles also don't reliably carry per-package licence data even
    // once the tree is walked (that only became a lockfile field with the v2/v3
    // "packages" format), so rather than build a nested-tree walker for data
    // that usually isn't there, this is now an honest "not checked": it joins
    // this file's other disclosed gaps (Python venvs, Maven/Gradle, C++, Swift,
    // .NET, Go) and turns the overall verdict into INCOMPLETE rather than a
    // false clean.
    if (!lockContent.packages || typeof lockContent.packages !== 'object') {
      return {
        ecosystem: 'npm',
        checked: false,
        findings: [],
        note: `${path.basename(lockFilePath)} has no "packages" map (lockfileVersion ${lockContent.lockfileVersion ?? '1 or unknown'}) — npm lockfiles older than v2 don't reliably record per-package licences; run \`npm install\` and re-scan, or review dependency licences manually before publish`,
      };
    }
    const packages = lockContent.packages;

    for (const [pkgPath, pkgInfo] of Object.entries(packages)) {
      if (pkgPath === '' || pkgPath === '.') continue; // Skip root package
      const name = pkgPath.replace(/^node_modules\//, '');
      const licence = pkgInfo.license || pkgInfo.licenses?.[0]?.type || null;
      const verdict = isAllowed(licence);
      if (verdict === false) findings.push({ package: name, licence, verdict: 'blocked' });
      else if (verdict === null)
        findings.push({ package: name, licence: licence || 'unknown', verdict: 'needs-review' });
    }
    return { ecosystem: 'npm', checked: true, findings };
  } catch {
    return { ecosystem: 'npm', checked: false, findings: [], note: 'Failed to parse lockfile' };
  }
}

function mergeNodeFindings(a, b) {
  // 2026-08-05 further-pass audit fix (found by execution): this used to
  // `return a` whenever the LOCKFILE scan was unchecked, discarding its
  // `checked: false` + "Failed to parse lockfile" note entirely — so a
  // corrupt package-lock.json next to a real node_modules reported clean
  // (reproduced by execution), while the same corrupt lockfile WITHOUT
  // node_modules correctly reported INCOMPLETE. node_modules is an
  // install-artefact that is routinely not present/committed and can itself
  // be stale, so it can never paper over a lockfile we failed to read. Any
  // unchecked side now keeps the whole npm result honest: still-notChecked
  // (INCOMPLETE), still carrying the checked side's findings (so a blocked
  // package is still BLOCKED — the caller checks blocked before notChecked)
  // and the unchecked side's note surfaced to the person reading the report.
  if (!a.checked || !b.checked) {
    const note = [a.note, b.note].filter(Boolean).join('; ');
    return {
      ecosystem: 'npm',
      checked: false,
      findings: a.checked ? a.findings : b.findings,
      note,
    };
  }
  const merged = new Map();
  for (const f of [...a.findings, ...b.findings]) {
    const existing = merged.get(f.package);
    if (!existing || severityRank(f.verdict) > severityRank(existing.verdict)) {
      merged.set(f.package, f);
    }
  }
  return { ecosystem: 'npm', checked: true, findings: Array.from(merged.values()) };
}

function severityRank(v) {
  if (v === 'blocked') return 3;
  if (v === 'needs-review') return 2;
  return 1;
}

// ---- Python (pip/poetry/pipenv/uv) ----
function scanPython(root) {
  // Try pip-licenses first (most reliable)
  try {
    const raw = execFileSync(
      resolveExecutable('pip-licenses'),
      ['--format=json', '--with-license-file'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 60_000,
      },
    );
    const pkgs = JSON.parse(raw);
    const findings = [];
    for (const pkg of pkgs) {
      const licence = pkg.License || pkg.LicenseFile || null;
      const verdict = isAllowed(licence);
      if (verdict === false) findings.push({ package: pkg.Name, licence, verdict: 'blocked' });
      else if (verdict === null)
        findings.push({
          package: pkg.Name,
          licence: licence || 'unknown',
          verdict: 'needs-review',
        });
    }
    return { ecosystem: 'python', checked: true, findings };
  } catch {
    // Fallback: check for lockfiles
    const lockFiles = ['poetry.lock', 'Pipfile.lock', 'uv.lock', 'requirements-lock.txt'];
    for (const lf of lockFiles) {
      const lockPath = path.join(root, lf);
      if (fs.existsSync(lockPath)) {
        return {
          ecosystem: 'python',
          checked: false,
          findings: [],
          note: `Found ${lf} — run \`pip-licenses\` or equivalent to review licences before publish`,
        };
      }
    }
    // No lockfile, check for venv
    const candidates = ['.venv', 'venv', 'env'].map((v) => path.join(root, v));
    let sitePackages = null;
    for (const c of candidates) {
      const guess = path.join(c, 'lib');
      if (fs.existsSync(guess)) {
        sitePackages = guess;
        break;
      }
    }
    if (!sitePackages) return { ecosystem: 'python', checked: false, findings: [] };
    return {
      ecosystem: 'python',
      checked: false,
      findings: [],
      note: 'venv found but not deeply scanned — run pip-licenses manually and review before publish',
    };
  }
}

// ---- Dart/Flutter (pub.dev) ----
export function detectLicenceFromText(text) {
  if (!text) return null;
  const t = text.toUpperCase();

  if (t.includes('GNU LESSER GENERAL PUBLIC LICENSE')) return { spdx: 'LGPL', allowed: false };
  if (t.includes('GNU AFFERO GENERAL PUBLIC LICENSE')) return { spdx: 'AGPL', allowed: false };
  if (t.includes('GNU GENERAL PUBLIC LICENSE')) return { spdx: 'GPL', allowed: false };
  if (t.includes('MOZILLA PUBLIC LICENSE')) return { spdx: 'MPL', allowed: false };
  if (t.includes('ECLIPSE PUBLIC LICENSE')) return { spdx: 'EPL', allowed: false };
  if (t.includes('SERVER SIDE PUBLIC LICENSE')) return { spdx: 'SSPL', allowed: false };

  if (t.includes('MIT LICENSE')) return { spdx: 'MIT', allowed: true };
  if (t.includes('APACHE LICENSE') && t.includes('VERSION 2.0'))
    return { spdx: 'Apache-2.0', allowed: true };
  if (
    t.includes('REDISTRIBUTION AND USE') &&
    t.includes('BINARY FORM') &&
    t.includes('NEITHER THE NAME')
  ) {
    return { spdx: 'BSD-3-Clause', allowed: true };
  }
  if (t.includes('REDISTRIBUTION AND USE') && t.includes('BINARY FORM')) {
    return { spdx: 'BSD-2-Clause', allowed: true };
  }
  if (t.includes('THIS IS FREE AND UNENCUMBERED SOFTWARE'))
    return { spdx: 'Unlicense', allowed: true };
  if (t.includes('CC0')) return { spdx: 'CC0-1.0', allowed: true };
  if (t.includes('ISC LICENSE')) return { spdx: 'ISC', allowed: true };

  return null;
}

// 2026-07-26 audit finding 8. execFileSync() runs the named program directly
// (no shell), which on Windows does not reliably search PATHEXT the way a
// shell invocation does — a tool installed as a `.cmd` or `.bat` shim (which
// is how pip and several other installers wrap a console entry point on
// Windows) is not found by its bare name, and the whole ecosystem silently
// degraded to "not checked" as a result.
//
// This resolves the real executable path — including its extension — before
// handing it to execFileSync, so the actual binary being launched is never in
// question. platform/pathEnv/pathExtEnv are parameters (defaulting to the
// real environment) specifically so this can be unit-tested on any OS: the
// algorithm itself (walking PATH x PATHEXT, checking the filesystem) is
// exercised directly and verified by execution, even though the real Windows
// spawn behaviour this defends against can only be proven by the Windows leg
// of the CI matrix, not by a Linux sandbox.
export function resolveExecutable(
  name,
  platform = process.platform,
  pathEnv = process.env.PATH || '',
  pathExtEnv = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
) {
  if (platform !== 'win32') return name;
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const exts = pathExtEnv.split(';').filter(Boolean);
  // Candidates compared case-INSENSITIVELY on purpose: real Windows
  // filesystems fold case, but relying on that here would mean this
  // algorithm's correctness could only ever be checked by actually running
  // on Windows. Doing the case-folding ourselves makes the logic verifiably
  // correct by execution on any OS, matching real Windows behaviour exactly
  // rather than merely being untestable in the same way it is.
  const wanted = new Set([name.toLowerCase(), ...exts.map((ext) => (name + ext).toLowerCase())]);
  for (const dir of dirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // dir doesn't exist or isn't readable — keep looking elsewhere
    }
    for (const entry of entries) {
      if (!wanted.has(entry.name.toLowerCase())) continue;
      const full = path.join(dir, entry.name);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {
        // vanished between readdir and stat, or a broken symlink — keep looking
      }
    }
  }
  return name; // not found anywhere; let execFileSync fail with its own ENOENT
}

export function findPubCacheRoot() {
  if (process.env.PUB_CACHE) return process.env.PUB_CACHE;
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'Pub', 'Cache');
  }
  return path.join(os.homedir(), '.pub-cache');
}

// A package with no cache entry to inspect (git/path sourced, or the project's
// own root package) is surfaced as needs-review rather than silently dropped.
// `source: 'root'` (the project's own package, always present in a real
// `dart pub deps --json` result) is deliberately excluded — flagging a
// project's own package as needing a licence review on every single scan
// would be a self-inflicted false positive on every Dart project, not a real
// finding.
export function classifyNonHostedDartPackages(packages) {
  const findings = [];
  for (const pkg of packages || []) {
    if (!pkg || pkg.source === 'hosted' || pkg.source === 'root') continue;
    findings.push({
      package: pkg.name,
      licence: `unchecked (${pkg.source || 'non-hosted'} source — no pub.dev cache entry to inspect)`,
      verdict: 'needs-review',
    });
  }
  return findings;
}

function scanDartFlutter(root) {
  let parsed;
  try {
    const raw = execFileSync(resolveExecutable('dart'), ['pub', 'deps', '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    });
    parsed = JSON.parse(raw);
  } catch {
    return {
      ecosystem: 'dart/flutter',
      checked: false,
      findings: [],
      note: 'could not run `dart pub deps --json` (Dart SDK not on PATH, or pub deps failed) — run it manually and review each package licence before publish',
    };
  }

  const pubCacheRoot = findPubCacheRoot();
  const findings = [];
  const allPackages = parsed.packages || [];
  const hostedPackages = allPackages.filter((p) => p.source === 'hosted');
  // 2026-07-26, found during a further pass over licence-scan.mjs. Git- or
  // path-sourced packages (very ordinary for Dart — forked packages, private
  // plugins) were filtered out here and never looked at again, yet the
  // function still returned checked:true unconditionally at the bottom.
  // Reproduced: a git-sourced GPL-licensed package never appeared anywhere in
  // the output — not blocked, not flagged for review — while the ecosystem
  // reported clean. There is no reliable LICENSE-file convention for a
  // git/path source the way there is for the hosted pub.dev cache layout, so
  // rather than guess, each is surfaced as needs-review — honest uncertainty,
  // not silent omission. Extracted to its own exported function so it can be
  // unit-tested directly, matching this file's existing, deliberate rationale
  // for testing detectLicenceFromText() in isolation rather than faking a
  // `dart pub deps --json` end-to-end run (see the test file for why).
  findings.push(...classifyNonHostedDartPackages(allPackages));

  for (const pkg of hostedPackages) {
    const pkgDir = path.join(pubCacheRoot, 'hosted', 'pub.dev', `${pkg.name}-${pkg.version}`);
    const licenceFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt']
      .map((f) => path.join(pkgDir, f))
      .find((f) => fs.existsSync(f));

    if (!licenceFile) {
      findings.push({
        package: pkg.name,
        licence: 'unreadable (no LICENSE file found in pub cache)',
        verdict: 'needs-review',
      });
      continue;
    }

    let text;
    try {
      text = fs.readFileSync(licenceFile, 'utf8');
    } catch {
      findings.push({
        package: pkg.name,
        licence: 'unreadable (LICENSE file exists but could not be read)',
        verdict: 'needs-review',
      });
      continue;
    }

    const detected = detectLicenceFromText(text);
    if (detected === null) {
      findings.push({
        package: pkg.name,
        licence: 'unrecognised licence text',
        verdict: 'needs-review',
      });
    } else if (detected.allowed === false) {
      findings.push({ package: pkg.name, licence: detected.spdx, verdict: 'blocked' });
    }
  }

  return { ecosystem: 'dart/flutter', checked: true, findings };
}

// ---- SPDX expression classifier (for Cargo, Maven, etc.) ----
export function classifySpdxExpr(expr) {
  if (!expr) return null;
  const tokens = String(expr)
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const AND = (a, b) =>
    a === false || b === false ? false : a === true && b === true ? true : null;
  const OR = (a, b) =>
    a === true || b === true ? true : a === false && b === false ? false : null;
  const classifyId = (id, withExc) => {
    const up = (id + (withExc ? ' WITH ' + withExc : '')).toUpperCase();
    if (FLAG_SUBSTRINGS.some((f) => up.includes(f))) return false;
    return ALLOWED.has(id) ? true : null;
  };
  const parseOr = () => {
    let v = parseAnd();
    while (peek() && /^OR$/i.test(peek())) {
      pos++;
      v = OR(v, parseAnd());
    }
    return v;
  };
  function parseAnd() {
    let v = parseFactor();
    while (peek() && /^AND$/i.test(peek())) {
      pos++;
      v = AND(v, parseFactor());
    }
    return v;
  }
  function parseFactor() {
    if (peek() === '(') {
      pos++;
      const v = parseOr();
      if (peek() === ')') pos++;
      return v;
    }
    const id = tokens[pos++];
    if (id === undefined) return null;
    let withExc;
    if (peek() && /^WITH$/i.test(peek())) {
      pos++;
      withExc = tokens[pos++];
    }
    return classifyId(id, withExc);
  }
  const result = parseOr();
  return result === undefined ? null : result;
}

// ---- Rust (Cargo) ----
function scanCargo(root) {
  let parsed;
  try {
    const raw = execFileSync(resolveExecutable('cargo'), ['metadata', '--format-version', '1'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
    });
    parsed = JSON.parse(raw);
  } catch {
    return {
      ecosystem: 'rust/cargo',
      checked: false,
      findings: [],
      note: 'could not run `cargo metadata` (cargo not on PATH, or resolve failed) — run it and review each crate licence, or use `cargo deny check`, before publish',
    };
  }
  const findings = [];
  const members = new Set(parsed.workspace_members || []);
  for (const pkg of parsed.packages || []) {
    if (members.has(pkg.id)) continue;
    const licence = pkg.license || null;
    if (licence) {
      const verdict = classifySpdxExpr(licence);
      if (verdict === false)
        findings.push({ package: `${pkg.name}@${pkg.version}`, licence, verdict: 'blocked' });
      else if (verdict === null)
        findings.push({ package: `${pkg.name}@${pkg.version}`, licence, verdict: 'needs-review' });
    } else {
      findings.push({
        package: `${pkg.name}@${pkg.version}`,
        licence: pkg.license_file
          ? 'license-file only (no SPDX field)'
          : 'unknown (no license field)',
        verdict: 'needs-review',
      });
    }
  }
  return { ecosystem: 'rust/cargo', checked: true, findings };
}

// ---- JVM (Maven/Gradle) ----
function scanJvm(root, kind) {
  // Check for lockfiles
  // 2026-07-26 audit finding 34: 'gradle.lockfile' was listed twice here,
  // harmlessly (checking the same real file twice costs nothing) but wrong —
  // corrected to the two distinct real Gradle lockfile names.
  const lockFiles = kind === 'java/maven' ? ['pom.xml'] : ['gradle.lockfile', 'build.gradle.lock'];
  for (const lf of lockFiles) {
    if (fs.existsSync(path.join(root, lf))) {
      return {
        ecosystem: kind,
        checked: false,
        findings: [],
        note: `Found ${lf} — run maven/gradle license plugin to review licences before publish`,
      };
    }
  }
  return {
    ecosystem: kind,
    checked: false,
    findings: [],
    note: `${kind} project detected — dependency licences need the ecosystem's own report (e.g. \`mvn license:aggregate-third-party-report\` or a Gradle licence plugin, plus \`mvn dependency:tree\`/\`gradle dependencies\`); run it and review before publish`,
  };
}

// ---- C++ (vcpkg/Conan) ----
function scanCpp(root) {
  const lockFiles = ['vcpkg.json', 'vcpkg-configuration.json', 'conan.lock', 'conanfile.lock'];
  for (const lf of lockFiles) {
    if (fs.existsSync(path.join(root, lf))) {
      return {
        ecosystem: 'c++',
        checked: false,
        findings: [],
        note: `Found ${lf} — run vcpkg/conan license check manually before publish`,
      };
    }
  }
  return {
    ecosystem: 'c++',
    checked: false,
    findings: [],
    note: 'C++ project detected — dependency/vendored licences have no single canonical manifest; review vcpkg/Conan and any vendored third-party licences manually before publish',
  };
}

// ---- Swift (SwiftPM) ----
function scanSwift(root) {
  if (fs.existsSync(path.join(root, 'Package.resolved'))) {
    return {
      ecosystem: 'swift/spm',
      checked: false,
      findings: [],
      note: 'Found Package.resolved — run swift package show-dependencies and review each licence before publish',
    };
  }
  return {
    ecosystem: 'swift/spm',
    checked: false,
    findings: [],
    note: 'Swift package project detected — SwiftPM dependency licences need a manual review (Package.resolved lists the packages; check each licence) before publish',
  };
}

// ---- .NET (NuGet) ----
function scanDotnet(root) {
  if (fs.existsSync(path.join(root, 'packages.lock.json'))) {
    return {
      ecosystem: '.net/nuget',
      checked: false,
      findings: [],
      note: 'Found packages.lock.json — run `dotnet list package --include-transitive` and review NuGet licences before publish',
    };
  }
  return {
    ecosystem: '.net/nuget',
    checked: false,
    findings: [],
    note: '.NET project detected — run `dotnet list package` and review NuGet licences before publish',
  };
}

// ---- Go (modules) ----
function scanGo(root) {
  if (fs.existsSync(path.join(root, 'go.sum'))) {
    return {
      ecosystem: 'go/modules',
      checked: false,
      findings: [],
      note: 'Found go.sum — run `go list -m all` (or `go-licenses`) and review module licences before publish',
    };
  }
  return {
    ecosystem: 'go/modules',
    checked: false,
    findings: [],
    note: 'Go module project detected — run `go list -m all` (or `go-licenses`) and review module licences before publish',
  };
}

// 2026-07-26 audit finding 2 (the vacuity this whole document opens with).
// main() used to check ONLY the given root directory for a manifest — on
// this very repository, every real manifest lives one level down
// (clients/cli/package.json, clients/antigravity/package.json,
// clients/vscode/package.json, plus the former plugins/gru953-studio/
// package.json), so this reported "no recognised dependency manifests
// found" while the repo held four manifests and a lockfile with 93
// resolved packages — reproduced directly, and true of any nested project
// layout, not just this one (a Flutter app's android/, a monorepo's web/).
//
// Fixed with a bounded recursive walk rather than a full .gitignore parser:
// this project's own established discipline is closing the concrete case
// found, not building a general grammar engine for one gate (the same
// reasoning behind the push-safety matcher and the docs-consistency
// checks elsewhere in this repo). SKIP_DIR_NAMES excludes each
// ecosystem's own dependency tree — those are scanned BY that ecosystem's
// scanner already; walking into node_modules/ etc. as if it were a second
// project would multiply spurious "project" directories and duplicate
// every finding. MAX_DEPTH bounds the walk so a pathological tree (or a
// symlink cycle — real directories are walked by name, never followed as
// symlinks) cannot make this run away.
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'Dev-Memory',
  'out',
  'dist',
  'build',
  'coverage',
  '.vscode-test',
  '.dart_tool',
  'target',
  '.gradle',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  'Pods',
  'DerivedData',
]);
const MAX_WALK_DEPTH = 6;
const MANIFEST_FILE_NAMES = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'Pipfile.lock',
  'pubspec.yaml',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'vcpkg.json',
  'conanfile.txt',
  'conanfile.py',
  'CMakeLists.txt',
  'Package.swift',
  'Package.resolved',
  'packages.lock.json',
  'go.mod',
];
function dirEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
function hasAnyManifest(dir, entries) {
  const names = entries.map((e) => e.name);
  if (MANIFEST_FILE_NAMES.some((n) => names.includes(n))) return true;
  return names.some((n) => n.endsWith('.csproj') || n.endsWith('.sln'));
}
export function findManifestDirs(root) {
  const found = [];
  function walk(dir, depth) {
    const entries = dirEntries(dir);
    // A file path (not a directory) as root, or an unreadable one, yields
    // no entries and no manifests — reported the same as any other empty
    // directory, never a crash (2026-07-21 Round 4 fix, preserved).
    if (entries.length > 0 || fs.existsSync(dir)) {
      if (hasAnyManifest(dir, entries)) found.push(dir);
    }
    if (depth >= MAX_WALK_DEPTH) return;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (SKIP_DIR_NAMES.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  }
  walk(root, 0);
  return found;
}

// Runs the same per-ecosystem detection this file has always used, just
// against ONE candidate directory rather than assuming it's the only one —
// unchanged logic, now callable at every directory findManifestDirs() found.
function scanOneDirectory(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  const hasPackageJson = has('package.json');
  // 2026-07-26 further-pass audit fix (false-green, confirmed by execution):
  // this gate never checked for Pipenv's own manifest/lockfile, even though
  // scanPython() below already explicitly knows about `Pipfile.lock` as a
  // lockfile fallback — that fallback was simply never reachable for a
  // Pipenv-only project (no requirements.txt/pyproject.toml at all), so
  // Python never appeared as an entry in `results` at all. Reproduced: a
  // directory with only Pipfile/Pipfile.lock (holding a real copyleft
  // dependency) returned {"status":"clean","results":[]} — worse than the
  // disclosed "notChecked" pattern used everywhere else in this file, since
  // there was no entry at all to alert a human.
  const hasRequirements =
    has('requirements.txt') || has('pyproject.toml') || has('Pipfile') || has('Pipfile.lock');
  const hasPubspec = has('pubspec.yaml');
  const hasCargo = has('Cargo.toml');
  const hasMaven = has('pom.xml');
  const hasGradle =
    has('build.gradle') ||
    has('build.gradle.kts') ||
    has('settings.gradle') ||
    has('settings.gradle.kts');
  const hasCpp =
    has('vcpkg.json') || has('conanfile.txt') || has('conanfile.py') || has('CMakeLists.txt');
  const hasSwift = has('Package.swift') || has('Package.resolved');
  const hasDotnet =
    dirEntries(dir).some((e) => e.name.endsWith('.csproj') || e.name.endsWith('.sln')) ||
    has('packages.lock.json');
  const hasGo = has('go.mod');

  const dirResults = [];
  if (hasPackageJson) dirResults.push(scanNode(dir));
  if (hasRequirements) dirResults.push(scanPython(dir));
  if (hasPubspec) dirResults.push(scanDartFlutter(dir));
  if (hasCargo) dirResults.push(scanCargo(dir));
  if (hasMaven || hasGradle) dirResults.push(scanJvm(dir, hasMaven ? 'java/maven' : 'jvm/gradle'));
  if (hasCpp) dirResults.push(scanCpp(dir));
  if (hasSwift) dirResults.push(scanSwift(dir));
  if (hasDotnet) dirResults.push(scanDotnet(dir));
  if (hasGo) dirResults.push(scanGo(dir));
  return dirResults;
}

function main() {
  const root = process.argv[2] || process.cwd();

  // 2026-08-15, finding X115 (High, reproduced). findManifestDirs() on a directory that
  // does not exist returns nothing, and "nothing found" fell through to the clean report
  // at the bottom of this function — so pointing this scanner at a path that is not
  // there produced `{"status":"clean"}` and exit 0. A licence scan that never ran read
  // as a licence scan that passed.
  //
  // The distinction that matters: a real directory with genuinely NO dependency
  // manifests is legitimately clean — this plugin itself has none, and that must keep
  // passing. What must fail is being unable to look at all. The reproduction at
  // hooks/test/repro/X113-X115-X118-absent-input.mjs holds both sides.
  let rootIsDirectory = false;
  try {
    rootIsDirectory = fs.statSync(root).isDirectory();
  } catch {
    rootIsDirectory = false;
  }
  if (!rootIsDirectory) {
    console.log(
      JSON.stringify(
        {
          status: 'BLOCKED',
          reason: `cannot scan ${root} — it does not exist or is not a directory, so no licence conclusion can be drawn about it (finding X115)`,
          results: [],
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const manifestDirs = findManifestDirs(root);

  const results = [];
  for (const dir of manifestDirs) {
    const rel = path.relative(root, dir) || '.';
    for (const r of scanOneDirectory(dir)) results.push({ ...r, dir: rel });
  }

  if (results.length === 0) {
    console.log(
      JSON.stringify(
        { status: 'clean', reason: 'no recognised dependency manifests found', results: [] },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const blocked = results.flatMap((r) => r.findings.filter((f) => f.verdict === 'blocked'));
  const needsReview = results.flatMap((r) =>
    r.findings.filter((f) => f.verdict === 'needs-review'),
  );
  const notChecked = results.filter((r) => !r.checked);

  const output = { results, blocked, needsReview, notChecked };

  if (blocked.length > 0) {
    console.log(JSON.stringify({ status: 'BLOCKED', ...output }, null, 2));
    process.exit(1);
  }
  if (notChecked.length > 0) {
    console.log(
      JSON.stringify(
        {
          status: 'INCOMPLETE — install dependencies for every ecosystem present, then re-run',
          ...output,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (needsReview.length > 0) {
    console.log(
      JSON.stringify(
        {
          status:
            'NEEDS HUMAN REVIEW — unrecognised licence strings found, ask the user before publishing',
          ...output,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  console.log(JSON.stringify({ status: 'clean', ...output }, null, 2));
  process.exit(0);
}

// 2026-07-26 audit finding 3 (MAJOR — a gate that silently passes). This used
// to compare `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])`
// as plain strings. On Windows, the drive letter can legitimately differ in
// case between how Node resolved the module (`import.meta.url`) and how the
// caller typed the invocation (`node C:\repo\...` vs `node c:\repo\...`) —
// those are the SAME file, but the raw strings don't match, so `main()` was
// never called: the script exited 0 having printed nothing. A licence gate
// that silently does nothing is the worst possible failure mode for a check
// whose entire job is to block a bad publish.
//
// Fixed by comparing REALPATHS (via the native syscall, which resolves
// filesystem case on a case-insensitive volume — the same technique already
// used for temp-dir resolution in the test harness, for the equivalent macOS
// symlink issue) rather than raw strings, so a case or symlink difference that
// still points at the identical file no longer breaks the comparison. Falls
// back to the original string comparison if either path can't be resolved
// (e.g. a genuinely different/nonexistent file), so a real mismatch still
// correctly skips `main()` rather than throwing.
//
// This specific Windows drive-letter scenario could not be executed on this
// Linux sandbox — real path semantics differ per platform and can't be
// faked with string tests. The Windows leg of the CI matrix added in this
// same change is what actually proves this guard fires there; the ordinary
// same-platform invocation is covered by a portable test below, which passes
// identically on every OS this runs on.
function isDirectlyInvoked() {
  if (!process.argv[1]) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync.native(modulePath) === fs.realpathSync.native(process.argv[1]);
  } catch {
    return modulePath === path.resolve(process.argv[1]);
  }
}

if (isDirectlyInvoked()) {
  main();
}
