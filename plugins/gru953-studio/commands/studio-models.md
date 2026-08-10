---
description: Search the free AI models available through OpenRouter and pick which one your apps should use.
---

Help the user search OpenRouter's live model list and choose a model, following
the `openrouter-integration` skill. Speak plain, simple UK English, and follow
the `operating-charter` skill throughout.

**What OpenRouter is, in one sentence, the first time it comes up:** a single
service that gives you access to hundreds of AI models made by many different
companies, some of which are free to use.

1. Say in one line what is about to happen: looking up which AI models are
   available free of charge right now, so a model can be chosen for any app that
   needs one. Nothing is spent and nothing is installed by looking.

2. Run the search. Free models only, unless the user asked to see paid ones:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/hooks/openrouter-models.mjs" --json
   ```

   If the user gave a word to search for, pass it: `--search <their word>`.
   Looking up the list needs no account and no key — verified 2026-08-10.

3. If it could not reach OpenRouter, report the message it gives, plainly, and
   stop. Nothing has been changed. This is not a failure of their project.

4. Present the choice as ONE pop-up multiple-choice question. Show at most four
   or five options, each as the model's name plus, in plain words, what it is
   good for and how much it can read at once ("about 200 pages of text at a
   time" is more use to a non-technical reader than "262144 tokens"). Mark the
   recommended option. Recommend on this basis, in order:
   - it is free;
   - it can read enough at once for what the user has described;
   - for code-related work, a coding-focused model; for everything else, a
     general-purpose one.

5. **Never present a paid model as the recommended option.** If the user asks to
   see paid models, show them with `--all`, say clearly which ones cost money,
   and take a separate, explicit confirmation — naming the model and what it
   charges — before any paid model is chosen. Agreeing to look is not agreeing
   to spend.

6. Say plainly, before the choice is recorded, that using OpenRouter means the
   words the app sends go to OpenRouter and on to the company that runs the
   chosen model. Some people will not want that for their data, and they should
   be able to decide with that in front of them.

7. Once they choose, hand the decision to `memory-keeper` to record in
   `~/.gru953-studio/profile.md`, so it is remembered for later projects and
   they are not asked again. Confirm in one line what was saved, and say they
   can run this command again any time to change it.

8. This command only ever reads a public list and records a preference. It does
   not enable OpenRouter for any app, install anything, or spend anything —
   `ai-developer` still offers it as a choice when an app actually needs an AI
   feature, and the Claude API stays the default.
