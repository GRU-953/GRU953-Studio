<p align="center">
  <img src="docs/brand/gru953-logo-colour.svg" alt="GRU953 logo" width="160">
</p>

<h1 align="center">GRU953-Studio</h1>

<p align="center"><strong>Simple technology. For everyone.</strong><br>
<em>সহজ প্রযুক্তি। সবার জন্য।</em></p>

<p align="center">
Describe an app in your own words. Answer a few simple pop-up questions.<br>
Get a real, working, tested app — published safely to your own GitHub account, under your name.<br>
<strong>No coding. No jargon. Nothing to install and forget about.</strong>
</p>

---

## Start here (30-second version)

GRU953-Studio is a helper you talk to in plain English. You tell it what you
want ("a habit tracker for my phone", "a page that lists my recipes"), it
asks you a few multiple-choice questions to understand exactly what you mean,
and then a team of behind-the-scenes AI specialists builds it, checks it,
tests it, and — only when you say the word — publishes it for you.

You never write or read a single line of code. You just answer questions,
one clear pop-up at a time, each with a recommended answer already marked.

> **New to all this?** That's exactly who this is for. If you can describe
> your idea to a friend, you can use GRU953-Studio.

---

## Latest version: **3.0.4** — stable, and recommended for everyone

Version 3.0.4 is a **safety and reliability update**. Nothing about how you
use it has changed — it's simply been checked, hardened, and tested more
thoroughly, strictly against Anthropic's own official instructions for tools
like this one. If you already have it, updating is a good idea; if you're new,
you'll get this version automatically.

You don't need to read the technical details, but if you're curious, the full
plain-English list of every change is in
[CHANGELOG.md](CHANGELOG.md).

---

## What it can (and can't) build for you

**Great for:** small, genuinely useful, self-contained apps — a personal
tracker, a simple website, a small tool that does one job well, a page that
organises information, a little utility for your phone or computer. It handles
the whole job: understanding the idea, designing it, writing the code,
checking it, testing it, and publishing it.

**Not for:** very large, complex systems (a full banking platform, a social
network for millions of people). GRU953-Studio deliberately builds the
smallest version that actually works and does what you asked — then you can
grow it later. It will tell you honestly, in plain English, if something is
bigger than it should take on.

---

## How it works, step by step

1. **Tell it your idea.** Type it between square brackets, like
   `[ a simple habit tracker for my phone ]`, or just type `/studio`.
2. **Answer a short interview.** It asks only as many pop-up questions as it
   genuinely needs — never a wall of them — each a simple multiple choice with
   a recommended answer marked.
3. **It sizes the job.** It tells you, in plain words, whether your project is
   Tiny, Standard, or Complex, and what that means for how much checking and
   care it will apply. You can ask for more or less at any time.
4. **It builds, checks, and tests.** It checks in with you at every meaningful
   step. If anything gets stuck, it tells you plainly what's wrong and what
   your choices are — it never leaves something quietly broken.
5. **It publishes — only when you say so.** Your app goes to *your own* GitHub
   account (a free, safe online store for your app's files — think of it as a
   personal filing cabinet for software), private by default. Making it public
   is a separate step you choose later.
6. **It remembers everything.** Your whole project is saved in plain-text notes
   in your own folder. Close your computer, come back next week, and it picks
   up exactly where you left off.

---

## Installing it (one-time setup)

### Step 1 — Get Claude Code first

GRU953-Studio is an **add-on for [Claude Code](https://claude.com/claude-code)**
(Anthropic's coding assistant that you talk to). It is not a separate program,
and it does **not** run inside the Claude Desktop chat app — it needs Claude
Code's specific abilities. So: install and sign in to Claude Code first.

### Step 2 — Add GRU953-Studio

Pick **one** of the two ways below.

**Way A — the simple way (recommended, always the newest version).**
Type these two lines into Claude Code, one at a time, pressing Enter after each:

```
/plugin marketplace add GRU-953/GRU953-Studio
/plugin install gru953-studio@gru953-studio
```

(The `@gru953-studio` part just tells Claude Code which list to install from —
here the plugin and its list share the same name.)

**Way B — from a downloaded file** (if you'd rather not type the command above,
or want a specific version):

1. Open the [Releases page](https://github.com/GRU-953/GRU953-Studio/releases)
   and download the `.zip` file under the newest version (top of the list).
2. Unzip it anywhere on your computer.
3. In Claude Code, type the two lines below — but replace
   `/path/to/the/unzipped/folder` with where you actually unzipped it (e.g. on a
   Mac, `/Users/yourname/Downloads/GRU953-Studio`; on Windows,
   `C:\Users\YourName\Downloads\GRU953-Studio`):
   ```
   /plugin marketplace add /path/to/the/unzipped/folder
   /plugin install gru953-studio@gru953-studio
   ```

### Two free things it relies on

- **[Node.js](https://nodejs.org)** — a small free program that powers the
  built-in safety checks. Install it once.
- **[GitHub CLI](https://cli.github.com)** — only needed *when you publish*. A
  small free tool; after installing, run `gh auth login` once and follow the
  prompts to sign in to your GitHub account.

If either is missing when it's needed, GRU953-Studio will stop and tell you
exactly what to install, in plain English — it won't fail silently.

---

## Using it for the first time

The very first time, it runs a short, one-off "getting to know you" setup (your
preferred name, the kinds of things you like to build, your GitHub username).
This never happens again.

After that, every project is the same friendly loop: **describe → answer
pop-ups → approve → it builds → you review → it publishes when you say so.**

A real first project might be as simple as typing:

```
[ a one-page website listing my favourite books ]
```

…and answering the handful of questions that follow.

---

## The team behind it (you never manage any of this)

You only ever talk to **one** friendly coordinator — the **Project Lead**. It
quietly brings in only the specialists your particular project needs (a tiny
website wakes a few; a bigger app with logins and data wakes more) and hides
all the machinery. This list is here purely if you're curious — you never need
to remember it.

**The core team — most projects use these:** Project Lead (your single point of
contact), Interviewer (your pop-up questions), Architect (proposes ways to build
it), Scope Guardian (stops unrequested extras creeping in), Builder (writes the
code), Reviewer (checks it independently), Tester (proves each part works),
Security & Compliance Auditor (scans for leaked passwords, known weaknesses, and
licence problems before anything ships), Brand Guardian (keeps your look
consistent), AI Developer (adds AI features safely, only if you need them),
Fixer (precise repairs when stuck), Cost Monitor (keeps spending on the cheaper
side), Publisher (versions and ships it), Memory Keeper (remembers everything
between sessions).

**Brought in only when your project needs them:** Maintenance Agent (later fixes
and features), DevOps Engineer (hosting/putting it online), Responsible-AI
Reviewer (fairness and honesty checks for AI features), UX Designer (makes it
pleasant to use), Accessibility Specialist (usable by people with disabilities),
Technical Writer (a plain guide for *your* finished app), Data Engineer (safe
data storage), Localisation Specialist (more than one language, e.g. English +
Bangla), Researcher (checks current facts).

*(23 specialist roles in total, coordinated for you — never something you
operate by hand.)*

---

## When something goes wrong — plain fixes

GRU953-Studio is built to explain problems in plain English rather than show
scary error text. Here are the most common bumps and their simple fixes:

| What you see or notice | What it means | What to do |
| :-- | :-- | :-- |
| `command not found: claude` | Claude Code isn't installed yet | Install [Claude Code](https://claude.com/claude-code) first, then try again |
| It won't work in the **Claude Desktop** app | GRU953-Studio needs Claude **Code**, a different (though related) tool | Use Claude Code, not the Desktop chat app |
| `/plugin install` didn't seem to take effect | The plugin list sometimes needs a refresh | Close and reopen Claude Code, then try the install line again |
| A message about **Node.js** or a missing safety check | Node.js isn't installed | Install [Node.js](https://nodejs.org) (free), then retry |
| It says it **can't publish** / mentions `gh` or "not signed in" | The GitHub tool isn't set up | Install the [GitHub CLI](https://cli.github.com), run `gh auth login`, follow the prompts |
| It **stopped part-way** (e.g. you ran out of daily usage) | Nothing is lost — it saves progress constantly | Come back later and say "continue" or run `/studio` again; it resumes exactly where it stopped |
| It **refused to publish** unexpectedly | A safety check did its job (an unconfirmed publish, or a password spotted in the files) | Read the plain-English reason it gives, fix that one thing, and try again — this is protection, not a fault |
| A pop-up used a word you didn't know | It should explain every term once | Ask it "what does that mean?" in plain words — it's happy to explain |

Still stuck? Open an issue on the
[GitHub issues page](https://github.com/GRU-953/GRU953-Studio/issues) describing
what you did and what happened — no technical detail required.

---

## Honest limitations (nothing hidden)

We'd rather tell you the boundaries up front than let you discover them the hard
way:

- **Claude Code only.** It does not run in Claude Desktop, or on its own. If you
  don't use Claude Code, this isn't the tool for you (yet).
- **It's an AI tool, so it needs a connection and has usage limits.** On a long
  build you may hit your Claude usage cap for the day — that's fine, it saves
  progress and you continue later.
- **It builds small, focused apps well** — not huge, complex systems. It will
  say so honestly if your idea is too big for one sitting.
- **The safety guards protect against honest mistakes, not deliberate
  sabotage.** The built-in checks reliably stop *accidental* early publishing and
  *obvious* leaked passwords. They are a careful safety net for normal, honest
  use — they can't out-think someone deliberately trying to trick their own
  setup. In everyday use, this simply means: it won't publish, or leak a secret,
  by accident. Full technical detail is openly documented in
  [governance/SECURITY.md](governance/SECURITY.md) — nothing is hidden.
- **It's an independent, unofficial plugin.** It's not made or endorsed by
  Anthropic (the makers of Claude).

No software is ever perfectly bug-free, and we won't pretend otherwise — but
this version has been tested and hardened thoroughly, and it's in dependable
shape for real use.

---

## Resources & credits

GRU953-Studio stands on the shoulders of good, free tools and open standards. In
the spirit of "credit where it's due," here is everything it uses or was built
against:

- **Runs on:** [Claude Code](https://claude.com/claude-code) by
  [Anthropic](https://www.anthropic.com) — the assistant this plugin extends.
- **Built strictly to spec against Anthropic's own official documentation:**
  the [Claude Code docs](https://code.claude.com/docs),
  the [Claude Developer Platform docs](https://platform.claude.com/docs), and
  the [Agent Skills documentation](https://agentskills.io) — every part of this
  plugin was checked, line by line, against these.
- **Safety checks powered by:** [Node.js](https://nodejs.org) (its standard
  library only).
- **Publishing uses:** the [GitHub CLI](https://cli.github.com) and
  [GitHub](https://github.com).
- **No third-party code dependencies.** The plugin ships no outside packages —
  fewer moving parts, less to go wrong, nothing extra to trust.
- **Typefaces (brand):** [DM Sans](https://fonts.google.com/specimen/DM+Sans)
  and [Noto Sans Bengali](https://fonts.google.com/noto/specimen/Noto+Sans+Bengali),
  under the SIL Open Font License.
- **Colours:** the GRU953 *Open Spectrum* palette (Cobalt-led), contrast-checked
  for accessibility.

---

## Licence & trademark, in plain terms

**Free for non-commercial use** — personal projects, learning, research,
hobbies, and use by charities, schools and public-benefit organisations — under
the [Polyform Noncommercial License 1.0.0](governance/LICENSE), a professionally
drafted, widely recognised licence.

**Selling something built with it?** Commercial use (including apps you build
with GRU953-Studio and then sell) needs a separate paid licence — see the
"Commercial use" part of the [licence](governance/LICENSE), or email
**aninda.sh15@gmail.com**.

> *One honest note:* because the licence file lives in the `governance/` folder
> rather than at the very top of the repository, GitHub may show "no license
> detected" on the repo page. That's just where GitHub looks — the
> [licence text](governance/LICENSE) still fully applies.

The **GRU953 name and Soaring Bird logo** are protected separately — see
[governance/TRADEMARKS.md](governance/TRADEMARKS.md) and
[governance/LOGO-USAGE.md](governance/LOGO-USAGE.md). In short: you may use the
logo, unaltered, to refer to or link to GRU953-Studio; please don't restyle it
or use it as your own.

---

## Community & governance

[Code of Conduct](governance/CODE_OF_CONDUCT.md) ·
[Contributing](governance/CONTRIBUTING.md) ·
[Security policy](governance/SECURITY.md) ·
[Governance](governance/GOVERNANCE.md) ·
[Changelog](CHANGELOG.md)

## About

Made by [Aninda Sundar Howlader](https://github.com/GRU-953) — for people who
have a real idea and just want the software part handled for them, simply and
honestly.

<p align="center"><em>Making technology simple — and accessible — for all.<br>
সবার জন্য প্রযুক্তি — সহজ ও নাগালের মধ্যে।</em></p>

---

<sub>"Claude" and "Claude Code" are trademarks of Anthropic PBC. GRU953-Studio is
an independent, unofficial plugin and is not affiliated with, sponsored by, or
endorsed by Anthropic.</sub>
