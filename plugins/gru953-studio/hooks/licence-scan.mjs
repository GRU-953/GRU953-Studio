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
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD',
  'Unlicense', 'CC0-1.0', 'Python-2.0', 'BlueOak-1.0.0', 'WTFPL'
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
    : (fs.existsSync(path.join(root, 'npm-shrinkwrap.json'))
      ? path.join(root, 'npm-shrinkwrap.json')
      : null);

  // If lockfile exists and node_modules doesn't, use lockfile
  if (!fs.existsSync(nm) && lockFile) {
    return scanNodeFromLockfile(root, lockFile);
  }

  // Otherwise use node_modules (existing logic) but also check lockfile for
  // packages that might not be in node_modules (e.g., optional deps)
  const nodeModulesResult = fs.existsSync(nm) ? scanNodeFromNodeModules(root) : { ecosystem: 'npm', checked: false, findings: [] };
  
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
    if (dirent.isSymbolicLink()) { try { return fs.statSync(full).isDirectory(); } catch { return false; } }
    return false;
  };
  for (const d of dirs) {
    if (!isDirLike(d, path.join(nm, d.name))) continue;
    if (d.name.startsWith('@')) {
      const scoped = fs.readdirSync(path.join(nm, d.name), { withFileTypes: true });
      for (const s of scoped) if (isDirLike(s, path.join(nm, d.name, s.name))) pkgDirs.push(path.join(d.name, s.name));
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
      licence = typeof pkg.license === 'string' ? pkg.license : (pkg.license && pkg.license.type) || null;
    } catch {
      findings.push({ package: p, licence: 'unreadable (missing or invalid package.json)', verdict: 'needs-review' });
      continue;
    }
    const verdict = isAllowed(licence);
    if (verdict === false) findings.push({ package: p, licence, verdict: 'blocked' });
    else if (verdict === null) findings.push({ package: p, licence: licence || 'unknown', verdict: 'needs-review' });
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
        ecosystem: 'npm', checked: false, findings: [],
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
      else if (verdict === null) findings.push({ package: name, licence: licence || 'unknown', verdict: 'needs-review' });
    }
    return { ecosystem: 'npm', checked: true, findings };
  } catch {
    return { ecosystem: 'npm', checked: false, findings: [], note: 'Failed to parse lockfile' };
  }
}

function mergeNodeFindings(a, b) {
  if (!a.checked) return b;
  if (!b.checked) return a;
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
    const raw = execFileSync('pip-licenses', ['--format=json', '--with-license-file'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000,
    });
    const pkgs = JSON.parse(raw);
    const findings = [];
    for (const pkg of pkgs) {
      const licence = pkg.License || pkg.LicenseFile || null;
      const verdict = isAllowed(licence);
      if (verdict === false) findings.push({ package: pkg.Name, licence, verdict: 'blocked' });
      else if (verdict === null) findings.push({ package: pkg.Name, licence: licence || 'unknown', verdict: 'needs-review' });
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
          note: `Found ${lf} — run \`pip-licenses\` or equivalent to review licences before publish` 
        };
      }
    }
    // No lockfile, check for venv
    const candidates = ['.venv', 'venv', 'env'].map((v) => path.join(root, v));
    let sitePackages = null;
    for (const c of candidates) {
      const guess = path.join(c, 'lib');
      if (fs.existsSync(guess)) { sitePackages = guess; break; }
    }
    if (!sitePackages) return { ecosystem: 'python', checked: false, findings: [] };
    return { ecosystem: 'python', checked: false, findings: [], note: 'venv found but not deeply scanned — run pip-licenses manually and review before publish' };
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
  if (t.includes('APACHE LICENSE') && t.includes('VERSION 2.0')) return { spdx: 'Apache-2.0', allowed: true };
  if (t.includes('REDISTRIBUTION AND USE') && t.includes('BINARY FORM') && t.includes('NEITHER THE NAME')) {
    return { spdx: 'BSD-3-Clause', allowed: true };
  }
  if (t.includes('REDISTRIBUTION AND USE') && t.includes('BINARY FORM')) {
    return { spdx: 'BSD-2-Clause', allowed: true };
  }
  if (t.includes('THIS IS FREE AND UNENCUMBERED SOFTWARE')) return { spdx: 'Unlicense', allowed: true };
  if (t.includes('CC0')) return { spdx: 'CC0-1.0', allowed: true };
  if (t.includes('ISC LICENSE')) return { spdx: 'ISC', allowed: true };

  return null;
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
    const raw = execFileSync('dart', ['pub', 'deps', '--json'], {
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
      findings.push({ package: pkg.name, licence: 'unreadable (no LICENSE file found in pub cache)', verdict: 'needs-review' });
      continue;
    }

    let text;
    try {
      text = fs.readFileSync(licenceFile, 'utf8');
    } catch {
      findings.push({ package: pkg.name, licence: 'unreadable (LICENSE file exists but could not be read)', verdict: 'needs-review' });
      continue;
    }

    const detected = detectLicenceFromText(text);
    if (detected === null) {
      findings.push({ package: pkg.name, licence: 'unrecognised licence text', verdict: 'needs-review' });
    } else if (detected.allowed === false) {
      findings.push({ package: pkg.name, licence: detected.spdx, verdict: 'blocked' });
    }
  }

  return { ecosystem: 'dart/flutter', checked: true, findings };
}

// ---- SPDX expression classifier (for Cargo, Maven, etc.) ----
export function classifySpdxExpr(expr) {
  if (!expr) return null;
  const tokens = String(expr).replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const AND = (a, b) => (a === false || b === false) ? false : (a === true && b === true) ? true : null;
  const OR = (a, b) => (a === true || b === true) ? true : (a === false && b === false) ? false : null;
  const classifyId = (id, withExc) => {
    const up = (id + (withExc ? ' WITH ' + withExc : '')).toUpperCase();
    if (FLAG_SUBSTRINGS.some((f) => up.includes(f))) return false;
    return ALLOWED.has(id) ? true : null;
  };
  const parseOr = () => {
    let v = parseAnd();
    while (peek() && /^OR$/i.test(peek())) { pos++; v = OR(v, parseAnd()); }
    return v;
  };
  function parseAnd() {
    let v = parseFactor();
    while (peek() && /^AND$/i.test(peek())) { pos++; v = AND(v, parseFactor()); }
    return v;
  }
  function parseFactor() {
    if (peek() === '(') { pos++; const v = parseOr(); if (peek() === ')') pos++; return v; }
    const id = tokens[pos++];
    if (id === undefined) return null;
    let withExc;
    if (peek() && /^WITH$/i.test(peek())) { pos++; withExc = tokens[pos++]; }
    return classifyId(id, withExc);
  }
  const result = parseOr();
  return result === undefined ? null : result;
}

// ---- Rust (Cargo) ----
function scanCargo(root) {
  let parsed;
  try {
    const raw = execFileSync('cargo', ['metadata', '--format-version', '1'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000,
    });
    parsed = JSON.parse(raw);
  } catch {
    return { ecosystem: 'rust/cargo', checked: false, findings: [], note: 'could not run `cargo metadata` (cargo not on PATH, or resolve failed) — run it and review each crate licence, or use `cargo deny check`, before publish' };
  }
  const findings = [];
  const members = new Set(parsed.workspace_members || []);
  for (const pkg of parsed.packages || []) {
    if (members.has(pkg.id)) continue;
    const licence = pkg.license || null;
    if (licence) {
      const verdict = classifySpdxExpr(licence);
      if (verdict === false) findings.push({ package: `${pkg.name}@${pkg.version}`, licence, verdict: 'blocked' });
      else if (verdict === null) findings.push({ package: `${pkg.name}@${pkg.version}`, licence, verdict: 'needs-review' });
    } else {
      findings.push({ package: `${pkg.name}@${pkg.version}`, licence: pkg.license_file ? 'license-file only (no SPDX field)' : 'unknown (no license field)', verdict: 'needs-review' });
    }
  }
  return { ecosystem: 'rust/cargo', checked: true, findings };
}

// ---- JVM (Maven/Gradle) ----
function scanJvm(root, kind) {
  // Check for lockfiles
  const lockFiles = kind === 'java/maven' ? ['pom.xml'] : ['gradle.lockfile', 'gradle.lockfile', 'build.gradle.lock'];
  for (const lf of lockFiles) {
    if (fs.existsSync(path.join(root, lf))) {
      return { 
        ecosystem: kind, 
        checked: false, 
        findings: [], 
        note: `Found ${lf} — run maven/gradle license plugin to review licences before publish` 
      };
    }
  }
  return { ecosystem: kind, checked: false, findings: [], note: `${kind} project detected — dependency licences need the ecosystem's own report (e.g. \`mvn license:aggregate-third-party-report\` or a Gradle licence plugin, plus \`mvn dependency:tree\`/\`gradle dependencies\`); run it and review before publish` };
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
        note: `Found ${lf} — run vcpkg/conan license check manually before publish` 
      };
    }
  }
  return { ecosystem: 'c++', checked: false, findings: [], note: 'C++ project detected — dependency/vendored licences have no single canonical manifest; review vcpkg/Conan and any vendored third-party licences manually before publish' };
}

// ---- Swift (SwiftPM) ----
function scanSwift(root) {
  if (fs.existsSync(path.join(root, 'Package.resolved'))) {
    return { 
      ecosystem: 'swift/spm', 
      checked: false, 
      findings: [], 
      note: 'Found Package.resolved — run swift package show-dependencies and review each licence before publish' 
    };
  }
  return { ecosystem: 'swift/spm', checked: false, findings: [], note: 'Swift package project detected — SwiftPM dependency licences need a manual review (Package.resolved lists the packages; check each licence) before publish' };
}

// ---- .NET (NuGet) ----
function scanDotnet(root) {
  if (fs.existsSync(path.join(root, 'packages.lock.json'))) {
    return { 
      ecosystem: '.net/nuget', 
      checked: false, 
      findings: [], 
      note: 'Found packages.lock.json — run `dotnet list package --include-transitive` and review NuGet licences before publish' 
    };
  }
  return { ecosystem: '.net/nuget', checked: false, findings: [], note: '.NET project detected — run `dotnet list package` and review NuGet licences before publish' };
}

// ---- Go (modules) ----
function scanGo(root) {
  if (fs.existsSync(path.join(root, 'go.sum'))) {
    return { 
      ecosystem: 'go/modules', 
      checked: false, 
      findings: [], 
      note: 'Found go.sum — run `go list -m all` (or `go-licenses`) and review module licences before publish' 
    };
  }
  return { ecosystem: 'go/modules', checked: false, findings: [], note: 'Go module project detected — run `go list -m all` (or `go-licenses`) and review module licences before publish' };
}

function main() {
  const root = process.argv[2] || process.cwd();
  const has = (f) => fs.existsSync(path.join(root, f));
  const hasPackageJson = has('package.json');
  const hasRequirements = has('requirements.txt') || has('pyproject.toml');
  const hasPubspec = has('pubspec.yaml');
  const hasCargo = has('Cargo.toml');
  const hasMaven = has('pom.xml');
  const hasGradle = has('build.gradle') || has('build.gradle.kts') || has('settings.gradle') || has('settings.gradle.kts');
  const hasCpp = has('vcpkg.json') || has('conanfile.txt') || has('conanfile.py') || has('CMakeLists.txt');
  const hasSwift = has('Package.swift') || has('Package.resolved');
  let rootEntries = [];
  try { rootEntries = fs.readdirSync(root); } catch { rootEntries = []; }
  const hasDotnet = rootEntries.some((f) => f.endsWith('.csproj') || f.endsWith('.sln')) || has('packages.lock.json');
  const hasGo = has('go.mod');

  const results = [];
  if (hasPackageJson) results.push(scanNode(root));
  if (hasRequirements) results.push(scanPython(root));
  if (hasPubspec) results.push(scanDartFlutter(root));
  if (hasCargo) results.push(scanCargo(root));
  if (hasMaven || hasGradle) results.push(scanJvm(root, hasMaven ? 'java/maven' : 'jvm/gradle'));
  if (hasCpp) results.push(scanCpp(root));
  if (hasSwift) results.push(scanSwift(root));
  if (hasDotnet) results.push(scanDotnet(root));
  if (hasGo) results.push(scanGo(root));

  if (results.length === 0) {
    console.log(JSON.stringify({ status: 'clean', reason: 'no recognised dependency manifests found', results: [] }, null, 2));
    process.exit(0);
  }

  const blocked = results.flatMap((r) => r.findings.filter((f) => f.verdict === 'blocked'));
  const needsReview = results.flatMap((r) => r.findings.filter((f) => f.verdict === 'needs-review'));
  const notChecked = results.filter((r) => !r.checked);

  const output = { results, blocked, needsReview, notChecked };

  if (blocked.length > 0) {
    console.log(JSON.stringify({ status: 'BLOCKED', ...output }, null, 2));
    process.exit(1);
  }
  if (notChecked.length > 0) {
    console.log(JSON.stringify({ status: 'INCOMPLETE — install dependencies for every ecosystem present, then re-run', ...output }, null, 2));
    process.exit(1);
  }
  if (needsReview.length > 0) {
    console.log(JSON.stringify({ status: 'NEEDS HUMAN REVIEW — unrecognised licence strings found, ask the user before publishing', ...output }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: 'clean', ...output }, null, 2));
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}