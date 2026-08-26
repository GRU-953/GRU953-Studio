# Migrating from 6.1.0 to 7.0.0

Plain English, no jargon. If you have never installed GRU953-Studio, you do not
need this file — start at the [README](README.md).

> **Status of this document.** 7.0.0 is in development. Each section below is
> marked either **DONE** (already true in this branch) or **PLANNED** (agreed and
> scheduled, not yet built). Nothing here is described as finished before it is.
> Last updated 2026-08-26.

---

## 1. The licence changed — you gained rights, you lost none · **DONE**

Versions up to and including 6.1.0 were released under the PolyForm
Noncommercial License 1.0.0. It was free for personal, learning, research and
charitable use, but **selling** software you built with GRU953-Studio required a
separate paid licence, arranged by email.

**From 7.0.0 the project is [Apache License 2.0](LICENSE).** Commercial use is
free for everyone. There is nothing to buy and nobody to ask.

**What you must do:** nothing.

Details:

- The paid commercial licence is retired. [COMMERCIAL-LICENCE.md](COMMERCIAL-LICENCE.md)
  is kept as an explanation only.
- 6.1.0 and earlier stay under the licence they were published with. A licence
  cannot be changed retroactively for a release already distributed. If you were
  using an older version commercially, moving to 7.0.0 removes the question.
- The GRU953 name and the Soaring Bird logo are **still** protected. Apache-2.0
  grants no trademark rights (section 6 of the licence). You may build and sell
  what you like; you may not use the mark as your own identity. See
  [governance/TRADEMARKS.md](governance/TRADEMARKS.md).
- Third-party attributions, if any ever apply, live in
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Today there are none —
  GRU953-Studio contains no third-party code.

---

## 2. What else changes in 7.0.0 · **PLANNED**

These are agreed and scheduled. They are listed now so nothing arrives as a
surprise, and each will be filled in with exact instructions as it lands.

| Change | What it means for you |
| :-- | :-- |
| **Headless building** | You answer the opening interview once, then the studio builds without interrupting you again. Today it checks in at several points. |
| **Publishing becomes yours alone** | A headless run will finish with a complete, tested project on your own machine and stop. It will not create or push to a GitHub repository. Publishing becomes a step you take deliberately. This is a deliberate safety decision, not a missing feature. |
| **Claude Code only** | Support for Cursor, Windsurf, Cline, Roo Code, Aider, GitHub Copilot, Devin, Replit, OpenHands and Google Antigravity is withdrawn, along with the Ollama, OpenRouter and Gemini integrations. That support was never tested end to end and the project's own documentation called it "best-effort, uneven". One target that genuinely works beats nine that might. |
| **Two packages retired** | `@gru953/studio-antigravity` and the VS Code extension will be deprecated on npm. The Antigravity package could never install correctly in any case — its published archive did not contain the plugin it needed. A published package name cannot be deleted, only marked deprecated, so it will point at the replacement. |
| **The specialist roster is rebuilt** | The list of specialist roles is redesigned, and the three separate image, audio and video roles become one. If you have an existing project whose records name the old roster size, the studio will tell you plainly and how to update it. |
| **A supported-versions promise** | 7.0.x will receive bug and security fixes only, so it does not move under you. New features go to a 7.1 line. The exact promise will be published in [SECURITY.md](SECURITY.md). |

---

## 3. Existing projects built with 6.1.0 · **PLANNED**

Projects you have already built keep working — they are your own code in your own
repository and 7.0.0 does not touch them. What changes is what the studio does
when it next opens one: it reads the project's `Dev-Memory/` folder, and 7.0.0
records a format version there so that an older folder is recognised as *older*
rather than as damaged.

Exact steps will be added here before release.

---

## 4. Getting 7.0.0 · **PLANNED**

6.1.0 had no working way to tell you a new version existed. That is being fixed,
so this is the last upgrade you will have to hear about by reading a file.
