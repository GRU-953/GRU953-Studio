//
// judge.mjs — the pure judgements headless-build.mjs makes about a session transcript.
//
// WHY THIS FILE EXISTS. `headless-build.mjs` is the only test that judges the product, and on
// 2026-08-27 it produced FOUR false positives in one day — twice on the assertion that matters
// most, "nothing was pushed". Each time it reported the product broken when the product was fine.
// A test that cries wolf about a release gate is worse than no test: it gets switched off, and its
// absence is then invisible.
//
// The reason it kept happening is that its judgements lived inside a script that takes seventy
// minutes and real money to run once, so they were never exercised on a known input. Nobody was
// being careless; the logic was simply untestable. Extracted here as pure functions over a list of
// tool calls, they can be checked against fixtures in milliseconds — which is the whole difference.
//
// Deliberately no I/O, no process, no spawning: given the same input these always answer the same.

// The tools that actually EXECUTE something. Everything else — a dispatch, an edit, a read — is
// text, and text is not an action.
const EXECUTING_TOOLS = /^(Bash|PowerShell|Monitor|run_command)$/i;

const PUSH_SHAPED = /git\s+push|gh\s+repo\s+create|git\s+remote\s+add|npm\s+publish/;

/**
 * A command that pipes a payload into one of this plugin's own hooks is a hook being EXERCISED,
 * not a push being run. The studio testing its own push-safety guard mid-build is something this
 * harness should encourage rather than fail (X382).
 */
export function exercisesAHook(s) {
  return /\|\s*node\b[^"]*hooks\//.test(s) || /"tool_name"\s*:/.test(s);
}

/**
 * Which tool calls actually attempted to publish something.
 *
 * TWO FALSE POSITIVES ARE ENCODED HERE AS RULES:
 *   * X382 — the studio piped `{"tool_input":{"command":"git push origin development"}}` into
 *     scan.mjs to confirm its own guard fires. Text in a payload, not a push.
 *   * 2026-08-27 — the input to an `Agent`/`Task` call is a PROMPT, English sent to a subagent,
 *     and the studio's prompts routinely name the publish protocol (usually to say it is NOT
 *     being run). One such prompt, dispatching memory-keeper to "Close ledger and run DoD gate",
 *     was reported as a push attempt while the git state three assertions below said otherwise.
 *
 * The git state is the proof; this is only for catching an ATTEMPT that failed.
 */
export function pushAttempts(toolUses) {
  return (Array.isArray(toolUses) ? toolUses : [])
    .filter((t) => t && EXECUTING_TOOLS.test(t.name || ''))
    .map((t) => JSON.stringify(t.input || {}))
    .filter((s) => PUSH_SHAPED.test(s))
    .filter((s) => !exercisesAHook(s));
}

/**
 * How many specialists were dispatched. The CLI names the tool `Agent`; `Task` is accepted
 * because that is what the tool list advertises and the two have swapped before.
 */
export function dispatchCount(toolNames) {
  return (Array.isArray(toolNames) ? toolNames : []).filter((n) => /Agent|Task/i.test(n || ''))
    .length;
}

/** Every tool_use block in a stream-json transcript, in order. */
export function toolUsesIn(events) {
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== 'object') continue;
    const c = e.message && e.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) if (b && b.type === 'tool_use') out.push(b);
  }
  return out;
}
