---
name: ollama-integration
description: The protocol for using Ollama (a free tool for running AI models locally, no cloud needed) two ways — as an alternative AI backend `ai-developer` can offer for an app GRU953-Studio builds, and as a standing capability any role can reach for as a free, private, independent local second opinion. Always confirms with the user before installing Ollama itself or pulling any model — every time, no exceptions. Use whenever `ai-developer` designs an AI feature, and whenever a role wants a local-model pass instead of (or alongside) its own review.
---

# Ollama integration

## Why this exists

User-requested 2026-07-17: an interface to Ollama for both (a) apps
GRU953-Studio builds, and (b) the assistant's own use. Every technical
fact below was verified 2026-07-17 against Ollama's own documentation and
GitHub repo (not guessed) — a stale install command or a wrong API claim
would be a shipped bug, the same discipline `researcher` already applies
to anything time-sensitive. Re-verify before reusing any of this if much
time has passed.

## Two distinct uses, one shared mechanism

**(a) A backend option for a built app.** `ai-developer` may offer Ollama
as an alternative to the Claude API for an AI feature it's building —
private (nothing leaves the end user's machine) and free to run, but
slower and less capable than Claude, and it only works while the end
user's own machine has Ollama running. Always a **choice** presented via
pop-up; the Claude API stays the default, exactly like every other
AI-feature decision `ai-developer` already makes — this never becomes a
silent substitute.

**(b) A standing capability for the assistant's own work.** Any role doing
a review/audit/build task may reach for a locally-run Ollama model as an
independent second opinion — free, private, genuinely different training
and weights from Claude, so it can catch things a same-model review might
miss (already used once this way — see the `local-ollama-second-opinion-
review` technique).

## Method

1. **Check whether Ollama is already there and running:** `command -v
   ollama`, and/or a request to `http://localhost:11434/api/tags` (a
   connection error means it's installed but not running, or not
   installed at all — check both before assuming which).
2. **If not installed, only after an explicit "yes, install it"** (see
   Confirmation below) — install using Ollama's own current official
   method for the user's OS (verified 2026-07-17 against
   github.com/ollama/ollama and docs.ollama.com):
   - **macOS:** `curl -fsSL https://ollama.com/install.sh | sh`, or point
     the user to the `.dmg` at ollama.com/download if they'd rather not
     run a script.
   - **Windows:** `irm https://ollama.com/install.ps1 | iex`, or the
     `.exe` at ollama.com/download.
   - **Linux:** `curl -fsSL https://ollama.com/install.sh | sh`.
3. **Picking a model for the task**, once Ollama is confirmed running:
   prefer one already pulled (`ollama list` / `GET /api/tags`) if it
   genuinely fits; otherwise recommend ONE model matched to the task —
   a general-purpose model (e.g. a mid-size `gemma`/`llama`/`qwen` model)
   for general text/analysis work, a coding-focused model (e.g. a
   `-coder` variant such as `qwen3-coder`) for code-specific tasks —
   checked live against ollama.com/library rather than a remembered name,
   since the library changes over time. Confirm before pulling.
4. **Pull non-interactively:** `POST /api/pull` with JSON body
   `{"model": "<name>"}` — streams NDJSON progress objects and ends with
   `{"status": "success"}`, fully scriptable without a terminal to babysit
   it. The DECISION to pull still needs the confirmation from step 5,
   before this runs, not after.
5. **Before installing Ollama or pulling ANY model, tell the user plainly
   and get an explicit yes — every single time, no exceptions:** what's
   about to happen and its real cost. Ollama's own docs state at least
   ~4GB of disk space for the install itself, and models can range from
   roughly 1GB to well over 100GB. Ollama's documentation does not publish
   a precise per-model RAM table (a confirmed, open gap in their own
   docs) — say so honestly rather than inventing a number.
6. **Calling Ollama once ready:** use its OpenAI-compatible endpoint at
   `http://localhost:11434/v1/chat/completions` where it covers what's
   needed (works with existing OpenAI-client code patterns) — verified
   supported: chat completions, streaming, JSON mode, reproducible
   outputs, vision, tools, reasoning/thinking control. Verified NOT
   supported: `logprobs`, `tool_choice`, `logit_bias`, `user`, `n`
   parameters, and image input must be base64 (no image URLs). For
   anything needing a gap the compatibility layer doesn't cover, use
   Ollama's own native `/api/generate`/`/api/chat` instead (as already
   used for the second-opinion technique).
7. **For a large-context pass** (an independent review, not a quick
   single-turn answer): run it in the background — a large prompt can
   take many minutes to process even on capable hardware, and a short
   foreground timeout will simply fail before the model finishes.
8. **Never treat a local model's output as settled fact on its own
   word** — verify anything it reports before acting on it or presenting
   it to the user, the same rule already applied to every subagent's
   report in this project.
9. **For the built-app feature specifically:** the app must disclose to
   its own end users that a response came from a local AI model (the same
   transparency principle `responsible-ai-reviewer` already applies
   elsewhere), and must fail with a plain-English message — never a raw
   connection error — if Ollama isn't running when the app needs it.

## Confirmation, every time, no exceptions

Installing software or pulling a model file are real changes to the
user's own machine, on par with every other install-capable action in
GRU953-Studio (see `ecosystem-finder`): `project-lead` presents what's
about to happen and its size/cost via a pop-up, and only a clear "yes"
lets it proceed. A recommendation alone is never a substitute for this,
and neither is "the user already said yes to a similar thing before" —
each install/pull gets its own fresh confirmation.

## Who applies this

Only roles that actually have both `Bash` (to run the commands) and
`Skill` (to load this protocol) can use this directly — naming a role
without both would be the exact "told to use a tool it wasn't granted"
mistake this project's own audit history has caught before:

- **ai-developer** offers Ollama as an alternative backend for a built
  app's AI feature, when relevant, always as a choice not a default.
- **reviewer**, **security-compliance-auditor**, **architect**,
  **builder**, **devops-engineer**, and **publisher** may each use a local
  Ollama model as a second opinion on their own review/build work,
  following the same confirm-before-install rule as everyone else.
- **project-lead** presents the install/pull confirmation pop-up
  (`Skill` but no `Bash` — it confirms, it never executes).
- **researcher** may recommend Ollama as relevant during Design/Plan
  (`Skill` but no `Bash` — same reason it can recommend but not install an
  ecosystem-finder result), handing any actual install/pull to one of the
  roles above.

## What this does not do

- Does not install Ollama or pull any model without an explicit, fresh
  "yes" for that specific install or pull.
- Does not make Ollama the default AI backend for built apps — the Claude
  API stays the default; Ollama is an offered alternative.
- Does not treat a local model's output as more authoritative than any
  other reviewer's — always verified before it's acted on.
