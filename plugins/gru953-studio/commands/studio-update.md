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
4. **Tell the user what an update actually does, before applying one.** In
   plain words, and without softening it:
   - It downloads the newest version of this plugin from the internet
     (`git pull` from the project's GitHub repository) and **that new code then
     runs** — the plugin's safety checks are programs, so the next command the
     user types is checked by the version that just arrived, not the one they
     had before.
   - **Nothing is verified before it runs.** There is no signature check, no
     signed tag, no expected fingerprint. Whatever that repository serves is
     what runs. Checked on 2026-08-22: no such check exists anywhere in the
     updater or the command-line tool.
   - **Unsaved work is set aside and put back automatically** (`--autostash`).
     If the new version changed the same lines the user did, putting it back can
     fail; the file is then left with conflict markers in it and the user's own
     version is kept in a `git stash`. Say this before updating, not after.
   - If the user would rather read the changes first, they can decline and
     update by hand instead.

5. **Corrected 2026-08-22 (X231): this file used to end with a promise it could
   not keep** — "This command never runs on its own; the studio never fetches,
   pulls, or changes anything without the user asking for it here first." That is
   true only while the optional scheduler is off. `gru953-studio autoupdate on`
   registers a daily job with the operating system that pulls **unattended**,
   with no one present, and the user need never come here. The scheduler is off
   by default and turning it on is an explicit choice, so the honest sentence is:
   *this command never runs on its own, and nothing else pulls either unless the
   user has switched the daily scheduler on.*
