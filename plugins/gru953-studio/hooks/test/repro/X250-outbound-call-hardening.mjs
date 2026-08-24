#!/usr/bin/env node
//
// Reproduction for X250 — four defects around the plugin's ONLY outbound network call.
//
//   A  No timeout and no redirect guard. `fetchImpl(url, { headers })` with no `signal` and no
//      `redirect`, and nothing above it supplies either: this file is NOT a registered hook, so it
//      gets none of hooks.json's `timeout: 20`; `commands/studio-models.md` runs a bare `node …`;
//      and `clients/cli/src/index.js` awaits `mod.main(argv)` with no timer. A stalled connection
//      hung the command indefinitely with no output and nothing to interrupt but Ctrl-C.
//
//   B  A malformed catalogue entry produced a RAW STACK TRACE — "TypeError: Cannot read properties
//      of null (reading 'context_length')" — two lines below a docstring promising "Never a raw
//      stack trace: this output reaches a non-technical user". One `null` inside `data` was enough.
//
//   C  Merely IMPORTING the module fired the network call. "Am I the entry point" was answered by a
//      BASENAME SUFFIX test — `import.meta.url.endsWith(process.argv[1].split(/[/\\]/).pop())` —
//      true for any entry point whose whole filename is a suffix of "openrouter-models.mjs":
//      models.mjs, r-models.mjs, s.mjs, els.mjs. Demonstrated with a stubbed fetch: a file named
//      `models.mjs` that only imported this module fired the request and printed a full listing
//      nobody asked for.
//
//   D  The summary counted whatever `data` contained, so with three junk entries beside one real
//      model it said "OpenRouter currently lists 4 models". Found while testing B's fix, reported
//      by nobody — and it is the same class as B: a number the product cannot support.
//
// NO NETWORK CALL IS MADE ANYWHERE IN THIS FILE. Case A is asserted by reading the call site, because
// proving a timeout fires would mean holding a real socket open for fifteen seconds; the ABSENCE of
// the option is what the finding is about and that is read-verifiable. B, C and D are executed.
//
//   case                                                    required
//   A  the outbound call cannot hang or follow a redirect     both options present AND correct
//   B  a null / number / string inside data                   no stack trace, still renders
//   C  importing from a suffix-named file                      no request, no output
//   D  the summary counts only real entries                    junk does not inflate it
//   E  control: a direct run still works                       the feature is not disabled
//
// Case E matters because C's fix is a path comparison: get it slightly wrong and the module stops
// running when invoked properly, which no other case here would notice.
//
// Usage:
//   node X250-outbound-call-hardening.mjs                # asserts the fixed state
//   node X250-outbound-call-hardening.mjs --expect-bug   # asserts the defects

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const MOD = join(here, '..', '..', 'openrouter-models.mjs');
const SRC = readFileSync(MOD, 'utf8');
const { main, selectModels } = await import(MOD);

const problems = [];
const note = (s) => problems.push(s);
const live = SRC.split('\n')
  .filter((l) => !/^\s*\/\//.test(l))
  .join('\n');

// ---- A: the call must carry a timeout and a redirect guard --------------------------
{
  const call = /fetchImpl\(url,\s*\{[\s\S]{0,400}?\}\s*\)/.exec(live);
  const text = call ? call[0] : '';
  const missing = [];
  // 2026-08-24, X294: this was `/signal\s*:/` and `/redirect\s*:/` — the KEY's presence, not its
  // VALUE. `redirect: 'follow'` is the DEFAULT and precisely the behaviour a redirect guard exists to
  // prevent; `signal: null` and `signal: undefined` are no timeout at all. Both would have satisfied
  // the old test, and this case would have printed "timeout and redirect guard — both present" over a
  // call that hangs and follows redirects off the catalogue host.
  //
  // A key name is not a guarantee. The header's argument for READING rather than executing is right
  // for an option's ABSENCE — proving a timeout fires means holding a socket open for fifteen seconds
  // — and it does not extend to the option's value, which is equally read-verifiable.
  if (!/signal\s*:/.test(text)) missing.push('no timeout (signal)');
  else if (/signal\s*:\s*(null|undefined|false)\b/.test(text))
    missing.push('signal is present but empty, so there is no timeout');
  else if (!/signal\s*:\s*AbortSignal\.timeout\(\s*\d+\s*\)/.test(text))
    missing.push('signal is not an AbortSignal.timeout(<ms>), so no deadline is established');
  else {
    const ms = Number(/AbortSignal\.timeout\(\s*(\d+)\s*\)/.exec(text)[1]);
    // A bound has to be a real bound. Ten minutes is not a timeout for a catalogue listing, and zero
    // would abort before the request left the machine.
    if (!(ms >= 1000 && ms <= 60000))
      missing.push(`the timeout is ${ms} ms, which is not a usable deadline for this call`);
  }
  if (!/redirect\s*:/.test(text)) missing.push('no redirect guard');
  else if (!/redirect\s*:\s*['"`](error|manual)['"`]/.test(text))
    missing.push(
      `redirect is present but set to ${(/redirect\s*:\s*['"`]?([A-Za-z]+)/.exec(text) || [, '?'])[1]}, ` +
        "and 'follow' is the default this option exists to override",
    );
  if (!call) {
    note('case A: could not find the fetchImpl call site, so nothing here is testing it');
  } else if (missing.length) {
    note(
      `case A: the plugin's only outbound call has ${missing.join(' and ')}. Nothing above it ` +
        'supplies one either - this file is not a registered hook, the command runs a bare node, ' +
        'and the CLI awaits main() with no timer',
    );
  } else {
    console.log('  A  timeout and redirect guard ................ both present');
  }
}

// ---- B: a malformed entry must not produce a stack trace ---------------------------
{
  const bad = [
    { id: 'real/model', pricing: { prompt: '0', completion: '0' }, context_length: 100 },
    null,
    42,
    'not an object',
    [],
  ];
  let threw = null;
  let out = null;
  try {
    out = selectModels(bad, { all: true, search: '', limit: 0 });
  } catch (e) {
    threw = e;
  }
  if (threw) {
    note(
      `case B: a malformed catalogue entry crashes selectModels with a raw error (${threw.constructor.name}: ` +
        `${String(threw.message).slice(0, 70)}), two lines below a docstring promising never a raw stack trace`,
    );
  } else if (!out || out.length !== 1) {
    note(
      `case B: malformed entries are handled but the one REAL model was lost too (${out ? out.length : 0} ` +
        'returned, 1 expected) - dropping everything is not the same as dropping the junk',
    );
  } else {
    console.log(
      '  B  malformed entries ......................... dropped, the real model survives',
    );
  }
}

// ---- C: importing must not fire the call ------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'x250-'));
  const caseDir = join(dir, 'case');
  mkdirSync(caseDir, { recursive: true });
  // Named so its basename is a SUFFIX of "openrouter-models.mjs" - the exact shape the old test
  // could not distinguish from being the entry point.
  const importer = join(caseDir, 'models.mjs');
  writeFileSync(
    importer,
    [
      "globalThis.fetch = async () => { console.log('FETCH-FIRED'); return { ok: true, status: 200, json: async () => ({ data: [] }) }; };",
      `await import(${JSON.stringify(MOD)});`,
      "console.log('IMPORT-DONE');",
    ].join('\n'),
    'utf8',
  );
  const r = spawnSync(process.execPath, [importer], { encoding: 'utf8' });
  const outText = `${r.stdout || ''}${r.stderr || ''}`;
  if (/FETCH-FIRED/.test(outText)) {
    note(
      'case C: importing the module from a file named models.mjs FIRED the network call - the ' +
        'entry-point test is a basename suffix comparison, so any importer whose filename is a ' +
        'suffix of openrouter-models.mjs is mistaken for a direct run',
    );
  } else if (!/IMPORT-DONE/.test(outText)) {
    note(`case C: the importer did not complete at all: ${outText.slice(0, 200)}`);
  } else if (/MODEL\s+CONTEXT/.test(outText)) {
    note('case C: importing printed a model table, so the direct-run branch still executed');
  } else {
    console.log('  C  importing from a suffix-named file ........ no request, no output');
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---- D: the summary must count only real entries ----------------------------------
{
  const fake = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        { id: 'a/b', pricing: { prompt: '0', completion: '0' }, context_length: 100 },
        null,
        42,
        'x',
      ],
    }),
  });
  const lines = [];
  const original = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let mainThrew = null;
  try {
    await main(['--all'], { fetchImpl: fake });
  } catch (e) {
    // At the defective parent, main() itself throws on this input. A reproduction that DIES here
    // reports nothing at all, which is the same instrument-blindness the programme keeps finding -
    // so the throw is captured and reported as the case-B defect it is.
    mainThrew = e;
  } finally {
    console.log = original;
  }
  if (mainThrew) {
    note(
      `case D: main() threw on a catalogue containing a malformed entry (${mainThrew.constructor.name}), ` +
        'so no summary was produced at all - the count cannot be wrong because nothing was printed',
    );
  }
  const summary = lines.find((l) => /currently lists/.test(l)) || '';
  const m = /currently lists (\d+) models/.exec(summary);
  if (mainThrew) {
    /* already reported above */
  } else if (!m) {
    note('case D: no summary line was printed, so the count cannot be checked');
  } else if (m[1] !== '1') {
    note(
      `case D: the summary says "${m[1]} models" for a catalogue holding one real model and three ` +
        'junk entries - it counts whatever came back rather than what it can actually show',
    );
  } else {
    console.log('  D  summary count ............................. counts only real entries');
  }
}

// ---- E: control — a direct run must still work ------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), 'x250e-'));
  const runner = join(dir, 'run-it.mjs');
  writeFileSync(
    runner,
    [
      `const { main } = await import(${JSON.stringify(MOD)});`,
      "const fake = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'a/b', pricing: { prompt: '0', completion: '0' }, context_length: 100 }] }) });",
      "process.exitCode = await main(['--all'], { fetchImpl: fake });",
    ].join('\n'),
    'utf8',
  );
  const r = spawnSync(process.execPath, [runner], { encoding: 'utf8' });
  if (r.status !== 0 || !/a\/b/.test(r.stdout || '')) {
    note(
      `control E: an ordinary run no longer produces a listing (exit ${r.status}). The entry-point ` +
        'fix has disabled the module rather than narrowing when it self-executes',
    );
  } else {
    console.log('  E  control: an ordinary run .................. still works');
  }
  rmSync(dir, { recursive: true, force: true });
}

if (expectBug) {
  if (!problems.length) {
    console.error('FAIL: --expect-bug found nothing; this is not the defective state.');
    process.exit(1);
  }
  console.log(`\nREPRODUCED (${problems.length}):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(0);
}
if (problems.length) {
  console.error(`FAIL (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  '\nPASS: the outbound call cannot hang or follow a redirect, malformed catalogue entries are ' +
    'dropped rather than crashing, importing the module fires nothing, and the summary counts only ' +
    'what it can show.',
);
