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
    return { kind: 'silent', status: 'silent', json: {}, problems: [], code: r.status, raw, why: 'stood aside' };
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
    die(`the gate CRASHED and this reproduction must not treat that as a verdict (${context}): ${v.why}`);
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
  const crash = (why) => ({ kind: 'crash', decision: null, reason: '', json: {}, code: r.status, raw, why });

  if (
    /\b(ReferenceError|TypeError|SyntaxError|RangeError|AssertionError)\b/.test(stderr) ||
    /^\s+at\s+\S+\s*\(/m.test(stderr)
  ) {
    return crash(`the hook threw rather than deciding:\n${stderr.split('\n').slice(0, 4).join('\n')}`);
  }

  if (stdout.trim() === '') {
    // A hook that stands aside exits 0 and says nothing. A hook that DIED also says nothing —
    // so the exit code is what separates the documented neutral from a failure to run.
    if (r.status && r.status !== 0) {
      return crash(`exited ${r.status} without printing a decision`);
    }
    return { kind: 'silent', decision: null, reason: '', json: {}, code: r.status, raw, why: 'stood aside' };
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
    return crash(`printed JSON with no hookSpecificOutput.permissionDecision:\n${stdout.slice(0, 200)}`);
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
