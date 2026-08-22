#!/usr/bin/env node
//
// content-check.mjs — proves the app's generated content is fit to ship: every
// asset recorded in Dev-Memory/CONTENT.md carries a recorded approval, its
// provenance (which model/prompt made it, or that a human supplied it), a plain
// rights/licence note, and — for media — alt-text or a caption. Zero
// dependencies (Node stdlib only).
//
// Added 2026-07-19 (Content Creation, see the `content-creation` and
// `gemini-integration` skills). AI-generated media that ships without recorded
// approval, provenance and rights is a real gold-standard and legal risk; this
// makes the manifest mechanical, like quality-gate.mjs does for the Definition
// of Done.
//
// Like verify-progress.mjs / quality-gate.mjs / traceability-check.mjs this is a
// maintainer/CI + pre-Publish check, NOT a PreToolUse runtime hook. It fails
// CLOSED on any recorded-but-incomplete asset. A project with no CONTENT.md has
// declared no content, so there is nothing to verify — clean no-op (content is
// optional; not every app has generated media).
//
// Usage: node content-check.mjs [projectRoot]
// Exit 0 = not a studio project / no content declared / every asset complete.
// Exit 1 = a recorded asset is missing approval, provenance, rights or alt-text.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { stripBom, isDirectory, deEmphasise, parseTables } from './lib.mjs';

// 2026-07-29 maintenance fix (audit finding 4): kept as its own separate
// constant rather than importing lib.mjs's shared PLACEHOLDER_RE — this one
// is a deliberate SUPERSET (it additionally accepts "pending"/"placeholder"),
// used for a different purpose (content provenance/rights, not evidence) than
// the identical-except-for-this copy memory-integrity.mjs/quality-gate.mjs/
// traceability-check.mjs shared and had drifted apart on, so it is not part
// of that three-way sync.
const PLACEHOLDER_RE = /^(|[-—–]+|tbd|todo|none|n\/?a|\.\.\.|pending|placeholder)$/i;
const APPROVED_RE = /^\s*(approved|yes|pass(ed)?|ok|done|signed[ -]?off|human|final)\b/i;
// Found 2026-07-19: matching FOR media by English keyword silently skipped
// the alt-text/caption requirement for any non-English Medium value (e.g.
// Bangla "ছবি" for "image") — a real accessibility gap given this project's
// Bangla+English content. Inverted to fail closed: a row needs alt-text
// unless its Medium is explicitly, recognisably TEXT (in English or
// Bangla) — ambiguous or foreign-language values default to requiring it,
// never to silently skipping it.
// 2026-08-05 further-pass audit fix (found by execution): the `text\b` / `ui[-
// ]?text\b` / `in-app[- ]?text\b` alternatives used a plain word boundary, and
// a hyphen is also a word boundary — so a Medium of "text-to-speech audio" (or
// "ui-text-to-speech") matched TEXT_ONLY_RE and silently skipped the
// alt-text/transcript requirement for a TTS AUDIO asset. A negative lookahead
// now rejects a dash/hyphen or the spaced "to" right after the text token, so
// only genuinely text Media count: "text", "plain text", "ui text" still do;
// "text-to-speech", "text to speech", "ui-text-to-speech" no longer do and
// correctly fall through to needing alt-text/transcript.
const TEXT_ONLY_RE =
  /^(text\b(?![ \t]*(?:[-–—]|to\b))|copy\b|microcopy\b|string\b|label\b|wording\b|ui[- ]?text\b(?![ \t]*(?:[-–—]|to\b))|in-app[- ]?text\b(?![ \t]*(?:[-–—]|to\b))|টেক্সট|লেখা|কপি)/i;

// 2026-07-26 audit finding 6 (fail-OPEN). This returned null for BOTH "the file
// isn't there" and "the file is there but I couldn't read it", and main() treats
// null as "no content declared — a project may legitimately have none" and exits
// 0. So an unreadable CONTENT.md — a permissions problem, a directory where a
// file should be, a half-written file on a full disk — silently passed the gate
// that is supposed to guarantee every shipped asset has approval, provenance,
// rights and alt-text.
//
// The distinction is now explicit and typed. ENOENT is genuinely absent and
// still stands down; anything else is a read FAILURE and blocks, matching how
// its sibling quality-gate.mjs already behaves. A gate that cannot read its
// input must never claim its input is fine.
const MISSING = Symbol('missing');
// 2026-07-26, audit finding 26. Deliberate hardening, not a demonstrated-bug
// fix — checked by execution rather than assumed: the table-row test below
// (`/^\s*\|/`) already tolerates a leading BOM by accident, because
// JavaScript's `\s` class matches U+FEFF. stripBom() stops that correctness
// depending on the accident. (memory-integrity.mjs and dashboard.mjs DID
// have a real, reproduced BOM bug: both use a strict `^#` heading regex with
// no `\s*` prefix, which a BOM genuinely defeats.)
function read(p) {
  try {
    return stripBom(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    if (e && e.code === 'ENOENT') return MISSING;
    throw e; // surfaced by main()'s handler as a BLOCKING, explained problem
  }
}
// 2026-08-13: the local cells() helper was removed with finding X10's fix. Cell
// splitting and outer-pipe normalisation now happen once, in lib.mjs's shared
// parseTables(), so all five gates read a table the same way instead of each
// keeping its own near-identical copy.
// 2026-07-29 maintenance fix (round 3, F1): tested the raw cell, so a
// placeholder disguised in bold, e.g. "**tbd**", still failed PLACEHOLDER_RE
// as-is and was wrongly accepted as real provenance/rights/alt-text — the
// same value-cell gap this file's own APPROVED_RE/TEXT_ONLY_RE deEmphasise()
// fix (audit finding 3) already closed for the Approved/Medium columns.
function ph(s) {
  return PLACEHOLDER_RE.test(deEmphasise(String(s || '')).trim());
}

function main() {
  const root = process.argv[2] || process.cwd();
  const devMemory = path.join(root, 'Dev-Memory');
  // 2026-07-26 Stage 3 fix (audit finding 22): was two separate, unguarded
  // calls (existsSync then statSync) racing against anything else that might
  // touch this path in between — the second call had no try/catch of its
  // own, so Dev-Memory disappearing (or a permissions problem) between the
  // two threw a raw stack trace instead of this project's own plain-English
  // contract. isDirectory() makes this one guarded call.
  if (!isDirectory(devMemory)) {
    console.log(
      JSON.stringify({
        status: 'not a studio project',
        reason: 'no Dev-Memory/ directory — nothing to check',
        root,
      }),
    );
    process.exit(0);
  }
  const contentPath = path.join(devMemory, 'CONTENT.md');
  let text;
  try {
    text = read(contentPath);
  } catch (e) {
    // 2026-07-26 audit finding 6: fail CLOSED, and say why in plain English so
    // the user can act on it rather than guess.
    console.log(
      JSON.stringify(
        {
          status: 'BLOCKED',
          reason:
            'CONTENT.md exists but could not be read, so its assets cannot be checked for approval, provenance, rights and alt-text',
          file: 'Dev-Memory/CONTENT.md',
          detail: `${e.code || 'read error'}: ${e.message}`,
          fix: 'Make Dev-Memory/CONTENT.md readable (check it is a file, not a folder, and that you have permission to read it), then run this check again.',
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  if (text === MISSING) {
    // No content declared — a project may legitimately have none.
    console.log(
      JSON.stringify({
        status: 'clean',
        reason: 'no CONTENT.md — no generated content declared for this project',
      }),
    );
    process.exit(0);
  }

  // Parse the content table; locate its columns by header. `idx` is captured
  // once, for the content table (the one with an asset/medium column). After that
  // table ends, every later table is ignored (see the break below), so a second,
  // unrelated table's rows are never validated against the content table's columns.
  // 2026-08-13, finding X10 (reproduced by execution — see
  // test/repro/phase1-gate-honesty.mjs case P2). The version above captured the
  // FIRST asset table and then `break`-ed out on the next non-table line, so
  // every later table went unvalidated. Grouping the register by medium —
  // `## Images` then `## Audio` then `## Text`, the obvious way to organise it —
  // therefore hid every asset after the first group. Reproduced: a second table
  // holding `hero-banner.png | image | unknown, found on the web | tbd | unknown
  // licence | —` returned `{"status":"clean","assets":2}`. It counted the asset
  // and cleared it.
  //
  // Now EVERY table with an asset-like or medium-like column is validated, and
  // each row carries its OWN column map — which is what the 2026-07-21 fix was
  // really protecting against. That fix stopped one table's column positions
  // being applied to another table's rows; it did that by ignoring the later
  // tables entirely, when the precise fix is to give each table its own indices.
  // Both risks are now closed at once.
  //
  // A RAGGED row (column count disagreeing with its header) can no longer be
  // read positionally, so it is reported rather than skipped — the same
  // discipline verify-progress.mjs and quality-gate.mjs apply.
  const rows = [];
  const ragged = [];
  let sawContentTable = false;
  for (const table of parseTables(text)) {
    // 2026-07-29 maintenance fix, preserved: deEmphasise() so a bolded header
    // like "**Approved**" is recognised the same as "Approved".
    const find = (re) => table.headerCells.findIndex((h) => re.test(deEmphasise(h)));
    const found = {
      // 2026-08-15, finding X122, second attempt. A register headed
      // `| Assets | Media | … |` — both key headers pluralised, the likeliest slip — was
      // not recognised, so its rows were skipped in silence.
      //
      // The FIRST fix guessed: it flagged any table matching two or more of the six
      // content columns while lacking asset/medium. An adversarial pass then showed that
      // guess blocking seven of thirteen realistic auxiliary tables — `| Model | Status |`
      // and `| Licence | Status |` among them — each a Publish-blocking false alarm on a
      // perfectly ordinary content register. It was reverted.
      //
      // This is the precise fix instead: tolerate the plural. A mistyped register is then
      // simply RECOGNISED and its rows validated on their merits, with no heuristic
      // deciding what a table "looks like". Recognition beats guessing.
      asset: find(/^(assets?|names?|files?|items?)$/i),
      medium: find(/^(mediums?|media|types?|kinds?)$/i),
      // 2026-08-15, finding X121, on the owner's decision of the same date. Until now this
      // gate checked a row's paperwork and never that the asset existed — a wholly imaginary
      // `totally-imaginary.svg` passed as clean, with the reason "every recorded content asset
      // has approval, provenance, rights and (for media) alt-text", which was true and
      // meaningless. Nothing could resolve a name to a file, because nothing said where assets
      // live, so this went to the owner as a convention decision rather than a gate fix.
      //
      // The decision: a path in each register row. It handles text rows that are not files at
      // all, works whatever layout a project uses, and imposes no folder rule.
      path: find(/^(paths?|file ?paths?|locations?|where)$/i),
      source: find(/^(source|provenance|model|origin|by)$/i),
      approved: find(/^(approved|approval|status|sign[- ]?off)$/i),
      rights: find(/^(rights|licen[cs]e|usage)$/i),
      // 2026-07-21 Round 6 fix, preserved: also accept the documented template
      // header "Alt/Caption" and other slash/space-joined synonyms.
      alt: find(
        /^(alt|alt[- ]?text|caption|transcript|accessibility|a11y)([\/ ]?(alt|caption|text|transcript))*$/i,
      ),
    };
    if (found.asset === -1 && found.medium === -1) continue; // not a content table
    sawContentTable = true;
    for (const r of table.rows) {
      if (r.ragged) {
        // X201: carry WHICH kind of raggedness, so the message below can be true.
        if (r.cells.some((c) => c !== '')) ragged.push({ raw: r.raw.trim(), short: r.short });
        continue;
      }
      rows.push({ cells: r.cells, idx: found });
    }
  }

  const problems = [];
  if (!sawContentTable) {
    // CONTENT.md exists but has no readable asset table — treat as incomplete.
    problems.push(
      'CONTENT.md has no recognisable content table (need columns for asset, medium, source/provenance, approved, rights).',
    );
  } else if (rows.length === 0) {
    // 2026-08-13, independent-review finding F2 (reproduced regression). Changing
    // this condition from `rows.length === 0` to `!sawContentTable` let a
    // HEADER-ONLY register pass — a content table created and never filled in
    // returned `{"status":"clean","assets":0}`, where the previous version
    // correctly refused it. "No content at all" is already expressed by having no
    // CONTENT.md, which this gate treats as a clean no-op; an empty register is a
    // different thing, and it is the shape of a step someone started and forgot.
    problems.push(
      'CONTENT.md has a content table with no rows — an empty register is not the same as having no content. Either record the assets, or delete CONTENT.md if this project genuinely ships no generated content.',
    );
  }
  for (const r of ragged) {
    // X201: a SHORT row is legal markdown and nothing is shifted; telling the user to escape a
    // pipe that is not there sends them hunting a defect that does not exist.
    problems.push(
      r.short
        ? `a content row has FEWER cells than its header, so a trailing column is absent and this row's approval or rights cannot be read -> "${r.raw}" (a short row is legal markdown - add the missing cell, or a trailing "|" for each empty one)`
        : `a content row has MORE cells than its header, so its values line up against the wrong columns and its approval and rights cannot be verified -> "${r.raw}" (an unescaped "|" inside a cell is the usual cause - write it as \\|)`,
    );
  }
  for (const row of rows) {
    const r = row.cells;
    const idx = row.idx;
    const name =
      (idx.asset !== -1 && r[idx.asset]) || (idx.medium !== -1 && r[idx.medium]) || 'asset';
    const medium = idx.medium !== -1 ? r[idx.medium] || '' : '';
    const approved = idx.approved !== -1 ? r[idx.approved] || '' : '';
    const source = idx.source !== -1 ? r[idx.source] || '' : '';
    const rights = idx.rights !== -1 ? r[idx.rights] || '' : '';
    const alt = idx.alt !== -1 ? r[idx.alt] || '' : '';

    // 2026-07-29 maintenance fix (audit finding 3): the header-matching
    // deEmphasise() fix above only reached header cells — a VALUE cell like
    // "**approved**" or "**yes**" still failed APPROVED_RE/TEXT_ONLY_RE as-is
    // and was wrongly BLOCKED. Same fix, one layer deeper (verify-progress.mjs
    // already de-emphasises its status VALUE the same way).
    if (idx.approved === -1 || !APPROVED_RE.test(deEmphasise(approved)))
      problems.push(
        `content "${name}": not approved (status "${approved || '(none)'}") — every shipped asset needs a recorded approval.`,
      );
    if (idx.source === -1 || ph(source))
      problems.push(
        `content "${name}": no provenance recorded — which model/prompt made it, or that a human supplied it.`,
      );
    if (idx.rights === -1 || ph(rights))
      problems.push(
        `content "${name}": no rights/licence note — AI-generated or sourced media needs a plain rights note.`,
      );
    const isTextOnly = idx.medium !== -1 && TEXT_ONLY_RE.test(deEmphasise(medium));
    if (!isTextOnly && (idx.alt === -1 || ph(alt)))
      problems.push(
        `content "${name}": media asset has no alt-text/caption/transcript — required for accessibility.`,
      );

    // X121: does the recorded asset actually exist? Only answerable when the register
    // carries a Path column, which is why the column is the owner's chosen convention.
    if (idx.path !== -1) {
      const rawPath = idx.path !== -1 ? String(r[idx.path] || '') : '';
      const assetPath = deEmphasise(rawPath).trim();
      if (ph(assetPath)) {
        // A text asset is in-app copy, not a file on disk, so an empty path is correct.
        // A media asset with no path cannot be checked at all, which is the gap X121 exists
        // to close — so it is a problem rather than a silent pass.
        if (!isTextOnly)
          problems.push(
            `content "${name}": media asset records no path, so nothing can confirm it exists. Give its path in the Path column (finding X121).`,
          );
      } else {
        // Resolved against the project root, and confined to it: a register must not send
        // this gate walking outside the project it describes.
        const resolved = path.resolve(root, assetPath);
        if (!resolved.startsWith(path.resolve(root))) {
          problems.push(
            `content "${name}": path "${assetPath}" resolves outside the project, which a content register may not do (finding X121).`,
          );
        } else if (!fs.existsSync(resolved)) {
          problems.push(
            `content "${name}": recorded at "${assetPath}", but no file exists there — an asset that is approved, attributed and licensed but absent is not shippable (finding X121).`,
          );
        }
      }
    }
  }

  if (problems.length === 0) {
    // X121: say what was NOT checked. A register with no Path column cannot have its assets
    // resolved to files, and the old reason — "every recorded content asset has approval,
    // provenance, rights and (for media) alt-text" — was true while a wholly imaginary asset
    // sat in the register. It never claimed to check existence, but nothing said it hadn't,
    // and a silence that reads as assurance is the defect this whole round of findings is
    // about. The column stays optional so every register written before today keeps working;
    // what changes is that its clean verdict now admits the gap instead of implying coverage.
    // 2026-08-16, finding X195. This was `rows.some(...)`, over rows drawn from EVERY table in
    // the register. A register grouped by medium — "## Artwork" carrying a Path column,
    // "## Sound" not — therefore reported assetExistenceChecked: true and "a file where it
    // says it is", while the sound assets were never resolved to anything at all.
    //
    // That is a positive false statement made by the one field whose entire purpose is to stop
    // silence being mistaken for a check, and grouping a register by medium is the ordinary way
    // to write one. Coverage is now claimed only when EVERY row could be checked; a partial
    // register says how far the check reached instead of rounding it up.
    //
    // It deliberately does not start BLOCKING. The Path column is optional by design, and
    // failing a partial register would break every register written before X121 landed — which
    // is what the optionality was for. X195's controls A and E hold both halves of that.
    // 2026-08-18, X195 SECOND repair. The count above was the right move applied to the wrong
    // quantity: `row.idx.path !== -1` asks whether the row's TABLE carries a Path column, not
    // whether the row's Path CELL holds anything. A register whose every Path cell was empty
    // therefore reported assetExistenceChecked: true, assetsExistenceChecked: 2 and "a file where
    // it says it is" after ZERO filesystem checks — the original defect verbatim, and L16 besides:
    // a count no independent count supports.
    //
    // There are genuinely three outcomes, so three are counted. An in-app text asset with no path
    // is not a gap — text is copy, not a file — but it is not a check either, and the difference
    // is exactly what this field exists to report.
    let resolvedRows = 0; // the Path cell held a value and a real check ran
    let textNoPathRows = 0; // in-app copy: nothing to resolve, legitimately
    let unresolvableRows = 0; // no Path column, or media with no path (a problem already raised)
    for (const row of rows) {
      if (row.idx.path === -1) {
        unresolvableRows += 1;
        continue;
      }
      const cell = deEmphasise(String(row.cells[row.idx.path] || '')).trim();
      if (!ph(cell)) {
        resolvedRows += 1;
        continue;
      }
      const med = row.idx.medium !== -1 ? deEmphasise(String(row.cells[row.idx.medium] || '')) : '';
      if (row.idx.medium !== -1 && TEXT_ONLY_RE.test(med)) textNoPathRows += 1;
      else unresolvableRows += 1;
    }
    // `checkedRows` and `unchecked` stood here as aliases kept while the reason strings were
    // rewritten, and nothing consumed them afterwards — eslint duly reported both as unused. Removed
    // rather than left: a variable named `checkedRows` beside a field named assetsExistenceChecked is
    // exactly the kind of near-duplicate that gets read as the authority and drifts from it.
    const assetExistenceChecked = rows.length > 0 && resolvedRows > 0 && unresolvableRows === 0;
    console.log(
      JSON.stringify(
        {
          status: 'clean',
          reason: assetExistenceChecked
            ? `every recorded content asset has approval, provenance, rights, (for media) alt-text, and a file where it says it is${textNoPathRows > 0 ? ` (${textNoPathRows} of ${rows.length} ${textNoPathRows === 1 ? 'is in-app copy with no file to resolve' : 'are in-app copy with no file to resolve'})` : ''}`
            : resolvedRows === 0
              ? `every recorded content asset has approval, provenance, rights and (for media) alt-text. Whether any asset EXISTS was NOT verified: ${textNoPathRows === rows.length ? 'every row is in-app copy with no path, so there was no file to resolve' : 'no row names a path that could be resolved to a file'} — so no existence check was performed at all (findings X121, X195)`
              : `every recorded content asset has approval, provenance, rights and (for media) alt-text. Existence was verified for ${resolvedRows} of ${rows.length}: ${unresolvableRows} could not be resolved (no Path column, or a media asset with no path)${textNoPathRows > 0 ? `, and ${textNoPathRows} is in-app copy with no file` : ''} (finding X195)`,
          assets: rows.length,
          assetExistenceChecked,
          assetsExistenceChecked: resolvedRows,
          assetsInAppCopyNoFile: textNoPathRows,
          assetsUnresolvable: unresolvableRows,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
  console.log(
    JSON.stringify({ status: 'BLOCKED', reason: 'content manifest incomplete', problems }, null, 2),
  );
  process.exit(1);
}

main();
