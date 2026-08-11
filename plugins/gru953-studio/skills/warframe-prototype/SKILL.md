---
name: warframe-prototype
description: The Prototype stage — before any real code, build a self-contained clickable HTML "warframe" (wireframe prototype) of the app plus the phased build plan, then get explicit user approval of both at a hard, blocking gate. Only after approval does Plan/Build begin. Use right after Design, on every project with a user interface; for a pure CLI/library, a lightweight text/ASCII walkthrough stands in for the visual warframe.
---

# Warframe Prototype

## Why this exists

It is far cheaper to change a picture than a built app. The Prototype stage puts
a clickable mock of the app — and the plan to build it — in front of the user
*before* a line of real code is written, so the shape, flow and scope are agreed
when they are still cheap to change. User-directed (2026-07-19): "before
developing any app, build a self-contained HTML warframe first, confirm the
build plan, and only then proceed." Plain-English rule is as set in the
`operating-charter` skill.

## Where it sits in the lifecycle

A real stage between **Design** and **Plan**:

```
… → Design → [PROTOTYPE] → Plan → Build → …
```

`architect` finishes the design (`ARCHITECTURE.md`); then this stage produces the
warframe and the phased plan; then a **hard approval gate**; only on approval
does `micro-task-planning` (Plan) and Build begin.

## The warframe (self-contained HTML)

- `ux-designer` leads and a `builder` implements it — **no new role**.
- A **self-contained** HTML file (`Dev-Memory/warframe/index.html` or a small
  set): all CSS/JS inline, **no external network calls, no fetched fonts/scripts/
  images** — it opens offline in any browser. Same self-contained guarantee the
  command-centre dashboard holds; the studio never ships a prototype that phones
  home.
- **Clickable, not real**: the key screens and the main flow between them, with
  placeholder data. It shows layout, flow and states — it does not implement
  logic, storage, auth or real data.
- Accessible and plain: semantic HTML, sufficient colour contrast, real button/
  link elements so keyboard navigation works.
- For a **pure CLI or library** (no visual UI), the "warframe" is a short
  text/ASCII walkthrough of the commands/flows and example output instead — the
  same "agree the shape before building" purpose, matched to the medium.

## The phased build plan (agreed at the same gate)

Alongside the warframe, present the **phased build plan** (the `phased-roadmap`
skill): Phase 1 = the MVP core only, then Phase 2…N = progressive enhancements.
The user approves *what the first version does* and *what is deliberately left
for later*, not just how it looks. This is the roadmap's **shape only** — how
many phases, and what each one delivers in one line — never a per-phase
micro-task breakdown this early (2026-07-26: each phase's own detailed task
list is planned and approved separately, in its own single gate, right before
that phase is built — see `phased-roadmap`'s step 0. Approving the shape here
does not pre-approve any phase's task-level detail, including Phase 1's.)

## The hard approval gate (blocking)

Before Plan/Build, the Project Lead shows an `AskUserQuestion` pop-up asking the
user to approve **both** the warframe and the phased plan together. This gate is
**blocking**: no real implementation code is written until the user approves.

- Approve → record the approval in `Dev-Memory/decisions/` (dated), then proceed
  to Plan/Build of Phase 1.
- Change requested → revise the warframe/plan and re-present; never start
  building against an unapproved design (this is the `focus-guard` change-control
  rule applied at the design boundary).
- The approved warframe becomes the reference the built MVP is later checked
  against (a build-vs-warframe parity check at Review), so the app that ships
  matches what the user agreed to.

**Caveat — a technical-constraint change can silently be a design change too
(2026-07-31 maintenance finding, added after a live test session found this
exact gap):** a change to the *implementation approach* — programming
language, framework, platform — is not by itself a design change, and does
not automatically need re-approval. But check every such change for whether
it ALSO changes what the user will actually see or interact with, because it
can, even when the reason for the change was purely technical rather than a
deliberate design choice. The case that prompted this rule: a project
switched from Swift to Python mid-build because of a genuine
environment/tooling constraint that forced the switch; the decision record
for it discussed only programming-language logic, and the switch quietly
took the interface with it too — the graphical mock-up the owner had
approved at this gate shipped as a command-line tool instead — and that
interface change was never checked for, and never re-presented through this
gate at all. If an implementation-approach change turns out to also change
the approved warframe's user-facing shape (which screens/commands exist, how
the user interacts with them, GUI vs CLI, etc.), that part IS a design
change like any other, and it must go back through this same hard approval
gate — the "Change requested → revise the warframe/plan and re-present" step
above — before Build continues. It is never absorbed silently just because
the underlying reason was a technical constraint rather than a design choice.

## Who applies this

- **ux-designer** leads the warframe; a **builder** implements the HTML.
- **project-lead** presents the warframe + phased plan and runs the blocking
  approval gate (the one place a pop-up is shown).
- **memory-keeper** records the approval decision and links the warframe in the
  recall index/graph.
