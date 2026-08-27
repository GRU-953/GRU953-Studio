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

**How long:** about seven minutes — Part 1 two, Part 2 two, Part 3 three. You can
stop after Part 1 if you only want to
confirm the command itself works.

---

## What has already been checked automatically

So you know what you are and are not confirming:

| Already proved by tests                                                                 | Needs you                                                 |
| :-------------------------------------------------------------------------------------- | :-------------------------------------------------------- |
| The installer finds the tools on a machine, and says which                              | Whether each app actually loads the studio once installed |
| Files land in the exact locations each vendor documents                                 |                                                           |
| Every downloadable package opens, and is laid out correctly                             |                                                           |
| The same source always builds byte-identical packages                                   |                                                           |
| Install, then uninstall, leaves nothing behind and never damages the studio's own files |                                                           |
| All of the above on macOS, Windows and Linux                                            |                                                           |
| Free AI models are told apart from paid ones by real price                              |                                                           |

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

## Part 3 — Claude Desktop (3 minutes)

**What this Part does and does not prove.** It proves the plugin is installed and
that Claude Desktop can see its skills and agents. It does not prove the studio
can build a project there, because it cannot: the build loop, the specialists and
the safety gates are Claude Code features. If you only want to build something,
Part 2 is the one that matters and you can stop there.

**Step 9.** Open Claude Desktop. (This is the Claude chat app, not Claude Code.)

**Step 10.** In the sidebar on the left, click **Customize**.

**Step 11.** Click **Plugins**.

**Step 12.** Look for **GRU953-Studio** in the list.

- **If it is there:** click it. You should see its skills and agents listed. That
  is a pass — stop here.
- **If it is not there:** it has not been installed yet. Continue to Step 13.

> **INSTALLS SOMETHING — Steps 13 to 16.** These add a marketplace to Claude
> Desktop and install the plugin from it. Stop here if you only wanted to check
> what is already on your computer. (It said "to Claude Code" until 2026-08-27 —
> a copy of Part 2's wording, in the part about a different app.)

**Step 13.** Click **Add marketplace**.

**Step 14.** Type exactly this, then press Enter:

```
GRU-953/GRU953-Studio
```

**Step 15.** Find GRU953-Studio in the list and click **Install**.

**Step 16.** Click it and check its skills and agents appear.

> **A note on the downloadable file.** Each release also has a
> `gru953-studio-claude-desktop-<version>.zip` you can upload on that same
> Plugins page. Step 13 above is the route Anthropic documents, so it is the one
> to use first. The downloadable file is there for a computer that cannot reach
> GitHub — and, said plainly, Anthropic's documentation does not state which file
> type that upload expects, so if the .zip is refused, that is why, and the
> marketplace route above always works.

---

## Parts 4 and 5 were removed in 7.0.0

They verified VS Code / Cursor / Windsurf and Google Antigravity. Those host
adapters, the VS Code extension and the Antigravity client were all deleted in
7.0.0, so there is nothing left for those steps to check.

(Removed 2026-08-27. This file was the last one still describing the 6.x product:
it was never touched during the v7 rebuild, and README.md links to it as the
authority on "which parts still need a person" — so the one page whose job was to
say what is and is not proven was itself describing hosts that no longer exist.
**Part 3 was removed in the same edit and then put back an hour later**: I had
written in README.md that the Claude Desktop installer went with the others, and
then believed my own sentence rather than checking `clients/cli/src/detect.js`,
which still lists Claude Desktop as a supported target. Recorded rather than
tidied away, because deleting a verification step for a host that still works is
exactly how a product ends up unverified.)

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
