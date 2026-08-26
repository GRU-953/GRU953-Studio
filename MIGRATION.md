# Migrating from 6.1.0 to 7.0.0

Plain English, no jargon. If you have never installed GRU953-Studio, you do not need
this file — start at the [README](README.md).

**The short version.** You gain the right to use it commercially for free. You lose
automatic publishing to GitHub, on purpose. Nothing you have already built is
affected. The upgrade itself needs nothing from you.

---

## 1. The licence changed — you gained rights, you lost none

Versions up to and including 6.1.0 were released under the PolyForm Noncommercial
License 1.0.0. It was free for personal, learning, research and charitable use, but
**selling** software you built with GRU953-Studio required a separate paid licence,
arranged by email.

**From 7.0.0 the project is [Apache License 2.0](LICENSE).** Commercial use is free for
everyone. There is nothing to buy and nobody to ask.

**What you must do:** nothing.

Details:

- The paid commercial licence is retired.
  [COMMERCIAL-LICENCE.md](COMMERCIAL-LICENCE.md) is kept only so links to it still
  explain what changed.
- 6.1.0 and earlier stay under the licence they were published with. A licence cannot
  be changed retroactively for a release already distributed. If you were using an
  older version commercially, moving to 7.0.0 removes the question entirely.
- The GRU953 name and the Soaring Bird logo are **still** protected. Apache-2.0 grants
  no trademark rights (section 6 of the licence). You may build and sell whatever you
  like; you may not present it as being GRU953's own product. See
  [governance/TRADEMARKS.md](governance/TRADEMARKS.md).
- Third-party attributions, if any ever apply, live in
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Today there are none —
  GRU953-Studio contains no third-party code.

## 2. The studio no longer publishes for you

This is the change most likely to surprise you, so it is second.

**Before:** the studio could create a private GitHub repository and push your finished
app to it, asking you to approve the push when it got there.

**Now:** a run finishes with your project complete, tested and committed on your own
machine, and stops. Creating a repository and pushing are yours to do.

**Why.** The studio now works unattended, and an approval question is something nobody
is there to answer. The old design would either have stopped and waited — defeating the
point — or pushed without asking, which is not a decision a build should make about
when your code becomes visible to other people. Stopping is the honest option.

**What you must do:** when a build finishes and you want it on GitHub, do it yourself.
The project is a normal git repository with your work already committed:

```bash
gh repo create my-project --private --source . --push
```

## 3. It now runs unattended

You answer one round of pop-up questions at the start. The studio then researches,
designs, plans, codes, reviews and tests without interrupting you again.

**What you must do:** nothing, but expect the shape of a session to feel different —
one conversation at the beginning, then a finished project, rather than being asked
things along the way.

If the studio hits something it genuinely cannot decide, it does not stop the whole
build. It parks that one task, carries on with everything else it can finish, and tells
you at the end which decisions are waiting for you.

## 4. Claude Code only

Support is withdrawn for Cursor, Windsurf, Cline, Roo Code, Aider, GitHub Copilot,
Devin, Replit, OpenHands and Google Antigravity, along with the Ollama, OpenRouter and
Gemini integrations.

That support was never tested end to end, and this project's own documentation
described it as "best-effort, uneven". One target that genuinely works is worth more
than nine that might.

**What you must do:**

- **If you used GRU953-Studio in Claude Code:** nothing.
- **If you used it in another editor:** stay on 6.1.0, or move to Claude Code. The
  rules files the old `gru953-studio init` wrote into your projects
  (`.cursorrules`, `.windsurfrules`, `.clinerules`, `.roomodes`, `.aider.conf.yml`,
  `AGENTS.md`, `.agents/`) are yours and are not touched by upgrading. They will simply
  stop being regenerated. Delete them when you no longer want them.
- **If you installed `@gru953/studio-antigravity`:** uninstall it. Every published
  version of it was uninstallable anyway — the package shipped without the plugin its
  own code loads at runtime.
- **If you installed the VS Code extension:** uninstall it.

Two CLI commands are gone with those hosts: `gru953-studio init` (wrote the other
editors' rules files) and `gru953-studio models` (listed OpenRouter models).
`install`, `doctor`, `status`, `update` and `uninstall` are unchanged.

## 5. Media is specified, not generated

Images, audio and video used to be produced through an opt-in paid Google integration,
with an approval prompt before every single generation.

**Now** one `media-content-specialist` writes you an asset brief for each asset — what
it must show, every size and format your platform needs, the alt-text written out in
full, and a note on what you may legally use it for — plus step-by-step instructions
for producing it yourself in whatever tool you prefer.

This was already what the studio did when no key was available. It is now the only
behaviour, and it needs no API key, no per-image cost and no data sent to anyone.

**What you must do:** if a build needs a picture, expect a brief and a guide rather than
a file.

## 6. Projects you have already built

They keep working. They are your own code in your own repository, and 7.0.0 does not
touch them.

What changes is what the studio does when it next opens one. It reads the project's
`Dev-Memory/` folder, and 7.0.0 records a format version in the files it writes, so an
older folder is recognised as *older* rather than as damaged.

**What you must do:** nothing. On the first run in an existing project the studio will
tell you plainly what it is updating and why. Two things worth knowing:

- **The task list moves from a table to data.** `Dev-Memory/PROGRESS.md` used to be
  the record; it is now *generated* from `Dev-Memory/tasks.json`. If you had edited
  `PROGRESS.md` by hand, copy anything you want to keep before the first run, because
  the generated file replaces it.
- **The roster changed from 38 specialists to 36** (the three separate image, audio and
  video roles became one). A project that recorded the old number will be told about
  the difference rather than blocked by it.

## 7. Getting 7.0.0

```bash
npm install -g @gru953/studio-cli@7.0.0
gru953-studio install
gru953-studio doctor
```

`doctor` will tell you plainly if anything is not in place.

**Being precise about this, because it is easy to overclaim.** 6.1.0 had no working way
to tell you a new version existed: the automatic check was never actually run by
anything. In 7.0.0 the studio now says which version you are running, unprompted, and
how to check for a newer one — previously it mentioned updating only if you raised the
subject first, and someone who does not know a new version exists has no reason to
raise it.

What that does **not** do is reach you retroactively. If you are reading this while
still on 6.1.0, you are running 6.1.0's code, and nothing shipped inside 7.0.0 can
change what it tells you. The channels that reach you are npm (`npm outdated -g`), the
`gru953-studio update` command, and the deprecation notices npm prints for the two
withdrawn packages. This is the last upgrade that depends on you reading a file — but
only from 7.0.0 onwards.

## 8. What is supported from here

`7.0.x` receives bug fixes and security fixes only, so nothing moves under you. New
features go to a `7.1` line you choose to move to.

- Exactly what will not change: [docs/STABILITY.md](docs/STABILITY.md)
- Which versions get security fixes: the supported-versions table in
  [SECURITY.md](SECURITY.md)

**6.1.0 and earlier receive no further fixes, including security fixes.** If you are
staying on an older version, that is the trade you are making.
