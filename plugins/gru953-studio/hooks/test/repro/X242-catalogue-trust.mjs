#!/usr/bin/env node
//
// Reproduction for X242 - four ways `openrouter-models.mjs` presented a third-party catalogue's
// content as if the plugin had checked it. This is the plugin's ONLY outbound network call, and the
// answer it produces is what a non-technical user picks a model from, so "reported free" has to mean
// "verified free".
//
// A  parseFloat is a PREFIX parser, so any price string that merely BEGINS with a zero read as free.
//    `parseFloat("0abc")` is 0, and the check was `Number.isFinite(n) && n === 0`. Confirmed for
//    "0abc", "0,000003" (three millionths written with a decimal comma, the ordinary European
//    spelling), "0x5", "0 dollars" and the array [0]. The docstring immediately above it says "A
//    value that does not parse as a number is treated as not-free, for the same reason", so the code
//    contradicted its own stated rule; and README.md promises the studio "only ever picks free
//    models unless you say otherwise - decided by each model's real price". "0,000003" is the case
//    that should end the argument: it is a real price, it is not zero, and it read as free.
//
// B  The same docstring's OTHER claim is also untrue, and nobody had named it: "Checking the whole
//    map fails safe: a new paid dimension makes a model drop OUT of the free list rather than
//    quietly stay in it." It only checks dimensions the entry DECLARES. An entry declaring one zero
//    key read free no matter what it charges on keys it omits - the exact opposite of the "absent
//    price information means unknown" principle stated four lines earlier in the same comment.
//
// C  A newline inside an `id` forged table rows. `formatTable` pads each id and joins with a
//    newline, so one crafted entry could print an extra line reading like a real row - a PAID model
//    shown as free. The `--json` path escapes newlines, which is why an earlier pass cleared it; but
//    `--json` is the path `commands/studio-models.md` actually uses, and it emits `name` and `id` as
//    raw third-party text into the assistant's context while SECURITY.md promises the catalogue is
//    "treated as DATA and never as an instruction". Escaping is not sanitising.
//
// D  An emptied or truncated catalogue was reported as `"status": "ok"` with exit 0, discarding the
//    response's own contradicting count. `data: []` alongside `total_count: 399` produced
//    "totalInCatalogue": 0 and a clean exit. The file's own header assigns exit 1 to "could not
//    reach or read the catalogue", and an empty catalogue is exactly that: OpenRouter always has
//    hundreds of models, so zero is a failed read, not an answer. An empty FILTERED result stays
//    exit 0, because that genuinely is an answer.
//
// Severity: A and D were restored to High by the completeness critic after the adjudicator
// downgraded both to Medium on the LIKELIHOOD of the input. The rubric does not license that - it
// asks whether a reproduction can reach it, and it can - and both are checks that report "clean"
// while the thing they check is wrong.
//
// A NOTE ON WRITING THIS FILE, because it is the finding in miniature. The control-character regex
// in case C was twice typed as raw bytes instead of escape sequences, and both times the tooling
// refused it. That is exactly what INV20 guards in the product, and exactly what X204 and X222 were
// about. Writing a check for control characters is one of the easiest places to put one.
//
// NO NETWORK CALL IS MADE ANYWHERE IN THIS FILE. Every case injects a fake fetch.
//
// Usage:
//   node X242-catalogue-trust.mjs                # asserts the fixed state
//   node X242-catalogue-trust.mjs --expect-bug   # asserts the defects, for the parent commit

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const expectBug = process.argv.includes('--expect-bug');
const here = dirname(fileURLToPath(import.meta.url));
const MOD = join(here, '..', '..', 'openrouter-models.mjs');
// 2026-08-26, finding X356 (Windows-only; class: a filesystem path used where the
// ESM loader requires a URL). THIS FILE IS THE ORIGIN of the idiom. `import()` of a
// bare absolute path is a POSIX accident: '/a/b.mjs' is a valid relative URL, but on
// the Windows runner join() yields 'D:\a\...\openrouter-models.mjs', which Node parses
// as a URL with scheme "d:" and rejects with ERR_UNSUPPORTED_ESM_URL_SCHEME. It throws
// during top-level evaluation, so the reproduction died before case A ran and the
// harness read the non-zero exit as "the defect is back". pathToFileURL() emits the
// correct file:// URL on both platforms and, on POSIX, resolves to the SAME module
// instance the bare path did — so nothing about the reproduction's meaning changes.
// This exact bug had already been found and fixed once in the product code
// (repo-integrity.mjs, "2026-08 R3", found live on the Windows CI leg); the lesson was
// never carried into the test idiom, and this call site, added here in 9cb7c9e, was
// then copied verbatim into X250 (01f822d), X179 (d7f73be), X288 (9767709) and X241
// (31c1700). None of the five ever ran on Windows: the last green Windows CI (4f3b3b9)
// carried four repro scripts, and all five of these post-date it.
const { isFreeModel, formatTable, fetchModels } = await import(pathToFileURL(MOD).href);

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const problems = [];
const note = (s) => problems.push(s);
const price = (v) => ({ id: 'x/y', pricing: { prompt: v } });

// ---- A: a price that merely begins with a zero is not a zero price ------------------
{
  const cases = [
    ['0abc', 'a string with trailing text'],
    ['0,000003', 'three millionths written with a decimal comma'],
    ['0x5', 'a hex literal'],
    ['0 dollars', 'a number with a unit'],
    ['', 'an empty string'],
  ];
  const wrong = cases.filter(([v]) => isFreeModel(price(v)) === true);
  const arrayWrong = isFreeModel({ id: 'x/y', pricing: { prompt: [0] } }) === true;
  if (wrong.length || arrayWrong) {
    note(
      `case A: ${wrong.length + (arrayWrong ? 1 : 0)} non-numeric price value(s) read as FREE: ` +
        wrong.map(([v, why]) => `${JSON.stringify(v)} (${why})`).join(', ') +
        (arrayWrong ? ', and the array [0]' : ''),
    );
  } else {
    console.log('  A  prefix-parsed prices ....................... all rejected');
  }

  // Control: genuine zeroes, in every spelling the API really uses, must still read free. Without
  // this the fix could "pass" by calling nothing free, which would make the free list useless.
  const genuine = [
    { id: 'a/b', pricing: { prompt: '0', completion: '0' } },
    { id: 'a/b', pricing: { prompt: 0, completion: 0 } },
    { id: 'a/b', pricing: { prompt: '0.0', completion: '0e0' } },
  ];
  const broke = genuine.filter((m) => isFreeModel(m) !== true);
  if (broke.length) {
    note(
      `control A: ${broke.length} genuinely-free model(s) are no longer recognised as free, so the ` +
        'fix has made the free list useless rather than correct',
    );
  } else {
    console.log('  A. control: genuine zero prices ............... still free');
  }
  if (isFreeModel(price('0.000003')) !== false) {
    note('control A: a real non-zero price of 0.000003 is reported as free');
  }
}

// ---- B: an omitted pricing dimension is unknown, not free --------------------------
{
  const declaresOnlyOne = { id: 'x/y', pricing: { prompt: '0' } };
  const declaresTheKnownSet = {
    id: 'x/y',
    pricing: { prompt: '0', completion: '0', request: '0', image: '0' },
  };
  if (isFreeModel(declaresOnlyOne) === true && isFreeModel(declaresTheKnownSet) === true) {
    note(
      'case B: an entry declaring ONE zero key reads free, so the docstring claim that "checking ' +
        'the whole map fails safe" is untrue - it checks only the keys the entry chose to declare',
    );
  } else {
    console.log('  B  under-declared pricing ..................... not treated as free');
  }
}

// ---- C: catalogue text cannot forge output ----------------------------------------
{
  const forged = [
    { id: 'real/model', pricing: { prompt: '0', completion: '0' }, context_length: 8192 },
    {
      id: 'evil/paid\nfree-looking/row     8192  free',
      pricing: { prompt: '99', completion: '99' },
      context_length: 8192,
    },
  ];
  const table = formatTable(forged, { all: true });
  const bodyLines = table
    .split('\n')
    .slice(1)
    .filter((l) => l.trim() !== '');
  if (bodyLines.length > forged.length) {
    note(
      `case C: ${forged.length} catalogue entries produced ${bodyLines.length} table rows - a ` +
        'newline in an id forges rows, and the forged one can read "free" beside a paid model',
    );
  } else {
    console.log('  C  newline in an id .......................... cannot forge a row');
  }
  if (CONTROL_CHARS.test(table)) {
    note('case C: raw control characters from the catalogue reach the rendered table');
  }
}

// ---- D: a catalogue that contradicts its own count is a failed read ---------------
{
  const fake = (body) => async () => ({ ok: true, status: 200, json: async () => body });

  let threw = null;
  try {
    await fetchModels({ fetchImpl: fake({ data: [], total_count: 399 }) });
  } catch (e) {
    threw = e;
  }
  if (!threw) {
    note(
      "case D: a catalogue of zero models alongside the response's own total_count of 399 was " +
        'accepted as a good read, so it would be reported as status ok with exit 0',
    );
  } else {
    console.log('  D  empty data vs a declared count ............. rejected');
  }

  let threw2 = null;
  try {
    await fetchModels({
      fetchImpl: fake({ data: [{ id: 'a/b' }, { id: 'c/d' }], total_count: 399 }),
    });
  } catch (e) {
    threw2 = e;
  }
  if (!threw2) {
    note('case D: a list truncated to 2 of a declared 399 was accepted as complete');
  } else {
    console.log('  D. truncated list ............................. rejected');
  }

  // Controls: the ordinary shapes must still work, or this is a new false alarm rather than a fix.
  let okRes = null;
  try {
    okRes = await fetchModels({ fetchImpl: fake({ data: [{ id: 'a/b' }, { id: 'c/d' }] }) });
  } catch (e) {
    note(`control D: an ordinary response with no total_count now FAILS: ${e.message}`);
  }
  if (okRes && okRes.length === 2) {
    console.log('  D. control: no total_count declared ........... accepted');
  }

  try {
    const agree = await fetchModels({
      fetchImpl: fake({ data: [{ id: 'a/b' }, { id: 'c/d' }], total_count: 2 }),
    });
    if (agree.length !== 2) note('control D: an agreeing count was mishandled');
    else console.log('  D. control: count agrees ...................... accepted');
  } catch (e) {
    note(`control D: a response whose count AGREES with its data now fails: ${e.message}`);
  }
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
  '\nPASS: a price is free only when every declared dimension parses wholly as zero, catalogue text ' +
    'cannot forge output, and a catalogue that contradicts its own count is a failed read.',
);
