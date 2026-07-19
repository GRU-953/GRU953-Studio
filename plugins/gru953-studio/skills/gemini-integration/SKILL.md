---
name: gemini-integration
description: The protocol for generating image, audio and video content with Google's Gemini cloud models (e.g. the nano-banana image model, Veo for video) — the studio's first external cloud service, so it is strictly opt-in, uses the user's own API key (never stored or committed), confirms before every generation with a cost estimate and a plain "this content is sent to Google" notice, and degrades gracefully when unavailable. Use whenever the image/audio/video content specialists need to generate media. Text content stays with Claude, not here.
---

# Gemini integration

## Why this exists, and what it deliberately changes

User-requested 2026-07-19: generate app content — image, audio, video — using
Gemini cloud models. This is the studio's **first external cloud dependency**, a
real departure from its zero-dependency, local-only, private default, so it is
handled with matching care: opt-in, the user's own key, cost-visible, and
private-by-notice. Text content is NOT here — it is generated natively by Claude
via the `text-content-specialist`. Plain-English rule is as set in the `studio`
skill.

Every model fact below is time-sensitive: **verify the current model names and
prices against Google's own documentation before use** (the same discipline
`researcher` and `ollama-integration` already apply) — Google renames and
reprices these often.

## Opt-in only — off until the user says yes

Media generation via Gemini never happens unless the user has explicitly turned
it on for this project. The `content-director` asks once, plainly (what it is,
that it uses Google's paid cloud, that content is sent to Google, that it needs
the user's own key), and records the answer. With no opt-in, the studio produces
placeholder assets and a step-by-step guide for the user to supply their own,
never a silent Gemini call.

## The user's own key — never stored, never shipped

- The key is the **user's own Google API key**, provided through their
  environment (an environment variable such as `GEMINI_API_KEY`/`GOOGLE_API_KEY`
  they set themselves). The studio reads it from the environment at call time.
- It is **never written to a project file, never committed, never printed**.
  `hooks/scan.mjs` already blocks Google `AIza…` keys and key-file names from any
  push, so a key that slips into a file cannot ship — but the rule here is that
  it never goes into a file in the first place.
- If no key is set, do not ask the user to paste it anywhere the studio writes;
  give a numbered step-by-step guide to set the environment variable in their
  own shell, then continue.

## Capability registry (refer by what a model does, not a fixed name)

Keep a tiny, **dated** registry mapping capability → the current Gemini model,
verified before use, so the studio stays correct as Google renames things:

| Capability | Current model (verify before use) | Notes |
| :-- | :-- | :-- |
| image | Gemini image model (the "nano-banana" family) | stills, icons, illustration |
| video | Veo | short clips |
| audio / speech | current Gemini audio/TTS model | narration, sound |

The `model-router` picks and switches among these per task (quality vs cost),
just as it does Claude tiers for code and text — see that skill. Referencing by
capability means a renamed model is a one-line registry update, not a hunt
across files.

## Confirm before EVERY generation (cost + privacy)

Media is expensive and leaves the user's machine, so — unlike Claude text, which
runs inline — **each generation is confirmed first**:

1. Show a plain-English **cost estimate** for this generation, and that **the
   prompt/content is sent to Google's servers**.
2. The `project-lead` puts an `AskUserQuestion` approval to the user (generate,
   change the prompt, or skip). Only a clear yes generates.
3. Generate via **REST or a CLI using the user's key** (no bundled SDK — the
   plugin ships no Gemini package, preserving "no third-party code
   dependencies"; use `curl` or whatever the session already provides).
4. `cost-monitor` logs the actual spend for the generation (extends the router
   ledger). The `cost-guard` hard ceiling still applies.
5. Where the built app itself will send a user's data to Google, add a plain
   privacy note to the app so its users know.

## Graceful degrade — never fail on absence

No key, no network, cloud/quotas unavailable, or running where Google can't be
reached (some cloud/web sessions) → the Gemini step **self-disables with a plain
note**, exactly like `ollama-integration` does for a missing local model. The
content specialist then produces a placeholder and a numbered step-by-step guide
for the user to generate/supply the asset themselves. Absence is a normal path,
never an error; and when human input is genuinely required, the guide is simple
and step-by-step.

## Provenance and rights

Every generated asset is recorded in `Dev-Memory/CONTENT.md` (the
`content-creation` skill) with its capability, the model used, the prompt, the
user's approval, and a plain rights/licence note for AI-generated media —
verified by `hooks/content-check.mjs` before Publish.

## Who applies this

- **image-content-specialist / audio-content-specialist /
  video-content-specialist** craft prompts and drive Gemini through this skill.
- **content-director** owns the opt-in decision and the registry currency.
- **project-lead** shows the per-generation approval pop-up (the one place a
  pop-up is shown). **cost-monitor** logs spend and enforces the ceiling.
