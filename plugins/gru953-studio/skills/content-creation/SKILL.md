---
name: content-creation
description: The Content stage — after a prototype is approved, plan and generate the app's real content (text, image, audio, video) from the spec and warframe, before Build consumes it. Defines the content plan, the Dev-Memory/CONTENT.md manifest (provenance, approval, rights, alt-text), platform-appropriate output, and how content tasks weave into the phased build. Text is generated natively by Claude in Bangla + English; image/audio/video use the opt-in gemini-integration. Use at the Content stage and whenever an asset is generated or revised.
---

# Content Creation

## Why this exists

A built app shell is not a finished app — it needs real content: copy, images,
audio, video. User-requested 2026-07-19: after the prototype is approved, add a
specialist content team that generates the app's content from the software
specification and the approved warframe. This skill is the Content stage that
does it. Plain-English rule is as set in the `studio` skill.

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
- **Image / audio / video → opt-in Gemini** (`image-`/`audio-`/`video-content-specialist`
  via the `gemini-integration` skill). Off by default; the user's own key; a
  cost estimate and "sent to Google" notice before **every** generation; a
  numbered step-by-step guide when a human must supply an asset instead.

Which model and effort each piece uses is chosen by the shared `model-router`
(Claude tiers for text; the Gemini capability registry for media), so content
generators plan, select and switch models like the code side does.

## The content plan and the CONTENT.md manifest

The `content-director` produces a content plan (what content each screen/flow
needs, in which languages, which media) and records every asset in
`Dev-Memory/CONTENT.md` (written by `memory-keeper`, secrets-scanned as always):

| Asset | Medium | Source | Approved | Rights | Alt/Caption |
| :-- | :-- | :-- | :-- | :-- | :-- |
| welcome_hero.png | image | Gemini image, prompt #4 | approved | AI-generated, user owns output | Family using the app |
| onboarding copy | text | Claude (bn+en) | approved | original | — |

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

- **content-director** runs the stage, owns the plan and `CONTENT.md`, holds the
  Gemini opt-in decision.
- **text/image/audio/video content specialists** generate their medium.
- **project-lead** shows the per-media-generation approval pop-up;
  **memory-keeper** writes `CONTENT.md`; **security-compliance-auditor** runs
  `content-check.mjs` before Publish.
