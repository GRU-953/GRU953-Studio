---
description: Publish the current GRU953-Studio project privately to the user's GitHub, after one confirmation and four blocking pre-flight checks.
argument-hint: (no arguments needed)
---

Publish the current project's MVP to a private GitHub repository.

1. Confirm there is a project here: check for `Dev-Memory/` and a working
   codebase in the current directory. If neither exists, tell the user in
   plain English there is nothing to publish yet and suggest `/studio`.
2. Run the four blocking pre-flight checks via `security-compliance-auditor`
   BEFORE asking to publish: secrets scan, dependency vulnerability scan,
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/licence-scan.mjs" .`, and
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/verify-progress.mjs" .`. Also run
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/roster-check.mjs"` via
   `scope-guardian` — a non-zero exit means the agent roster grew without a
   recorded reason; resolve that first too.
   Also confirm the Dev-Memory resume rehearsal (see `dev-memory` skill) has
   actually been done at least once for this project. Report each result
   plainly. Stop here, without asking to publish, if any of these fails —
   explain what needs fixing first.
3. Only once all four checks (plus the roster check) pass, ask ONE
   confirmation with AskUserQuestion:
   "Publish this app privately to your GitHub now? This step is permanent
   and irreversible — you can always make it public later, but the private
   repository itself cannot be un-created." with options
   "Yes, publish privately (Recommended)" and "No, not now".
4. If the user says no, stop politely and note in `Dev-Memory/PROGRESS.md`
   that publishing remains pending.
5. If yes: record the confirmation so the publish-gate hook allows the
   push — `node "${CLAUDE_PLUGIN_ROOT}/hooks/confirm-publish.mjs"` from the
   project root. Then load `publish-github` and follow it exactly and in
   order: verify tools, set author identity from the signed-in user,
   attribution cleanup in a throwaway clone, create the private repository,
   add the full `governance/` folder, push, **tag and create a real
   GitHub Release (verify `isDraft: false`)**, report the address.
6. Record the outcome (address, tag, and date, or the reason publishing
   stopped) in `Dev-Memory/PROGRESS.md` and `Dev-Memory/SESSION-LOG.md`.
7. Going public is a separate later step with its own confirmation and its
   own `confirm-go-public.mjs` token — never bundled into this command's
   flow; see `publish-github`'s "Going public" section.
