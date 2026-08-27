---
name: cost-guard
description: Session usage-limit planning plus the confirmed cheapest-first spending default for GRU953-Studio. Use before starting any stage, whenever a session feels long or heavy, whenever the user mentions "limits", "usage", "cost", "budget", or "ran out", and whenever deciding whether to start one more task or stop cleanly.
---

# Cost guard

## Confirmed spending default (2026-07-10): cheapest-first

Always lean towards the cheaper option. **Unattended, that means CHOOSE the
cheaper option and record why — never pause to ask (2026-08-27).** This used to
say "pause to check with the user before any noticeably expensive step, even if
that means more interruptions", and the steps it names — a Build Swarm, a large
research pass, a full regression run — are ordinary build events, so an
unattended run stopped on the first one. Cheapest-first is a decision rule, and a
decision rule does not need a person; a per-run ceiling is declared as
`tokenBudget` in `Dev-Memory/run.json` and measured by
`hooks/session-cost.mjs`. Concretely:

- Prefer a single sequential builder over a parallel Build Swarm unless the
  Tier and task genuinely benefit from parallel work.
- Prefer the architect's default vetted-menu stack over an off-menu choice
  unless there's a clear stated reason.
- Before a stage that could be notably expensive (a large research pass, a
  full Build Swarm, a long full-suite test run), write a plain-English estimate
  and the cheaper alternative into `Dev-Memory/decisions/`, take the cheaper one
  when the gap is meaningful, and carry on. Only with a person present who has
  asked to be consulted is this a pop-up.
- Dev-Memory is local-only (2026-07-10 audit correction, confirmed with the
  user): there is no GitHub mirror, so nothing needs batching to one.

## How usage can be judged locally

**Default, always available:** Claude Code writes session transcripts and token
metrics locally, under its `.claude` application directory. `hooks/session-cost.mjs`
reads them and reports what a run has spent — in tokens, keyed by message id,
excluding cache reads. It never guesses: given no transcript it says so and blocks,
because "I could not find the transcript" must never render as "this run has cost
nothing". (This paragraph also described Google Antigravity's AGY SDK until
2026-08-27; that host was removed in 7.0.0.)
A long, heavy transcript file or high token total for the current session is a
reasonable local signal that a lot of the window has been used.

**Optional, opt-in upgrade to real numbers (2026-07-17 gap-research
fix):** Claude Code's `statusLine` feature can expose real figures —
`cost.total_cost_usd` (an estimated session cost in USD, available
regardless of billing plan) and `rate_limits.five_hour.used_percentage` /
`rate_limits.seven_day.used_percentage` (percentage of the 5-hour/7-day
usage window consumed — **verified: this field "appears only for
Claude.ai subscribers (Pro/Max)"**, not API-key/pay-as-you-go billing, so
it won't be available to every user). A plugin cannot ship this itself —
Claude Code's plugin `settings.json` only supports the `agent` and
`subagentStatusLine` keys, not a main `statusLine` default — so this can
only work via the user's own personal, global `~/.claude/settings.json`.
`first-run` offers this once, explicitly: if the user has no existing
`statusLine` configured, offer to add a small script that both displays
these numbers AND writes them to `~/.gru953-studio/cost-snapshot.json` for
`cost-monitor` to read. **If the user already has their own `statusLine`,
never overwrite it** — instead show them the one line to add themselves,
and leave their file untouched either way. `cost-monitor` checks for a
recent snapshot file first and uses it when present; falls back to the
transcript-size proxy above otherwise — nobody who doesn't opt in sees
any change in behaviour.

## Planning rules

1. Before each stage: will it comfortably fit in the remainder of this
   session? If in doubt, split it at a task boundary and do the first part
   only.
2. Keep tasks small — many small tasks beat one large one.
3. Checkpoint at every stage boundary: update `Dev-Memory/tasks.json` and re-run
   `hooks/task-ledger.mjs` to render PROGRESS.md (with the
   "▶ RESUME HERE" pointer), append SESSION-LOG.md, grow INDEX.md — before
   starting the next stage, never after.
4. Once roughly 80-85% of the session's time window has elapsed since its
   first message, do not start a fresh task — finish or park what's in
   hand. Treat a very heavy transcript the same way.
5. Stop cleanly, never mid-task: finish or safely park the current step,
   write all memory files, then tell the user plainly: "GRU953-Studio has
   saved everything. To continue, open a new session and type /studio-start — it
   will pick up exactly where it stopped." Then stop.

## Honesty

A plugin cannot itself wait out a usage limit and restart on its own —
Claude Code is not running while the limit is in force. What GRU953-Studio
CAN guarantee is zero lost work: Dev-Memory always holds everything needed
to resume at the exact `▶ RESUME HERE` pointer.
