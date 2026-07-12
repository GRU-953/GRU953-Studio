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
import path from 'node:path';
import process from 'node:process';

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

function main() {
  const root = process.argv[2] || process.cwd();
  const hasPackageJson = fs.existsSync(path.join(root, 'package.json'));
  const hasRequirements = fs.existsSync(path.join(root, 'requirements.txt')) || fs.existsSync(path.join(root, 'pyproject.toml'));
  const hasPubspec = fs.existsSync(path.join(root, 'pubspec.yaml'));

  const results = [];
  if (hasPackageJson) results.push(scanNode(root));
  if (hasRequirements) results.push(scanPython(root));
  if (hasPubspec) results.push({ ecosystem: 'dart/flutter', checked: false, findings: [], note: 'run `dart pub deps --style=compact` and review each package licence manually before publish — no offline scan implemented yet' });

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

main();
