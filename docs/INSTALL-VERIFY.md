# Checking GRU953-Studio really is installed and working

This is a short set of checks you can run yourself, in plain steps, one action at
a time. It exists because of an honest limit: automated tests can prove the
installer puts the right files in the right places, and they do — but they cannot
open Claude Code and confirm it actually loads what was installed. Only a person sitting at the computer can do that.

**Corrected 2026-08-22 (finding X257): this page used to say "Nothing here
changes anything. Every step only looks." That was not true.** The CHECKS only
look and change nothing — but where a check finds something missing, the step
that follows it installs something. Every such step is marked
**INSTALLS SOMETHING** below: the steps that add a marketplace and install the
plugin. (The other two such steps — Part 4's `--install-extension` and Part 5's
`gru953-studio install` — went with those Parts in 7.0.0.) You can stop before any of them if you only wanted to look.

**How long:** about four minutes. You can stop after Part 1 if you only want to
confirm the command itself works.

---

## What has already been checked automatically

So you know what you are and are not confirming:

| Already proved by tests | Needs you |
| :-- | :-- |
| The installer finds the tools on a machine, and says which | Whether each app actually loads the studio once installed |
| Files land in the exact locations each vendor documents | |
| Every downloadable package opens, and is laid out correctly | |
| The same source always builds byte-identical packages | |
| Install, then uninstall, leaves nothing behind and never damages the studio's own files | |
| All of the above on macOS, Windows and Linux | |
| Free AI models are told apart from paid ones by real price | |

---

## Part 1 — the command itself (2 minutes)

**Step 1.** Open your terminal. On a Mac, press `Cmd` and the space bar, type
`Terminal`, then press Enter. On Windows, click Start, type `PowerShell`, then
press Enter.

**Step 2.** Type this exactly, then press Enter:

```
gru953-studio doctor
```

**Step 3.** Read what it prints. You should see:

- `yes` next to **Node.js** and **git**.
- Either `yes` or `not yet` next to **GitHub CLI** — "not yet" is fine, you only
  need it when you publish something.
- A list under "Which AI coding tools are on this computer?" naming at least one
  tool as `found`.

If it says a command was not found, GRU953-Studio is not installed yet — see the
Quick start in [README.md](../README.md) first.

If anything essential says `NO`, it will print numbered steps underneath. Follow
those, then run Step 2 again.

---

## Part 2 — Claude Code (2 minutes)

**Step 4.** Open Claude Code.

**Step 5.** Type this and press Enter:

```
/studio-status
```

**Step 6.** You should get a plain-English reply. If you have no project yet it
will say so — that is a pass. What matters is that it answers rather than saying
the command is unknown.

**Step 7.** Type this and press Enter:

```
/studio-models
```

**Step 8.** You should see a list of AI models that are free to use, and a
question asking which you would like. **Every model shown should be marked
free.** If you see one marked paid in the recommended position, that is a bug
worth reporting.

You can close the question without choosing. Nothing is saved unless you pick
one.

---

## Parts 3 to 5 were removed in 7.0.0

They verified Claude Desktop, VS Code / Cursor / Windsurf, and Google Antigravity.
**7.0.0 targets Claude Code only** — those host adapters, the VS Code extension and
the Antigravity client were all deleted, so there is nothing left for those steps to
check. Parts 1 and 2 above are now the whole of it.

(Removed 2026-08-27. This file was the last one still describing the 6.x product: it
was never touched during the v7 rebuild, and README.md links to it as the authority on
"which parts still need a person" — so the one page whose job was to say what is and
is not proven was itself describing three hosts that no longer exist.)

## If something did not pass

None of these CHECKS changes anything, and nothing here can break your computer.
The steps marked **INSTALLS SOMETHING** do change your setup — that is what they
are for — and they are the only ones that do. (Corrected 2026-08-22, X257: this
sentence used to claim nothing on the page changed anything, while the same page
instructed three separate installs.)
If a step did not do what it says:

1. Note which step number it was.
2. Copy what appeared on screen instead.
3. Open <https://github.com/GRU-953/GRU953-Studio/issues> and describe both.

Include which operating system you are using and which app it was. That is
usually enough to identify the problem straight away.
