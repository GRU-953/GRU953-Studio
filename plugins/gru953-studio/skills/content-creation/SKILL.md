---
name: content-creation
description: The Content stage — after a prototype is approved, plan and generate the app's real content (text, image, audio, video) from the spec and warframe, before Build consumes it. Defines the content plan, the Dev-Memory/CONTENT.md manifest (provenance, approval, rights, alt-text), platform-appropriate output, and how content tasks weave into the phased build. Text is generated natively by Claude in Bangla + English; image, audio and video are SPECIFIED by media-content-specialist as platform-correct asset briefs with alt-text and a rights note, for the owner to supply — 7.0.0 carries no external media provider. Use at the Content stage and whenever an asset is generated or revised.
---

# Content Creation

## Why this exists

A built app shell is not a finished app — it needs real content: copy, images,
audio, video. User-requested 2026-07-19: after the prototype is approved, add a
specialist content team that generates the app's content from the software
specification and the approved warframe. This skill is the Content stage that
does it. Plain-English rule is as set in the
`operating-charter` skill.

## Where it sits in the lifecycle

A real stage between **Prototype** and **Plan**:

```
… → Prototype → [CONTENT] → Plan → Build → …
```

After the hard-gated warframe approval (`warframe-prototype`), the
`content-director` plans all content from `OBJECTIVE.md`, `ARCHITECTURE.md` and
the approved warframe, generates the up-front bulk, and records the rest as
content tasks in the phased `PLAN.md` — so an asset that depends on final UI is
produced in the build phase that needs it, and everything is ready when Build
reaches it.

## The two engines

- **Text → Claude, natively, Bangla + English** (`text-content-specialist`). In
  scope for the MVP: in-app copy and microcopy — UI labels, buttons, onboarding,
  empty states, error messages, notifications — in both languages, matched to
  the spec and prototype and wired into the app's i18n keys via
  `localisation-specialist`. Extensible later to store listings and marketing.
- **Image / audio / video → specified, not generated** (`media-content-specialist`).
  For each asset it writes a brief — what it depicts, every platform format and
  density required, the alt-text in full, and a rights note — plus a numbered
  step-by-step guide for the owner to produce it. No external provider, no API
  key, no per-generation cost, and nothing sent to a third party.

  (Until v7.0.0 media was generated through an opt-in paid Google integration, by
  three separate roles, behind an approval prompt shown before *every* generation.
  v7 targets Claude Code only and carries no model integrations. What remains is
  the path the product already documented for when no key was available; the
  role's value was never the API call but knowing that an iOS icon needs
  @1x/@2x/@3x and that an asset with no recorded rights is a liability.)

Which model and effort each piece of TEXT uses is chosen by the shared
`model-router`, so content generation plans and switches models like the code side
does.

## The content plan and the CONTENT.md manifest

The `content-director` produces a content plan (what content each screen/flow
needs, in which languages, which media) and records every asset in
`Dev-Memory/CONTENT.md` (written by `memory-keeper`, secrets-scanned as always):

| Asset | Path | Medium | Source | Approved | Rights | Alt/Caption |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| welcome_hero.png | assets/img/welcome_hero.png | image | brief in CONTENT.md — owner-supplied | approved | owner-supplied, rights held by owner | Family using the app |
| onboarding copy | | text | Claude (bn+en) | approved | original | — |

**The `Path` column** (added 2026-08-15, finding X121). It records where the asset actually is,
relative to the project root, so `content-check.mjs` can confirm the file exists rather than
only that its paperwork is filled in. Without it, a wholly imaginary asset passed as clean.

- **Media rows must have one.** An image, audio or video asset that records no path cannot be
  checked at all, so the gate refuses it.
- **Text rows leave it empty.** In-app copy is not a file on disk, and an empty path is correct
  for it — the gate does not ask where a string lives.
- **Any layout works.** There is no required folder; the row says where its own asset is. A
  path that resolves outside the project is refused.
- **Registers written before this date still pass.** The column is optional, and a register
  without it is reported as clean *with `assetExistenceChecked: false`* and a plain sentence
  saying existence was not verified — so the silence cannot be mistaken for a check.

Every row needs a recorded **approval**, **provenance** (which model + prompt,
or that a human supplied it), a plain **rights/licence** note, and — for media —
**alt-text / caption / transcript**. `hooks/content-check.mjs` enforces this
before Publish (part of the Publish gate); a placeholder or unapproved asset
blocks the release.

## Platform-appropriate output

Content is produced in the shapes each target platform needs (see the
architect's platform map):

- **Images**: per-platform icon sets and densities (iOS @1x/2x/3x, Android
  mdpi…xxxhdpi, Windows/macOS icon sizes), correct formats.
- **Audio/video**: containers/codecs each platform plays natively.
- **Text**: correct Unicode and fonts, including full **Bangla** shaping; never
  clipped by fixed-width UI (flag layout issues to `ux-designer`).

## Accessibility and brand (part of "done" for content)

- `accessibility-specialist` reviews content: every image has alt-text, every
  audio/video has a caption or transcript.
- `brand-guardian` checks generated text and media against the user's brand.
- `reviewer`'s warframe-parity check extends to content — the shipped content
  matches what the prototype and spec promised, or the change was surfaced.

## Tier-scaling (YAGNI)

A **Tiny** project may need only a handful of text strings — no media, no
manifest ceremony beyond a short list. The full content team, media generation
and `CONTENT.md` earn their place on projects that actually have real content to
produce. A project with no generated content declares none (and
`content-check.mjs` is a clean no-op).

## Who applies this

- **content-director** runs the stage and owns the plan and `CONTENT.md`.
- **text-content-specialist** generates text natively; **media-content-specialist**
  writes an asset brief plus a step-by-step guide for every image, audio and video
  asset, and generates none of them.
- **memory-keeper** writes `CONTENT.md`; **security-compliance-auditor** runs
  `content-check.mjs` before Publish.

  (2026-08-27: this section said content-director "holds the Gemini opt-in
  decision", that four specialists "generate their medium", and that project-lead
  "shows the per-media-generation approval pop-up". All three describe 7.0.0's
  removed provider, and the last is a prompt an unattended run cannot answer —
  already contradicted by `media-content-specialist.md`, which records that
  removing it was the point. A missing decorative asset never blocks working
  software: record the placeholder against its brief and carry on.)
