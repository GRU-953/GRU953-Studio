#!/usr/bin/env node
//
// openrouter-models.mjs — search OpenRouter's live model catalogue, free
// models only by default. Zero dependencies (Node's built-in fetch only): the
// plugin's "zero third-party code dependencies" claim is enforced by
// docs-consistency.mjs's DC6, so no package may be added here.
//
// Why this exists: the `openrouter-integration` skill offers OpenRouter as an
// AI backend for an app GRU953-Studio builds, and the owner's requirement is
// that free models are always what gets selected by default. A skill file can
// describe that intent, but only real code can actually tell a free model from
// a paid one against today's catalogue — which is the whole difference between
// this and the fictional multi-provider "capability registry" a 2026-07
// version of model-router/SKILL.md described and had to retract, because no
// code anywhere implemented it. Everything below was written against the real
// API response, fetched and inspected on 2026-08-10.
//
// FACTS VERIFIED 2026-08-10 (re-verify before trusting any of this later —
// prices, fields and model names all change):
//   * GET https://openrouter.ai/api/v1/models returns HTTP 200 with NO
//     authentication at all. Listing models needs no API key; only actually
//     CALLING a model does.
//   * The response is { data: [...], total_count, links }. 399 models.
//   * 17 models are genuinely free (every pricing field zero).
//   * pricing is a string->string map, and across the full catalogue it uses
//     THIRTEEN different keys: prompt, completion, web_search,
//     input_cache_read, input_cache_write, input_cache_write_1h, overrides,
//     image, audio, input_audio_cache, internal_reasoning, image_output,
//     audio_output. Most entries carry only prompt and completion.
//
// THE ONE DETAIL THAT MATTERS MOST, and the reason this is code and not prose:
// free-ness is decided by PRICE, never by the model id. 14 of the 17 free
// models have ids ending ":free", but three do NOT —
// google/lyria-3-pro-preview, google/lyria-3-clip-preview and
// openrouter/free. A ":free"-suffix test, which is the obvious shortcut and
// what most write-ups suggest, silently misses those three. The inverse
// mistake is worse: trusting the suffix on a model that later starts charging
// would spend the user's money while reporting "free".
//
// And why EVERY pricing field is checked, not just prompt and completion:
// today no free model carries a non-zero value in any other field (verified
// directly across all 399 entries, not assumed). But OpenRouter adds pricing
// dimensions over time — image_output and audio_output are recent — so a
// model that is free per token yet charges per image would read as free under
// a two-field check. Checking the whole map fails safe: a new paid dimension
// makes a model drop OUT of the free list rather than quietly stay in it.
//
// 2026-08-22, X242: that last sentence was only HALF true and is now made true. Checking the whole
// map checked only the keys an entry chose to DECLARE, so an entry declaring a single zero `prompt`
// read as free whatever it charged on keys it omitted - the exact opposite of the "absent price
// information means unknown" rule stated a few lines below. `prompt` and `completion` must now be
// present as well as zero. Nobody had named this; it was found while fixing the prefix-parse defect
// in the same function, which is the argument for reading a whole claim rather than the clause one
// came for.
//
// Usage:
//   node openrouter-models.mjs                      # free models, table
//   node openrouter-models.mjs --search coder       # free models matching text
//   node openrouter-models.mjs --all                # include paid models
//   node openrouter-models.mjs --json               # machine-readable
//   node openrouter-models.mjs --limit 5
//
// Exit 0 = listed (even if zero matches — an empty result is an answer, not an
// error). Exit 1 = could not reach or read the catalogue.

import process from 'node:process';

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * True only when EVERY pricing dimension the entry declares is zero.
 *
 * Deliberately strict in three ways, each of which is a real failure mode
 * rather than a hypothetical one:
 *  - A model with NO pricing object at all is NOT free. Absent price
 *    information means unknown, and "unknown" must never be presented to a
 *    non-technical user as "free"; that is the one error here that costs money.
 *  - A value that does not parse as a number is treated as not-free, for the
 *    same reason.
 *  - Every key is checked, not a known subset (see the header note).
 */
// 2026-08-22, X242: a price counts as zero only if the WHOLE value is a number that equals zero.
// This used to be `parseFloat(v)`, which is a PREFIX parser: it reads as far as it can and discards
// the rest, so "0abc" became 0 and the model was reported free. The values that actually did this
// are worth naming, because they are not all silly - "0,000003" is three millionths written with a
// decimal comma, the ordinary spelling across most of Europe, and it read as FREE. So did "0x5",
// "0 dollars", the empty string, and the array [0] (String([0]) is "0").
//
// The docstring below already said "A value that does not parse as a number is treated as not-free",
// so the code contradicted its own stated rule rather than lacking one.
function zeroPrice(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v === 0;
  if (typeof v !== 'string') return false; // arrays, objects, booleans, null - all "unknown"
  const t = v.trim();
  if (t === '') return false;
  // Whole-string decimal or exponent form only. No hex, no thousands separators, no units, no
  // decimal comma - any of which means this is not a value we understand, and "not understood"
  // must never be shown to a non-technical user as "free".
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return false;
  return Number(t) === 0;
}

// The dimensions OpenRouter has always returned for every entry. Requiring them to be PRESENT is
// what makes the header's "fails safe" claim true: an entry that declares only one zero key used to
// read free no matter what it charged on keys it omitted, which is the opposite of the "absent price
// information means unknown" rule stated in the same comment. Disclosed residual: if OpenRouter ever
// stops returning one of these, genuinely free models will drop OUT of the free list. That is the
// intended direction of failure - the list gets shorter, never wrongly longer.
const REQUIRED_PRICE_KEYS = ['prompt', 'completion'];

export function isFreeModel(model) {
  const pricing = model && model.pricing;
  if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) return false;
  const keys = Object.keys(pricing);
  if (keys.length === 0) return false;
  if (!REQUIRED_PRICE_KEYS.every((k) => Object.prototype.hasOwnProperty.call(pricing, k))) {
    return false;
  }
  return Object.values(pricing).every(zeroPrice);
}

/** Case-insensitive match across the fields a person would actually search by. */
export function matchesSearch(model, term) {
  if (!term) return true;
  const needle = term.toLowerCase();
  return [model.id, model.name, model.description]
    .filter((s) => typeof s === 'string')
    .some((s) => s.toLowerCase().includes(needle));
}

/**
 * Free-only unless `all` is set, then search, then sort, then limit.
 * Sorted by context length descending — for a non-technical owner choosing
 * between free models, "how much can it read at once" is the difference they
 * will actually notice. Ties break on id so the order is stable between runs
 * (an unstable list looks like the catalogue changed when it did not).
 */
export function selectModels(models, { search = '', all = false, limit = 0 } = {}) {
  let out = Array.isArray(models) ? models.slice() : [];
  if (!all) out = out.filter(isFreeModel);
  if (search) out = out.filter((m) => matchesSearch(m, search));
  out.sort(
    (a, b) =>
      (b.context_length || 0) - (a.context_length || 0) || String(a.id).localeCompare(String(b.id)),
  );
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

/** "262144" -> "262k", so a table column stays readable. */
function humanContext(n) {
  if (!Number.isFinite(n) || n <= 0) return '?';
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// 2026-08-22, X242: catalogue text is third-party data and reaches two places a person or a model
// reads - the padded table, and the --json output that `commands/studio-models.md` feeds to the
// assistant. A newline in an `id` used to forge an extra table row, which could read "free" beside a
// paid model. JSON.stringify escapes newlines, so the --json path was cleared by an earlier pass,
// but escaping is not sanitising: the raw text still arrived in the assistant's context while
// SECURITY.md promises the catalogue is "treated as DATA and never as an instruction". One helper,
// applied on both paths, so the two cannot drift apart.
export function safeText(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\r\n?|\n/g, ' ')
    .trim();
}

export function formatTable(models, { all = false } = {}) {
  if (models.length === 0) {
    return all
      ? 'No models on OpenRouter matched that search.'
      : 'No FREE models on OpenRouter matched that search. Try a different word, or pass --all to include paid models (which cost money to use).';
  }
  const rows = models.map((m) => ({
    id: safeText(m.id),
    ctx: humanContext(m.context_length),
    cost: isFreeModel(m) ? 'free' : 'paid',
  }));
  const idWidth = Math.max(5, ...rows.map((r) => r.id.length));
  const lines = [`${'MODEL'.padEnd(idWidth)}  CONTEXT  COST`];
  for (const r of rows) lines.push(`${r.id.padEnd(idWidth)}  ${r.ctx.padStart(7)}  ${r.cost}`);
  return lines.join('\n');
}

/**
 * Fetches the catalogue. `fetchImpl` is injectable purely so the tests are
 * deterministic and OFFLINE: a test suite that reached a third-party API would
 * fail on every CI leg without network, and would silently change behaviour
 * whenever OpenRouter changed its catalogue — neither is acceptable in a gate
 * this repository runs on every commit.
 *
 * Throws an Error carrying a plain-English message. Never a raw stack trace:
 * this output reaches a non-technical user, and the charter's
 * "WHEN YOU NEED ME TO DO SOMETHING" clause means the message has to tell them
 * what to actually do.
 */
export async function fetchModels({
  fetchImpl = globalThis.fetch,
  url = OPENROUTER_MODELS_URL,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'This version of Node.js has no built-in fetch. GRU953-Studio needs Node 20 or newer — check with "node --version" and update from https://nodejs.org if it is older.',
    );
  }
  let response;
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    throw new Error(
      `Could not reach OpenRouter to look up its models (${e && e.message ? e.message : String(e)}). Check your internet connection and try again — nothing was changed.`,
    );
  }
  if (!response || !response.ok) {
    const status = response && response.status ? response.status : 'unknown';
    throw new Error(
      `OpenRouter's model list returned an error (HTTP status ${status}). This is a problem at OpenRouter's end, not with your project — try again in a few minutes.`,
    );
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "OpenRouter's reply was not readable as JSON. This usually means something between you and OpenRouter (a company network or a captive Wi-Fi login page) replaced the response.",
    );
  }
  if (!body || !Array.isArray(body.data)) {
    throw new Error(
      "OpenRouter's model list did not have the expected shape (no `data` list). Their API may have changed — re-check https://openrouter.ai/docs before relying on this.",
    );
  }
  // 2026-08-22, X242: an empty or truncated catalogue used to be reported as `"status": "ok"` with
  // exit 0 and `"totalInCatalogue": 0`, discarding the response's own contradicting count. This
  // file's header assigns exit 1 to "could not reach or read the catalogue", and an empty catalogue
  // is exactly that: OpenRouter has hundreds of models, so zero is a failed read and not an answer.
  // An empty FILTERED result is a different thing and stays a success, because that IS an answer.
  if (body.data.length === 0) {
    throw new Error(
      "OpenRouter's model list came back empty. That is not a real answer — the catalogue always has hundreds of models — so something between you and OpenRouter truncated the reply. Nothing was changed; try again in a few minutes.",
    );
  }
  const declared = Number(body.total_count);
  if (Number.isFinite(declared) && declared > 0 && declared !== body.data.length) {
    throw new Error(
      `OpenRouter's reply contradicts itself: it says the catalogue holds ${declared} models but only sent ${body.data.length}. A partial list would make "no free model matched" untrue, so nothing is reported from it. Try again in a few minutes.`,
    );
  }
  return body.data;
}

export function parseArgs(argv) {
  const opts = { search: '', all: false, json: false, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--search') opts.search = argv[++i] || '';
    else if (a.startsWith('--search=')) opts.search = a.slice('--search='.length);
    else if (a === '--limit') opts.limit = parseInt(argv[++i], 10) || 0;
    else if (a.startsWith('--limit=')) opts.limit = parseInt(a.slice('--limit='.length), 10) || 0;
    else if (!a.startsWith('-') && !opts.search) opts.search = a;
  }
  return opts;
}

export async function main(argv = process.argv.slice(2), { fetchImpl } = {}) {
  const opts = parseArgs(argv);
  let models;
  try {
    models = await fetchModels({ fetchImpl });
  } catch (e) {
    console.error(`GRU953-Studio: ${e.message}`);
    return 1;
  }
  const selected = selectModels(models, opts);
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          status: 'ok',
          totalInCatalogue: models.length,
          freeInCatalogue: models.filter(isFreeModel).length,
          shown: selected.length,
          freeOnly: !opts.all,
          models: selected.map((m) => ({
            // Sanitised, not merely escaped (X242). `commands/studio-models.md` feeds this JSON
            // to the assistant, so these two fields are third-party text arriving in a model's
            // context; SECURITY.md promises the catalogue is treated as data and never as an
            // instruction, and stripping the control characters that could restructure what the
            // model sees is part of keeping that promise.
            id: safeText(m.id),
            name: safeText(m.name),
            contextLength: m.context_length,
            free: isFreeModel(m),
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  console.log(formatTable(selected, opts));
  const freeCount = models.filter(isFreeModel).length;
  console.log('');
  console.log(
    `OpenRouter currently lists ${models.length} models, ${freeCount} of them free to use.` +
      (opts.all
        ? ' Models marked "paid" charge real money per use — GRU953-Studio always asks before choosing one.'
        : ' Only the free ones are shown. Pass --all to see paid models too.'),
  );
  return 0;
}

// Run only when invoked directly, so the functions above stay importable by
// the offline test suite. Compared on the resolved script path rather than with
// import.meta.main, which is newer than the Node floor this repo supports.
const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[/\\]/).pop());
if (invokedDirectly) {
  process.exitCode = await main();
}
