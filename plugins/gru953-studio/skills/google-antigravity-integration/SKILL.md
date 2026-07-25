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
   - No feature parity is sacrificed — the 38 specialist roles, pop-up interview flow, YAGNI rules, cost controls, self-healing, and pre-publish security checks function identically on both platforms.

2. **Workspace & Customization Structure**:
   - In Google Antigravity environments, workspace skills and customization elements reside under `.agents/skills/<skill-name>/SKILL.md` (or global customization roots at `~/.gemini/config/skills/`).
   - Project memory is stored in `Dev-Memory/` (with automatic discovery in `.agents/` if configured), maintaining full state persistence across laptop restarts and IDE sessions.

3. **Gemini & Antigravity Model Routing**:
   - When running on Google Antigravity, model selection maps seamlessly through `model-router`:
     - **Low / Fast Tasks**: Gemini 3.6 Flash / Gemini 2.5 Flash
     - **Medium / Standard Tasks**: Gemini 2.5 Pro / Gemini Flash High
     - **Complex / Deep Tasks**: Gemini 2.5 Pro / Gemini Ultra / Claude 3.7 Sonnet
   - Cost estimates and budget rules apply strictly per `cost-guard`.

4. **Google Antigravity SDK (AGY) Interoperability**:
   - The studio AI developer (`ai-developer`) can build applications using the `google-antigravity` Python SDK (`LocalAgentConfig`, `Conversation`, `MCP` integrations, and `SafetyPolicy`).
   - Agents created inside built apps follow Google Antigravity SDK best practices, including explicit credential management via `GEMINI_API_KEY` (never hardcoding or committing keys).

5. **Tool Permissions & Execution Safety**:
   - Pre-tool hooks (`scan.mjs` and `gate.mjs`) guard all shell executions across both environments.
   - Secret scanning covers Google API keys (`AIza...`), OAuth tokens, private keys, and credential files before any GitHub push or deployment.

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
 │ • Model: Gemini 3.6/2.5   │    │ • Model: Sonnet/Haiku/Opus│
 │ • Root: .agents/          │    │ • Root: Dev-Memory/       │
 │ • SDK: google-antigravity │    │ • Tooling: Claude Code    │
 └───────────────────────────┘    └───────────────────────────┘
```

The coordinator auto-detects Google Antigravity through environment indicators (e.g. `GEMINI_API_KEY`, `ANTIGRAVITY_IDE`, `.agents` folder, or `google-antigravity` presence) and configures agent execution accordingly.
