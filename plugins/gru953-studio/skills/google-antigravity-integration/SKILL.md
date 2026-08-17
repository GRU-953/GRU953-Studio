---
name: google-antigravity-integration
description: The protocol for operating GRU953-Studio inside Google Antigravity (Google Antigravity SDK and Gemini Antigravity IDE) — allowing the studio's team of 38 specialised AI roles to run natively across Google Antigravity environments alongside Claude Code, using Gemini models, .agents/ workspace customization roots, and AGY SDK agent orchestration.
---

# Google Antigravity integration

## Overview

GRU953-Studio natively supports **Google Antigravity** (Google Antigravity SDK and Gemini Antigravity IDE) as a tier-1 runtime environment alongside Claude Code.

This skill governs how the studio coordinator (`project-lead`), memory keeper (`memory-keeper`), AI developer (`ai-developer`), and specialist subagents execute when hosted inside or interfacing with Google Antigravity.

---

## Key Integration Principles

1. **Dual-Environment Architecture**:
   - The studio runs transparently on **Google Antigravity** (using Gemini models, `.agents/` workspace structure, and Google Antigravity SDK protocols) as well as **Claude Code**.
   - The specialist roles, pop-up interview flow, YAGNI rules, cost controls, and self-healing are the same natural-language instructions on both platforms — they are read from the same skill/agent files, not reimplemented per platform.
   - **Correction (2026-07-26):** this section previously stated the pre-publish security checks (`scan.mjs`; the publish gate was removed 2026-08-16, X214) "function identically on both platforms" as settled fact. That overclaimed what's actually verified: `clients/antigravity/src/index.js` (the bridge that sets up a project for Google Antigravity) only links the `studio` skill into `.agents/skills/studio` — it does not install `hooks.json`, and nothing in this repository wires Google Antigravity's own tool-calling loop to invoke `scan.mjs`/`gate.mjs` before a shell command runs, the way Claude Code's `PreToolUse` mechanism does. `gate.mjs` (removed 2026-08-16, finding X214) does check an `ANTIGRAVITY_PLUGIN_ROOT` environment variable alongside `CLAUDE_PLUGIN_ROOT`, so the hook itself is written to tolerate running under Antigravity if invoked — but whether Google Antigravity's own runtime actually invokes it before every shell command is outside this repository's control and has not been demonstrated here. Until that's verified end-to-end, treat the safety-hook parity claim as **intended, not proven** — the coordinator should not assume secret-scanning or the publish gate protect an Antigravity-hosted session the same way they protect a Claude Code one.

**2026-08-01 checked against a real installation.** With a genuine `agy` CLI (v1.1.7) and the `google-antigravity` Python SDK (v0.1.7) actually installed, this is now more than a documentation gap: the repository contains exactly one `hooks.json` (`plugins/gru953-studio/hooks/hooks.json`), and it is Claude Code's own plugin manifest — nothing references it from `clients/antigravity/`, and the real local `~/.gemini/settings.json` / `~/.gemini/antigravity/settings.json` on this machine carry only an `mcpServers` key, no hooks key of any kind. The SDK does ship its own "Hooks v2" lifecycle mechanism (`google.antigravity.hooks`, routed through a local-harness `hook_router.py`), but it is scoped to agents built with the SDK's own `LocalAgentConfig`/`Agent` classes — a different surface from the `agy` CLI's own interactive coding session that would act as project-lead. No path was found, in the repo or in a real installation, that would carry `scan.mjs` (or `gate.mjs`, removed 2026-08-16 by X214) into that CLI session's own tool-calling loop. This still isn't a full live end-to-end test (that would mean actually running a real `agy` session and confirming a shell command isn't intercepted, which spends real API cost) — but it moves the claim from "unproven" to "actively checked and still not found," which is materially stronger.

2. **Workspace & Customization Structure**:
   - In Google Antigravity environments, workspace skills and customization elements reside under `.agents/skills/<skill-name>/SKILL.md` (or global customization roots at `~/.gemini/config/skills/`).
   - Project memory is stored in `Dev-Memory/` (with automatic discovery in `.agents/` if configured), maintaining full state persistence across laptop restarts and IDE sessions.

3. **Gemini & Antigravity Model Routing**:
   - When running on Google Antigravity, model selection maps seamlessly through `model-router`:
     - **Low / Fast Tasks**: the Gemini Flash tier
     - **Medium / Standard Tasks**: the Gemini Pro tier
     - **Complex / Deep Tasks**: the Gemini Pro tier, or Claude's Opus tier
       where a Claude model is available to the session
   - Cost estimates and budget rules apply strictly per `cost-guard`.

   > **Verify current model names before relying on this mapping (2026-08-07
   > audit).** This table previously named specific versions, and one had gone
   > stale in a way that mattered: it recommended **Claude 3.7 Sonnet** for
   > "Complex / Deep Tasks", a model **retired on 2026-02-19** — so the single
   > hardest tier pointed at a model ID that no longer resolves. Checked against
   > Anthropic's own current model documentation, not from memory. The Claude
   > tiers are now named by family rather than version, matching the deliberate
   > version-free convention `model-router` already uses and which is the reason
   > that skill did not rot the same way.
   >
   > The Gemini names removed here (`Gemini 3.6 Flash`, `Gemini Flash High`,
   > `Gemini Ultra`) are **not** asserted to have been wrong — they could not be
   > verified against Google's current documentation during this audit, and
   > replacing an unverifiable name with a guess would be the same defect again.
   > They are generalised to tier names instead. Confirm the exact current model
   > IDs against Google's own documentation before treating any of this as
   > authoritative — the same currency discipline `model-router` states, and
   > which this section did not previously carry despite `model-router` citing it
   > as one of the skills that already did.

4. **Google Antigravity SDK (AGY) Interoperability**:
   - The studio AI developer (`ai-developer`) can build applications using the `google-antigravity` Python SDK (`LocalAgentConfig`, `Conversation`, `MCP` integrations, and `SafetyPolicy`).
   - Agents created inside built apps follow Google Antigravity SDK best practices, including explicit credential management via `GEMINI_API_KEY` (never hardcoding or committing keys).

5. **Tool Permissions & Execution Safety**:
   - The pre-tool hook `scan.mjs` guards all shell executions under
     (`gate.mjs` sat beside it until it was removed on 2026-08-16, finding X214)
     Claude Code (2026-07-26 correction: this line asserted they guard "both
     environments" — the exact overclaim Section 1's own correction above just
     walked back to "intended, not proven." This line survived that edit
     unchanged, in the same file. Restated once, here, for the mechanism: under
     Google Antigravity, nothing in this repository currently wires these hooks
     to fire before a shell command runs — see Section 1).
   - Secret scanning covers Google API keys (`AIza...`), OAuth tokens, private keys, and credential files before any GitHub push or deployment, wherever `scan.mjs` does run.

---

## Runtime Detection & Behavior

```
┌─────────────────────────────────────────────────────────┐
│              GRU953-Studio Coordinator                  │
└────────────────────────────┬────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   Google Antigravity IDE / SDK           Claude Code
 ┌───────────────────────────┐    ┌───────────────────────────┐
 │ • Model: Gemini tiers     │    │ • Model: Sonnet/Haiku/Opus│
 │ • Root: .agents/          │    │ • Root: Dev-Memory/       │
 │ • SDK: google-antigravity │    │ • Tooling: Claude Code    │
 └───────────────────────────┘    └───────────────────────────┘
```

The coordinator auto-detects Google Antigravity through environment indicators (e.g. `GEMINI_API_KEY`, `ANTIGRAVITY_IDE`, `.agents` folder, or `google-antigravity` presence) and configures agent execution accordingly.
