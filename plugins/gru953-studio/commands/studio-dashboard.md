---
description: Open a visual dashboard of your GRU953-Studio project's tasks and progress.
argument-hint: (no arguments needed)
---

Generate the project's command-centre dashboard, following the
`command-centre` skill. Speak plain, simple UK English.

1. Look for `Dev-Memory/` in the current working directory. If there is none,
   tell the user kindly that no studio project is running here yet.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/hooks/dashboard.mjs" .` — it reads the
   project's Dev-Memory and writes a self-contained `Dev-Memory/dashboard.html`
   (all styling inline, no internet needed, nothing changed) showing, in one
   organised page: the **concept** (`OBJECTIVE.md`), the **architecture &
   specifications** (`ARCHITECTURE.md`), the complete **build plan**
   (`PLAN.md`), and the live task board. Never write the HTML by hand; the
   generator is what guarantees the page is safe and self-contained.
3. Tell the user in one or two sentences that the dashboard is ready and where
   it is (`Dev-Memory/dashboard.html`), and that they can open it in any web
   browser to see the whole project — what it is, how it's built, the full plan,
   and every task's status — at a glance. It is private and never published.
