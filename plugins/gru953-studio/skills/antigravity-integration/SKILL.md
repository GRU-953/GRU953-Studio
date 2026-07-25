---
name: antigravity-integration
description: The protocol for operating GRU953-Studio seamlessly within Google Antigravity (AGY CLI `agy`, Antigravity IDE, Antigravity 2.0 app, Python SDK `google-antigravity`, and Gemini 3.6 / 3.5 models) — supporting dual-harness coordination across both Claude Code and Google Antigravity environments.
---

# Google Antigravity Integration

GRU953-Studio natively supports **Google Antigravity (AGY)** alongside Claude Code. Whether running via the Antigravity CLI (`agy`), the standalone Antigravity IDE, the Antigravity 2.0 desktop application, or programmatically leased via the Python SDK (`google-antigravity`), GRU953-Studio adapts transparently.

## Harness & Environment Auto-Detection

1. **Environment Variables**:
   - `ANTIGRAVITY_PLUGIN_ROOT` or `CLAUDE_PLUGIN_ROOT`: Root path of the GRU953-Studio plugin directory.
   - `ANTIGRAVITY_PROJECT_ROOT`: Active workspace root directory.
   - `GEMINI_API_KEY`: API key for Google Gemini model invocation (Google AI Studio or Vertex AI).

2. **Tool Execution Matching**:
   - Runtime hooks (`scan.mjs`, `gate.mjs`, `self-heal-nudge.mjs`) match execution commands across all tool interfaces: `run_command`, `Bash`, `PowerShell`, `Monitor`, `exec`, and `terminal`.

3. **Application Data & State Storage**:
   - Project-level memory stays in `Dev-Memory/` within the working directory.
   - User-level preferences and lessons cross project boundaries in `~/.gemini/antigravity/` and `~/.claude/`.

## Gemini Model Routing on Antigravity

When running under Google Antigravity, the `model-router` maps tasks to Gemini models dynamically:

| Project Tier / Task | Recommended Gemini Model | Effort / Reasoning |
| :--- | :--- | :--- |
| **Complex Tier**, Architecture, Security Audit, Review | `gemini-3.6-pro` | High reasoning |
| **Standard Tier**, Coding, TDD, Test Generation | `gemini-3.6-flash` | Medium reasoning / High speed |
| **Tiny Tier**, Scaffolding, Fast Checks, Status | `gemini-flash-lite` | Ultra-fast / Low cost |

Media generation (images, audio, video) continues using the opt-in `gemini-integration` skill with user confirmation.

## Subagent Orchestration & SDK Compatibility

- **Subagent Invocation**: Under Google Antigravity, multi-agent roles (e.g. `builder`, `tester`, `reviewer`) are spawned via `invoke_subagent` / `define_subagent` / `send_message` or Python SDK leasing (`LocalAgentConfig`).
- **Parallel Swarm Isolation**: Git worktree isolation remains enforced per builder in the Build Swarm.
- **Fail-Closed Security**: All seven pre-flight Publish gates (`scan.mjs`, `licence-scan.mjs`, `verify-progress.mjs`, `quality-gate.mjs`, `traceability-check.mjs`, `content-check.mjs`, `roster-check.mjs`) run unconditionally before any push or publish action.
