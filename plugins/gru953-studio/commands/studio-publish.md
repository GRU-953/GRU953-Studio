---
description: Publish the current GRU953-Studio project privately to the user's GitHub, after one confirmation and its blocking pre-flight checks (seven blocking checks plus a roster check).
argument-hint: (no arguments needed)
# 2026-08-22, X270: this was missing while `skills/publish-github/SKILL.md` — the file this command
# reads — has carried `disable-model-invocation: true` since it was written, for the reason stated in
# its own description: "publishing is a side-effectful, GitHub-pushing action only the user's own
# explicit trigger should start". The flag on the skill stops Claude invoking the SKILL; it does not
# stop Claude invoking this COMMAND, which then reads the skill. So the protected door had an
# unprotected one beside it. Same class as X14, and consistent with the operating charter's rule that
# publishing needs the user's own fresh yes every time.
disable-model-invocation: true
---

Publish the current project's working app to a private GitHub repository.

1. Confirm there is a project here: check for `Dev-Memory/` and a working
   codebase in the current directory. If neither exists, tell the user in
   plain English there is nothing to publish yet and suggest `/studio-start`.
2. First, confirm the Dev-Memory resume rehearsal (see `dev-memory` skill)
   has actually been done at least once for this project — a project that
   cannot prove it resumes correctly is not ready to publish regardless of
   how clean its code is (2026-07-12 fix: this step used to be listed AFTER
   the checks below, contradicting `publish-github/SKILL.md`'s own Round 9
   fix, which reordered it to run first for the same reason).
   Then run the security-compliance-auditor's seven blocking pre-flight
   checks BEFORE asking to publish: secrets scan, dependency vulnerability
   scan, `node "${CLAUDE_PLUGIN_ROOT}/hooks/licence-scan.mjs" .`,
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/verify-progress.mjs" .`,
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/quality-gate.mjs" .`,
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/traceability-check.mjs" .`, and
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/content-check.mjs" .`. Also run
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/roster-check.mjs"` via
   `scope-guardian` — a non-zero exit means the agent roster grew without a
   recorded reason; resolve that first too.
   Report each result plainly. Stop here, without asking to publish, if any
   of these fails — explain what needs fixing first.
3. Only once all seven checks (plus the roster check) pass, ask ONE
   confirmation with AskUserQuestion:
   "Publish this app privately to your GitHub now? This step is permanent
   and irreversible — you can always make it public later, but the private
   copy of your project on GitHub (called a 'repository') itself cannot be
   un-created." with options "Yes, publish privately (Recommended)" and
   "No, not now".
4. If the user says no, stop politely and note in `Dev-Memory/PROGRESS.md`
   that publishing remains pending.
5. If yes: note the agreement in the project's record, then load `publish-github` and follow it exactly and in
   order: verify tools, set author identity from the signed-in user,
   attribution cleanup in a throwaway clone, create the private repository,
   ensure `LICENSE`, `NOTICE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, and
   `SECURITY.md` are present at the repository ROOT (2026-07-26 correction:
   this step used to say "add the full `governance/` folder" — that would put
   these five files back inside `governance/`, undoing publish-github's own
   2026-07-16 fix that moved them to the root specifically so GitHub's
   licence detector and Community Standards checklist recognise them; see
   `publish-github`'s step 6), plus `governance/TRADEMARKS.md`,
   `governance/LOGO-USAGE.md`, and `governance/GOVERNANCE.md` (which do stay
   inside `governance/`), push, **tag and create a real GitHub Release
   (verify `isDraft: false`)**, report the address.
6. Record the outcome (address, tag, and date, or the reason publishing
   stopped) in `Dev-Memory/PROGRESS.md` and `Dev-Memory/SESSION-LOG.md`.
7. Going public is a separate later step needing its own explicit yes from
   the user — never bundled into this command's flow; see `publish-github`'s
   "Going public" section. **Corrected 2026-08-17 (X219):** this step used to
   promise a `confirm-go-public.mjs` token file, removed on 2026-08-16 by
   finding X214. There is no token, and its absence removes no protection:
   the token never proved a person had agreed, because anything a hook can
   read an agent can write. Ask the user, and wait for the answer.
