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

// Known limitation (disclosed 2026-07-10 audit, not yet fixed): this scans
// top-level node_modules/* only, not each package's own nested
// node_modules (npm can install a dependency's dependencies nested rather
// than flattened). A transitively-nested copyleft dependency could
// currently pass unnoticed. Flagged in SECURITY.md; a recursive walk is a
// reasonable follow-up if this becomes a real problem in practice.
function scanNode(root) {
  const nm = path.join(root, 'node_modules');
  if (!fs.existsSync(nm)) return { ecosystem: 'npm', checked: false, findings: [] };
  const findings = [];
  const dirs = fs.readdirSync(nm, { withFileTypes: true });
  const pkgDirs = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    if (d.name.startsWith('@')) {
      const scoped = fs.readdirSync(path.join(nm, d.name), { withFileTypes: true });
      for (const s of scoped) if (s.isDirectory()) pkgDirs.push(path.join(d.name, s.name));
    } else {
      pkgDirs.push(d.name);
    }
  }
  for (const p of pkgDirs) {
    const pkgJsonPath = path.join(nm, p, 'package.json');
    let licence = null;
    // 2026-07-12 audit fix (SEVERE false-clean, found by execution): a
    // package whose package.json is missing or unparseable used to just
    // `continue` here — silently dropped from every category (blocked,
    // needsReview, notChecked), so the scanner reported the whole ecosystem
    // "clean" even with a genuinely unknowable licence sitting in
    // node_modules. This is exactly the case isAllowed()'s own comment
    // above says the design principle rejects: "unknown — reported, not
    // silently passed." Reproduced live: a package directory containing
    // only an index.js (no package.json at all) produced
    // {"status":"clean", findings:[]}, exit 0. Now surfaced as a
    // 'needs-review' finding instead of being dropped, same as any other
    // licence the scanner can't positively classify.
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

function scanPython(root) {
  // Best-effort: look for installed dist-info METADATA files under any venv-like folder.
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
  // Not walked deeply here — flag for manual check rather than guess wrong.
  return { ecosystem: 'python', checked: false, findings: [], note: 'venv found but not deeply scanned — run pip-licenses manually and review before publish' };
}

// Dart/Flutter (pub.dev) packages ship a LICENSE file, not a machine-
// readable SPDX field the way npm's package.json does — so this
// classifies by matching distinctive phrases in the licence TEXT itself,
// same three-way true/false/null shape as isAllowed() above. Copyleft
// signatures are checked first, same priority FLAG_SUBSTRINGS gets in
// isAllowed() — an unambiguous copyleft match is never allow-listed by a
// later, looser check. Anything that doesn't match a known signature
// returns null ("needs a human look"), never a guess.
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
  // 3-clause BSD adds a "neither the name ... endorse or promote" clause
  // the 2-clause variant doesn't have — checked first so a 3-clause text
  // (which also matches the weaker 2-clause pattern below) is never
  // misclassified as 2-clause.
  if (t.includes('REDISTRIBUTION AND USE') && t.includes('BINARY FORM') && t.includes('NEITHER THE NAME')) {
    return { spdx: 'BSD-3-Clause', allowed: true };
  }
  if (t.includes('REDISTRIBUTION AND USE') && t.includes('BINARY FORM')) {
    return { spdx: 'BSD-2-Clause', allowed: true };
  }
  if (t.includes('THIS IS FREE AND UNENCUMBERED SOFTWARE')) return { spdx: 'Unlicense', allowed: true };
  if (t.includes('CC0')) return { spdx: 'CC0-1.0', allowed: true };
  if (t.includes('ISC LICENSE')) return { spdx: 'ISC', allowed: true };

  return null; // present but not recognised — needs a human look
}

// `PUB_CACHE` is the documented override; otherwise pub uses a fixed
// per-OS default location — not `$HOME`-relative on Windows.
export function findPubCacheRoot() {
  if (process.env.PUB_CACHE) return process.env.PUB_CACHE;
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'Pub', 'Cache');
  }
  return path.join(os.homedir(), '.pub-cache');
}

function scanDartFlutter(root) {
  let parsed;
  try {
    // Reads the already-resolved pubspec.lock state — no network expected,
    // but bounded with a timeout anyway so a stalled call can't hang this
    // hook indefinitely.
    const raw = execFileSync('dart', ['pub', 'deps', '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    });
    parsed = JSON.parse(raw);
  } catch {
    // Dart SDK not on PATH, `pub deps` failed, or output wasn't valid JSON
    // — reported honestly as not-checked, the same fallback shape every
    // other ecosystem here uses, never a guessed/assumed clean result.
    return {
      ecosystem: 'dart/flutter',
      checked: false,
      findings: [],
      note: 'could not run `dart pub deps --json` (Dart SDK not on PATH, or pub deps failed) — run it manually and review each package licence before publish',
    };
  }

  const pubCacheRoot = findPubCacheRoot();
  const findings = [];
  // Only 'hosted' (real pub.dev) packages live in the pub cache this way.
  // 'root' is the project itself; 'sdk' packages (e.g. `flutter`,
  // `sky_engine`) ship inside the Flutter SDK install under its own
  // licence, not as an individually cached pub.dev download — out of
  // scope here the same way scanNode() doesn't scan Node.js's own
  // built-in modules.
  const hostedPackages = (parsed.packages || []).filter((p) => p.source === 'hosted');

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
    // else: recognised and allowed — no entry, same convention scanNode()
    // uses (only non-clean results are pushed to findings).
  }

  return { ecosystem: 'dart/flutter', checked: true, findings };
}

// Classify an SPDX licence EXPRESSION (Cargo/Maven can carry "MIT OR
// Apache-2.0", "GPL-2.0 OR MIT", "Apache-2.0 AND MIT", etc.), not just a bare
// id. A dual "A OR B" is usable if ANY alternative is fully permissive; an
// "A AND B" alternative is permissive only if EVERY term is. Copyleft in a term
// makes that term non-permissive. Returns true (allowed) / false (all
// alternatives blocked) / null (a human should look) — the same three-way
// shape as isAllowed(), erring toward review, never toward a silent pass.
export function classifySpdxExpr(expr) {
  if (!expr) return null;
  const alternatives = String(expr).split(/\bOR\b/i).map((s) => s.trim()).filter(Boolean);
  if (alternatives.length === 0) return null;
  const verdicts = alternatives.map((alt) => {
    const up = alt.toUpperCase();
    if (FLAG_SUBSTRINGS.some((f) => up.includes(f))) return false;
    const andTerms = alt.split(/\bAND\b|\bWITH\b/i).map((t) => t.replace(/[()]/g, '').trim()).filter(Boolean);
    if (andTerms.length && andTerms.every((t) => ALLOWED.has(t))) return true;
    return null;
  });
  if (verdicts.some((v) => v === true)) return true;
  if (verdicts.every((v) => v === false)) return false;
  return null;
}

// Rust (Cargo): `cargo metadata` exposes each package's SPDX `license` field
// directly (machine-readable, like npm's package.json), so this is a real scan,
// not best-effort. Falls back to honest "not checked" when cargo is absent or
// resolution fails, the same shape every other ecosystem uses.
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
    if (members.has(pkg.id)) continue; // the project's own crate(s)
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

// JVM (Maven/Gradle): dependency licences are not available from a single
// zero-config command (they need a licence plugin), so this is honestly
// reported as best-effort not-checked — surfaced as INCOMPLETE so a human runs
// the ecosystem's own licence report and reviews it, never a false pass.
function scanJvm(root, kind) {
  return { ecosystem: kind, checked: false, findings: [], note: `${kind} project detected — dependency licences need the ecosystem's own report (e.g. \`mvn license:aggregate-third-party-report\` or a Gradle licence plugin, plus \`mvn dependency:tree\`/\`gradle dependencies\`); run it and review before publish` };
}

// C++ (vcpkg/Conan/vendored): no canonical machine-readable licence source, so
// best-effort not-checked with a manual-review note, consistent with the "not
// checked, never a false pass" principle.
function scanCpp(root) {
  return { ecosystem: 'c++', checked: false, findings: [], note: 'C++ project detected — dependency/vendored licences have no single canonical manifest; review vcpkg/Conan and any vendored third-party licences manually before publish' };
}

// Swift (SwiftPM), .NET (NuGet), Go (modules): each is best-effort not-checked —
// none exposes dependency licences from a single zero-config command — reported
// honestly as INCOMPLETE so a human runs the ecosystem's own report, never a
// false pass. (TypeScript is npm, already covered by scanNode.)
function scanSwift(root) {
  return { ecosystem: 'swift/spm', checked: false, findings: [], note: 'Swift package project detected — SwiftPM dependency licences need a manual review (Package.resolved lists the packages; check each licence) before publish' };
}
function scanDotnet(root) {
  return { ecosystem: '.net/nuget', checked: false, findings: [], note: '.NET project detected — run `dotnet list package` and review NuGet licences before publish' };
}
function scanGo(root) {
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
  const hasDotnet = fs.readdirSync(root).some((f) => f.endsWith('.csproj') || f.endsWith('.sln')) || has('packages.lock.json');
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

// Guarded so this file can also be `import`-ed for unit testing
// (detectLicenceFromText, findPubCacheRoot) without main()'s CLI side
// effects (console output + process.exit) firing on import — this file
// had no test-facing exports before, so this guard was never needed
// until now. `node licence-scan.mjs [projectRoot]` still runs exactly as
// before when invoked directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
