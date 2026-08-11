# Checking GRU953-Studio really is installed and working

This is a short set of checks you can run yourself, in plain steps, one action at
a time. It exists because of an honest limit: automated tests can prove the
installer puts the right files in the right places, and they do — but they cannot
open Claude Desktop, VS Code or Antigravity and confirm those apps actually load
what was installed. Only a person sitting at the computer can do that.

Nothing here changes anything. Every step only looks.

**How long:** about ten minutes for all of it. You can stop after Part 1 if you
only use Claude Code.

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

## Part 3 — Claude Desktop (3 minutes)

**Step 9.** Open Claude Desktop. (This is the Claude chat app, not Claude Code.)

**Step 10.** In the sidebar on the left, click **Customize**.

**Step 11.** Click **Plugins**.

**Step 12.** Look for **GRU953-Studio** in the list.

- **If it is there:** click it. You should see its skills and agents listed. That
  is a pass — stop here.
- **If it is not there:** it has not been installed yet. Continue to Step 13.

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

## Part 4 — VS Code, Cursor or Windsurf (2 minutes)

Skip this if you do not use any of them.

**Step 17.** Open VS Code (or Cursor, or Windsurf).

**Step 18.** Press `Cmd`+`Shift`+`P` on a Mac, or `Ctrl`+`Shift`+`P` on Windows
and Linux. A box opens at the top.

**Step 19.** Type `GRU953` and look at the list underneath.

**Step 20.** You should see **GRU953-Studio: Status**. Click it. A message should
appear. That is a pass.

If nothing named GRU953 appears, the extension is not installed. Download
`gru953-studio-<version>.vsix` from
[the releases page](https://github.com/GRU-953/GRU953-Studio/releases), then in
your terminal type:

```
code --install-extension the-file-you-downloaded.vsix
```

(Replace `code` with `cursor` or `windsurf` if you use one of those.)

---

## Part 5 — Google Antigravity (2 minutes)

Skip this if you do not use Antigravity.

**Step 21.** Open Antigravity.

**Step 22.** Type this into it, in plain words:

```
What is the GRU953-Studio protocol, and how many specialists does it have?
```

**Step 23.** It should answer describing the studio, and give a number of
specialist roles. That means it has read the installed rules and skills. If it
does not know what you are talking about, the plugin has not been installed —
run `gru953-studio install` in your terminal, then restart Antigravity.

**Two things to expect in Antigravity, which are limitations rather than faults:**

- The `/studio` commands do not exist there. They are a Claude Code feature. Ask
  in plain words instead — "carry on with my project", "where are we up to".
- The specialists are provided as a rules file Antigravity follows itself, rather
  than as genuinely separate helpers. That is because Antigravity's plugin format
  has no place for separate agents. It works, but Claude Code does this better.

---

## If something did not pass

Nothing here can break your computer, and none of these checks changes anything.
If a step did not do what it says:

1. Note which step number it was.
2. Copy what appeared on screen instead.
3. Open <https://github.com/GRU-953/GRU953-Studio/issues> and describe both.

Include which operating system you are using and which app it was. That is
usually enough to identify the problem straight away.
