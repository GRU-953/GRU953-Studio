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
export function isFreeModel(model) {
  const pricing = model && model.pricing;
  if (!pricing || typeof pricing !== 'object') return false;
  const values = Object.values(pricing);
  if (values.length === 0) return false;
  return values.every((v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n === 0;
  });
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

export function formatTable(models, { all = false } = {}) {
  if (models.length === 0) {
    return all
      ? 'No models on OpenRouter matched that search.'
      : 'No FREE models on OpenRouter matched that search. Try a different word, or pass --all to include paid models (which cost money to use).';
  }
  const rows = models.map((m) => ({
    id: String(m.id),
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
            id: m.id,
            name: m.name,
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
