---
name: model-router
description: Chooses the best Claude model and effort level for each individual task automatically — Haiku / Sonnet / Opus / Fable at low / medium / high / xhigh / max effort — so cheap tasks run cheap and only genuinely hard ones spend up. Fully automatic and silent by default, with a single hard cost-ceiling that pauses only when one task would be unusually expensive (the one reconciliation with cost-guard). Load and follow as a standing rule; project-lead consults it when delegating, cost-monitor logs the actual choice.
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

## The choices

**Model families** (cheapest → most capable):

| Model | Best for |
| :-- | :-- |
| **Haiku** | Cheapest. Mechanical/clerical work with little open reasoning — status updates, simple edits, list upkeep, brand/format checks. Has the smallest context window of the four, so not for very large inputs (see signal 6). |
| **Sonnet** | The balanced workhorse — real but bounded reasoning: most building, testing, drafting and review-support tasks. The default when nothing points clearly higher or lower. |
| **Opus** | Hard reasoning — architecture, independent correctness review, safety/fairness judgement, and any decision that is costly and hard to undo. |
| **Fable** | The frontier tier: the **most capable and most expensive** model of the four (above Opus, with always-on deeper thinking and slower responses). Reserved only for the very hardest problems where Opus is genuinely not enough — **never** for routine drafting, which is cheap work. |

> **Verify before relying on this cost ordering (2026-07-21).** Model names,
> tiers, context sizes and prices change. Fable is the top tier here because it is
> both the most capable and the most expensive — confirm the current
> cheapest→most-capable order and each model's context window against Anthropic's
> own current documentation before treating this table as authoritative, the same
> currency discipline `gemini-integration` and `ollama-integration` already apply.
> (This corrects a 2026-07-21 audit finding: Fable had been mis-listed as a cheap
> second tier, which routed the cheapest kind of work — drafting/ideation — to the
> single most expensive model, inverting the cheapest-first principle.)

**Effort levels** map the owner's requested names to what the platform exposes:
`low` → low, `medium` → medium, `high` → high, **`extra` → xhigh**, `max` → max.
Higher effort means more careful reasoning at more cost; use the least that
reliably does the task. **"Ultracode"** is not an effort level — it is the
opt-in, heavy multi-agent orchestration mode (many agents fanning out and
adversarially verifying), reserved for explicitly comprehensive/audit tasks the
user asks to go all-out on; it is never entered silently.

## How a task is scored (silent, automatic)

For each task, weigh six signals and pick the cheapest model + lowest effort
that clears them:

1. **Reasoning depth** — routine/mechanical → Haiku/low; genuinely novel or
   subtle → Opus/high+.
2. **Reversibility** — trivially undoable → cheap; costly or irreversible to get
   wrong (a migration, a security-relevant change, a release decision) → spend
   up.
3. **Risk/blast radius** — touches money, personal data, auth, or data loss →
   never the floor; give it more model and effort.
4. **Breadth** — a narrow local change → cheap; a wide cross-cutting one →
   higher.
5. **Creativity vs rigour** — divergent drafting/ideation is still ordinary work:
   route it to a **cheap** tier (Haiku for simple variants, Sonnet for nuanced
   copy), never to Fable. Convergent correctness → Sonnet/Opus. Fable (the most
   expensive tier) is reserved for signal 1's "genuinely novel or subtle" extreme
   where even Opus underperforms — never chosen merely because a task is
   "creative".
6. **Input size / context** — a task whose input approaches or exceeds Haiku's
   smaller context window must **not** be routed to Haiku however mechanical it is
   (it would truncate or fail); escalate to a larger-context tier (Sonnet or
   above). Verify current context sizes per the currency note above.

The per-role `model:` in each agent's frontmatter is the **default and the
floor**: the router may escalate a task above it when the signals justify it,
and may drop to a cheaper model for a clearly mechanical sub-task, but it does
not silently push a safety- or release-critical role below its declared floor.

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

So the one automatic router covers Claude (code + text) and Gemini (media),
cheapest-capable per task — with media carrying the extra per-generation
approval its cost and privacy warrant.

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
