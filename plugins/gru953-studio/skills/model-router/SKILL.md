---
name: model-router
description: Chooses the best model and provider for each individual task automatically — capability-based routing across Anthropic (Claude), Groq, OpenRouter, Ollama (local), and enterprise providers (Bedrock, Vertex, Azure). The studio picks the cheapest capable provider per task, with circuit breakers, fallback chains, and latency-aware routing. Fully automatic and silent by default, with a single hard cost-ceiling that pauses only when one task would be unusually expensive (the one reconciliation with cost-guard).
---

# Model Router

## Why this exists

Every role already declares a model, so cost is never an accident. But a single
role does tasks of very different difficulty — a one-line rename and a
subtle concurrency fix are both "builder" work. This skill lets the studio pick
the right **model and effort per task**, not just per role: cheap models for
mechanical work, the expensive ones only where the reasoning is genuinely hard
or a mistake is costly to undo. It is the cheapest-first principle
(`cost-guard`) made granular. Plain-English rule is exactly as set in the
`studio` skill.

## Capability registry (2026-07-25)

The router routes to a **capability** (code-generation, reasoning, vision, function-calling, structured-output), not a named provider. The registry maps each capability to the cheapest provider that supports it. The registry is a versioned YAML file at `skills/model-router/capability-registry.yaml`.

**Registry schema:**

```yaml
capabilities:
  code-generation:
    default:
      provider: anthropic/claude-sonnet-4
      effort: medium
    fallbacks:
      - provider: ollama/deepseek-coder-v2
        effort: medium
      - provider: openrouter/deepseek-v3
        effort: medium
  reasoning:
    default:
      provider: anthropic/claude-opus-4
      effort: high
  vision:
    default:
      provider: anthropic/claude-sonnet-4
      effort: medium
```

## Provider tiers (2026-07-25)

| Tier | Providers | Selection | User control |
| :-- | :-- | :-- | :-- |
| **Default (Auto)** | Anthropic Claude + Ollama (local) | Router picks cheapest capable | None (just works) |
| **Opt-In Cloud** | OpenRouter + Groq | User enables per project | Project-level toggle |
| **Enterprise** | Bedrock, Vertex, Azure AI | Admin configures org-wide | Org policy (OPA) |

**Key principle:** Users select a capability ("I need fast code generation"), not a provider ("use Groq"). The router maps capability → best provider, preventing decision paralysis and enabling automatic cost optimization.

## Circuit breakers and health checks

Each provider has a health record tracking consecutive failures, circuit state, and p99 latency. If a provider fails 3 times consecutively, the router opens the circuit and routes to the next fallback. The circuit closes after 60s of successful calls. Interactive tasks (SLA <500ms) prefer providers with p99 <1s; batch tasks include all providers.

## Tiered quality gates (2026-07-25)

Quality gates execute in parallel for independent checks, tier-scaled:

| Tier | Gates (parallel) | Incremental re-check |
| :-- | :-- | :-- |
| Tiny | Secrets, License, Progress (3) | Only changed files |
| Standard | + Quality, Traceability, Content (6) | Affected modules only |
| Complex | + Roster, Vuln Scan, AI Review (9) | Full re-run on major changes |

All gates within a tier run concurrently. Skipped checks use git diff + cache. Documented skip with risk acceptance is permitted, logged in the audit trail.

## How a task is scored (silent, automatic)

For each task, weigh six signals and pick the cheapest capable model + lowest effort that clears them:

1. **Reasoning depth** — routine/mechanical → cheap model/low effort; genuinely novel or subtle → expensive model/high effort.
2. **Reversibility** — trivially undoable → cheap; costly or irreversible to get wrong (a migration, a security-relevant change, a release decision) → spend up.
3. **Risk/blast radius** — touches money, personal data, auth, or data loss → never the floor; give it more model and effort.
4. **Breadth** — a narrow local change → cheap; a wide cross-cutting one → higher.
5. **Creativity vs rigour** — divergent drafting/ideation is still ordinary work: route it to a cheap tier, never Fable. Convergent correctness → Sonnet/Opus.
6. **Input size / context** — a task whose input approaches the cheapest model's context window must not be routed to it; escalate to a larger-context tier.

The per-role `model:` default in each agent's frontmatter is the **floor**: the router may escalate a task above it when the signals justify it, and may drop to a cheaper model for a clearly mechanical sub-task, but it does not silently push a safety- or release-critical role below its declared floor.

> **Verify before relying on this cost ordering (2026-07-26).** Model names,
> tiers, context sizes and prices change. Fable and Frontier Tiers sit at the top
> because they are both the most capable and most expensive — confirm the current
> cheapest→most-capable order and each model's context window against Anthropic's
> and Google's own current documentation before treating this table as authoritative,
> the same currency discipline `gemini-integration`, `google-antigravity-integration`,
> and `ollama-integration` already apply.

**Effort levels** map the owner's requested names to what the platform exposes:
`low` → low, `medium` → medium, `high` → high, **`extra` → xhigh**, `max` → max.
Higher effort means more careful reasoning at more cost; use the least that
reliably does the task. **"Ultracode"** is not an effort level — it is the
opt-in, heavy multi-agent orchestration mode (many agents fanning out and
adversarially verifying), reserved for explicitly comprehensive/audit tasks the
user asks to go all-out on; it is never entered silently.

## Fully automatic and silent — with one exception

Per the owner's choice, the router picks per task and **does not prompt** — no
menu, no confirmation, for the ordinary case. The **single exception** is
`cost-guard`'s hard ceiling: a per-task spend threshold (seeded by `first-run`/
`cost-guard`, adjustable by the user). Only when one task would cross that
ceiling — an unusually large or high-effort job — does the studio pause and put
a plain-English choice to the user (proceed at this cost, or take the cheaper
path). Everything below the ceiling runs automatically. This is the one, narrow
reconciliation with cost-guard's "confirm before expensive" default; it is not a
per-task interruption.

Two hard rules the router never overrides:
- It never raises effort or model to route *around* a safety gate — a Publish
  confirmation, a security finding, an accessibility requirement stand
  regardless of which model did the work.
- Where the current Claude Code surface does not expose choosing a subagent's
  model/effort, the per-role default simply stands — the router degrades to
  today's fixed tiers, never failing.

## Content and media models (2026-07-19)

The router also chooses models for the Content stage (the `content-creation`
skill), so content generators plan, select and switch models and effort the same
way the code side does:

- **Text content** (Bangla/English copy) uses Claude tiers/effort by the same
  six signals above — routine copy runs cheap, nuanced or safety-relevant
  wording spends up — and runs **inline**, like any other Claude task.
- **Image/audio/video** uses the **Gemini capability registry** (the
  `gemini-integration` skill): the router picks the model for the capability
  (image/video/audio) and the quality level, trading cost against fidelity, and
  may switch models between drafts. But media generation is **not silent**: each
  generation still passes through the confirm-before-generate step (cost + "sent
  to Google"), because it spends real money and leaves the user's machine. Media
  cost counts against the same `cost-guard` ceiling; `cost-monitor` logs each
  media generation's model and spend.

So the one automatic router covers Claude & Gemini models (code, text, and media),
cheapest-capable per task — with media carrying the extra per-generation
approval its cost and privacy warrant.

## Google Antigravity model routing (2026-07-26)

When operating under Google Antigravity (`google-antigravity-integration` skill), the model router maps tasks across the Gemini model suite:
- **Complex Tier / Architecture / Review / Security**: `gemini-3.6-pro` (or `gemini-1.5-pro` fallback) with high effort for deep reasoning.
- **Standard Tier / Build / TDD / Test Generation**: `gemini-3.6-flash` (or `gemini-2.0-flash` fallback) with medium effort for balanced speed and reasoning.
- **Tiny Tier / Scaffolding / Quick Checks**: `gemini-flash-lite` for ultra-fast, low-cost execution.

## Logging (so an automatic choice stays reviewable)

Because selection is silent, it must be auditable. `cost-monitor` records, per
task, the model and effort actually used and why (the deciding signal), in a
short ledger under `Dev-Memory/` — so the user or a reviewer can see, after the
fact, that the automatic router spent sensibly. Silent is not hidden.

## Who applies this

- **project-lead** consults this table when delegating each task, choosing the
  model/effort it dispatches a specialist with (within that role's floor).
- **cost-monitor** logs the actual model/effort per task and enforces the hard
  ceiling pause.
