//
// _verdict.mjs — the one way a reproduction is allowed to read a gate's answer.
//
// WHY THIS EXISTS. P6 convergence round 2, 15 August 2026. Every reproduction in this
// directory judged a gate like this:
//
//     try { return JSON.parse(out).status } catch { return 'unparsed' }
//     ...
//     const caught = verdict.status !== 'clean';     // <- a CRASH satisfies this
//
// So a crashing gate and a blocking gate were indistinguishable. Measured at two commits:
//
//     the crashing quality-gate (fd1fe25^)  -> exit 1
//     the repaired quality-gate (c1d4757)   -> exit 1
//
// That is not hypothetical. A ReferenceError shipped in quality-gate.mjs — a blocking Publish
// pre-flight check — and X144's own reproduction stayed GREEN through it, as did all twelve
// gates and 489 unit tests. The reproduction "proved" a fix while the thing it guarded was
// throwing.
//
// A gate has FOUR possible answers and a reproduction must be able to name all four:
//
//     clean    — parsed JSON, a permissive status, exit 0
//     blocked  — parsed JSON, a refusing status, exit non-zero
//     silent   — no output at all (a PreToolUse hook standing aside; legitimate)
//     CRASH    — output that is not the contract: a stack trace, a partial write, nothing
//                on stdout with a non-zero exit
//
// `crash` is never a pass and never a block. It is a failure of the run itself, and readGate()
// makes it impossible to mistake for either.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Run a gate or hook and classify its answer.
 *
 * @returns {{kind:'clean'|'blocked'|'silent'|'crash', status:string, json:object,
 *            problems:string[], code:number, raw:string, why:string}}
 */
export function readGate(nodePath, gatePath, args = [], opts = {}) {
  const r = spawnSync(nodePath, [gatePath, ...args], {
    encoding: 'utf8',
    input: opts.input,
    cwd: opts.cwd,
  });
  const stdout = `${r.stdout || ''}`;
  const stderr = `${r.stderr || ''}`;
  const raw = stdout + stderr;

  // A Node crash writes a stack trace to stderr. Detected explicitly rather than inferred
  // from the exit code, because the exit code of a crash and of a refusal are both non-zero —
  // which is the entire defect this file exists to close.
  const looksLikeStackTrace =
    /\b(ReferenceError|TypeError|SyntaxError|RangeError|AssertionError)\b/.test(stderr) ||
    /^\s+at\s+\S+\s*\(/m.test(stderr);

  if (looksLikeStackTrace) {
    return {
      kind: 'crash',
      status: 'crash',
      json: {},
      problems: [],
      code: r.status,
      raw,
      why: `the gate threw rather than returning a verdict:\n${stderr.split('\n').slice(0, 4).join('\n')}`,
    };
  }

  if (stdout.trim() === '') {
    // No output. For a PreToolUse hook this is the documented neutral — it stands aside. For a
    // gate that is supposed to report, a non-zero exit with nothing on stdout is a crash that
    // left no trace, so it is named as one rather than read as a refusal.
    if (r.status && r.status !== 0) {
      return {
        kind: 'crash',
        status: 'crash',
        json: {},
        problems: [],
        code: r.status,
        raw,
        why: `exited ${r.status} with nothing on stdout — no verdict was produced`,
      };
    }
    return {
      kind: 'silent',
      status: 'silent',
      json: {},
      problems: [],
      code: r.status,
      raw,
      why: 'stood aside',
    };
  }

  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    return {
      kind: 'crash',
      status: 'unparsed',
      json: {},
      problems: [],
      code: r.status,
      raw,
      why: `stdout is not the JSON contract:\n${stdout.slice(0, 200)}`,
    };
  }

  const status = String(json.status ?? '');
  const permissive = /^(clean|not a studio project|no .* found)/i.test(status);
  return {
    kind: permissive ? 'clean' : 'blocked',
    status,
    json,
    problems: json.problems || json.rows || [],
    code: r.status,
    raw,
    why: json.reason || status,
  };
}

/**
 * The assertion every reproduction should make before reading a verdict. A crash is a broken
 * run, not a result, and continuing to reason about it produces exactly the false confidence
 * that let a shipped crash pass a green suite.
 */
export function refuseCrash(v, context, die) {
  if (v.kind === 'crash') {
    die(
      `the gate CRASHED and this reproduction must not treat that as a verdict (${context}): ${v.why}`,
    );
  }
  return v;
}

/**
 * The same job for a PreToolUse HOOK, whose contract is a different shape: it prints a
 * `hookSpecificOutput.permissionDecision`, and printing NOTHING is a documented, legitimate
 * answer meaning "I have no opinion about this command".
 *
 * That second point is why a hook needs its own reader rather than readGate(). Silence is a
 * real verdict here, so "no output" cannot be treated as a crash the way it is for a gate —
 * and equally, a hook that threw also produces no stdout. The two are separated by looking at
 * stderr and the exit code, never by the absence of output alone.
 *
 * @returns {{kind:'decision'|'silent'|'crash', decision:string|null, reason:string,
 *            json:object, code:number, raw:string, why:string}}
 */
export function readDecision(nodePath, hookPath, payload, opts = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const r = spawnSync(nodePath, [hookPath], { encoding: 'utf8', input, cwd: opts.cwd });
  const stdout = `${r.stdout || ''}`;
  const stderr = `${r.stderr || ''}`;
  const raw = stdout + stderr;
  const crash = (why) => ({
    kind: 'crash',
    decision: null,
    reason: '',
    json: {},
    code: r.status,
    raw,
    why,
  });

  if (
    /\b(ReferenceError|TypeError|SyntaxError|RangeError|AssertionError)\b/.test(stderr) ||
    /^\s+at\s+\S+\s*\(/m.test(stderr)
  ) {
    return crash(
      `the hook threw rather than deciding:\n${stderr.split('\n').slice(0, 4).join('\n')}`,
    );
  }

  if (stdout.trim() === '') {
    // A hook that stands aside exits 0 and says nothing. A hook that DIED also says nothing —
    // so the exit code is what separates the documented neutral from a failure to run.
    if (r.status && r.status !== 0) {
      return crash(`exited ${r.status} without printing a decision`);
    }
    return {
      kind: 'silent',
      decision: null,
      reason: '',
      json: {},
      code: r.status,
      raw,
      why: 'stood aside',
    };
  }

  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    return crash(`stdout is not the JSON contract:\n${stdout.slice(0, 200)}`);
  }

  const out = json.hookSpecificOutput || {};
  const decision = out.permissionDecision ?? null;
  if (decision === null) {
    return crash(
      `printed JSON with no hookSpecificOutput.permissionDecision:\n${stdout.slice(0, 200)}`,
    );
  }
  return {
    kind: 'decision',
    decision: String(decision),
    reason: out.permissionDecisionReason || '',
    json,
    code: r.status,
    raw,
    why: String(decision),
  };
}

// 2026-08-26, findings X366, X367 and X368 — the third instance of the X347 shape in this directory,
// and the reason it is a shared helper rather than a third copy of the same eight lines.
//
// `scan.mjs` stands aside ENTIRELY — emitting no decision at all — when `findStudioRoot()` finds no
// `Dev-Memory/` at or above the cwd (scan.mjs:947 -> lib.mjs:384). `Dev-Memory/` is GITIGNORED, so a
// fresh checkout has none. A control that records a problem only on `deny` therefore records nothing
// on every CI leg, while printing the same reassuring line it prints on the development machine. Three
// controls were in exactly that state, and all three still satisfied the two-direction contract, so
// the suite reported them healthy while they measured nothing.
//
// `findStudioRoot()` asks only whether that directory EXISTS. So the condition can be created, the
// control exercised, and only what was created removed again. Nothing is faked by this: an empty
// `Dev-Memory/` is precisely what makes a checkout a studio project, which is the state the controls
// are about. On a machine where the directory is already there it is left strictly alone.
//
// It returns whether the hook could be engaged rather than assuming it: if the directory can be
// neither found nor created, the caller is told so and must say so out loud instead of passing.
export function asStudioProject(root, fn) {
  const dm = path.join(root, 'Dev-Memory');
  const weMadeIt = !fs.existsSync(dm);
  if (weMadeIt) {
    try {
      fs.mkdirSync(dm, { recursive: true });
    } catch {
      // cannot be created here; fn is told `false` and must not report success
    }
  }
  try {
    return fn(fs.existsSync(dm));
  } finally {
    if (weMadeIt) fs.rmSync(dm, { recursive: true, force: true, maxRetries: 3 });
  }
}

/**
 * Write a Definition-of-Done record that looks MEASURED — the table plus the Dev-Memory/evidence/
 * files a real `hooks/dod.mjs` run leaves behind.
 *
 * 2026-08-27. quality-gate.mjs now refuses a table with no measurements behind it: that was the
 * hole where a Definition of Done copied out of its own skill's worked example returned clean,
 * with nothing run. Five reproductions here hand-wrote a table and asserted on the ROW logic, so
 * overnight all five would have started failing on the missing evidence instead of on the defect
 * each was raised about — reporting "the defect is back" about a defect that is not back, which
 * is a reproduction lying in the direction that gets it deleted.
 *
 * So the fixture moves HERE, once, rather than being fixed five times. A reproduction that needs
 * an UNMEASURED record (there is one: the provenance arm's own) writes the file directly and says
 * why, which is the honest way round — the shared helper produces the healthy case.
 *
 * @param {string} dir           project root (its Dev-Memory/ is created)
 * @param {string} table         the markdown table, exactly as the reproduction wants it read
 * @param {object} [opts]
 * @param {string[]} [opts.extraRows]  row labels to back with evidence that are not in the table
 *                                     (for a reproduction that DELETES a row and still wants the
 *                                     rest measured)
 */
export function writeMeasuredGate(dir, table, opts = {}) {
  const evidence = path.join(dir, 'Dev-Memory', 'evidence');
  fs.mkdirSync(evidence, { recursive: true });
  const measuredAt = new Date(Date.now() - 60_000).toISOString();
  const marked =
    '<!-- GENERATED by hooks/dod.mjs from Dev-Memory/evidence/*.json. Do not edit by hand. -->\n' +
    `Generated: ${new Date().toISOString()}\n\n${table}`;
  fs.writeFileSync(path.join(dir, 'Dev-Memory', 'QUALITY-GATE.md'), marked);

  const rows = new Set(opts.extraRows || []);
  for (const line of table.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const item = cells[0];
    if (!item) continue;
    if (/^:?-+:?$/.test(item)) continue;
    if (/^(item|check|dimension|requirement|criterion|gate)$/i.test(item)) continue;
    rows.add(item);
  }
  let n = 0;
  for (const row of rows) {
    fs.writeFileSync(
      path.join(evidence, `d${n++}.json`),
      JSON.stringify({
        dimension: `d${n}`,
        row,
        kind: 'executed',
        verdict: 'pass',
        why: 'exit 0',
        endedAt: measuredAt,
      }),
    );
  }
}

/**
 * Re-derive Dev-Memory/evidence/ from whatever Dev-Memory/QUALITY-GATE.md now says.
 *
 * For a reproduction that MUTATES a row in the golden tree. A real project that renamed a row
 * would have regenerated both halves together — dod.mjs writes the evidence and then renders the
 * table from it — so a fixture with a renamed row and the old evidence is a state no real run
 * produces. Without this, a reproduction about (say) label collision would instead report the
 * provenance arm firing, which is a true statement about the fixture and a false one about the
 * defect under test.
 *
 * Verdicts follow the mutated table on purpose: a row a reproduction changed to "fail" gets
 * evidence recording a failure, which is what the measurement would have said.
 */
export function resyncEvidence(dir) {
  const dm = path.join(dir, 'Dev-Memory');
  const evidence = path.join(dm, 'evidence');
  fs.rmSync(evidence, { recursive: true, force: true });
  fs.mkdirSync(evidence, { recursive: true });
  let table = '';
  try {
    table = fs.readFileSync(path.join(dm, 'QUALITY-GATE.md'), 'utf8');
  } catch {
    return;
  }
  // Stamped just BEFORE the table's own Generated: time, which is the order dod.mjs writes them
  // in — evidence first, then the table rendered from it. Taking the time from the table rather
  // than from the clock also keeps this deterministic: the golden fixture is dated 2026-07-21 and
  // must not acquire measurements from today, which quality-gate.mjs would rightly call a stale
  // table (it did, immediately).
  const stamp = /^Generated:\s*(\S+)/m.exec(table);
  const base = stamp ? Date.parse(stamp[1]) : NaN;
  const at = new Date((Number.isFinite(base) ? base : Date.now()) - 60_000).toISOString();
  let n = 0;
  for (const line of table.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const item = cells[0];
    if (!item || /^:?-+:?$/.test(item)) continue;
    if (/^(item|check|dimension|requirement|criterion|gate)$/i.test(item)) continue;
    const pass = /^\s*(pass|ok|green|done|met|yes|✅|✓)/i.test(cells[1] || '');
    fs.writeFileSync(
      path.join(evidence, `d${n++}.json`),
      JSON.stringify({
        dimension: `d${n}`,
        row: item,
        kind: 'executed',
        verdict: pass ? 'pass' : 'n/a',
        why: pass ? 'exit 0' : 'not applicable',
        endedAt: at,
      }),
    );
  }
}
