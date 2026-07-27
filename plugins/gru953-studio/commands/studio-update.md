---
description: Manually check whether a newer version of GRU953-Studio is available, and update to it.
---

Check for and apply a GRU953-Studio update, following the `auto-update.mjs`
hook (2026-07-26 correction: this file previously called the product
"Universal Agentic Studio" throughout, never once said "GRU953-Studio," used
unexplained jargon ("upstream repository," "ecosystem improvements"), and was
written as a raw instruction block instead of the plain numbered steps every
other command file uses — brought in line with the rest). Speak plain, simple
UK English.

1. Tell the user in one line what is about to happen: checking whether a
   newer version of GRU953-Studio (the skills, safety rules, and specialist
   roles this plugin ships) is available, and updating to it if so.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/hooks/auto-update.mjs" --force` and report
   its result plainly.
3. If an update was applied, tell the user they may need to restart their
   current session to see the change take effect. If none was needed, say so
   plainly — this is not a failure.
4. This command never runs on its own; the studio never fetches, pulls, or
   changes anything without the user asking for it here first.
