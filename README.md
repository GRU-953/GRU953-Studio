<p align="center">
  <img src="docs/brand/gru953-logo-colour.svg" alt="GRU953 logo" width="160">
</p>

# GRU953-Studio

**Type your app idea in plain English. Answer a few pop-up questions.
Get a working, tested app, privately published to your own GitHub — GitHub
is a free online place where your app's code is safely stored, like a
personal filing cabinet for software — built by a team of AI specialists,
led by an AI project lead, for people with no coding background at all.**

## What this is

GRU953-Studio is a plugin — an add-on that gives an existing tool a new
skill — for [Claude Code](https://claude.com/claude-code) (Anthropic's
command-line coding assistant). Once installed, you talk to it
the same way you'd describe an idea to a friend, and it handles the entire
software build for you: understanding what you actually want, designing
it, planning it, writing the code, checking the code, testing it, fixing
problems, and — only when you say so — publishing it to your own GitHub
account, under your own name, as its sole author.

You never need to write or read code yourself. Every question it asks you
is a simple multiple-choice pop-up, with a recommended answer already
marked, in plain UK English — any unavoidable technical term is explained
in one short sentence the first time it comes up.

## How it works, in short

1. **Type your idea** between square brackets, e.g. `[ a simple habit
   tracker for my phone ]`, or run `/studio`.
2. **Answer a short interview** — GRU953-Studio asks exactly as many
   pop-up questions as it needs to understand your idea properly, and no
   more.
3. **It assigns a size ("Tier")** to your project — Tiny, Standard, or
   Complex — and tells you in plain English what team and what oversight
   that means. You can ask for more or less oversight at any time.
4. **It builds, checks and tests the app**, checking in with you at every
   meaningful step, and never leaving something broken without telling you
   plainly what's wrong and what your options are.
5. **It publishes privately to your own GitHub** only after you explicitly
   confirm — private by default, with going public a separate, later step
   you choose.
6. **It remembers everything**, in plain text files in your own project
   folder (`Dev-Memory/`) — so you can close your computer, come back a
   week later, and pick up exactly where you left off, in the same session
   or a brand new one.

## The specialist team

You never talk to any of these directly — the Project Lead is your one
point of contact, and brings in only the ones your project actually needs.
The full list below (31 specialist roles in total) is here for anyone curious how it
works — you'll never need to remember it. A tiny one-page website wakes a
handful; a bigger app with logins, data and an AI feature wakes more. A
specialist your project doesn't need never runs.

**The core team — most projects use these:**

| Role | What it does |
| :-- | :-- |
| **Project Lead** | The one voice you talk to; runs the whole build and reports back in plain English |
| **Interviewer** | Asks your pop-up questions — as many as needed, never more |
| **Architect** | Proposes 2-3 ways to build your idea, explains the trade-offs, you choose |
| **Scope Guardian** | Stops the team quietly adding things you didn't ask for |
| **Builder** | Writes the actual code, one small piece at a time |
| **Reviewer** | Checks the code independently and trims anything unnecessary before publishing |
| **Tester** | Proves each piece actually works, with real evidence — never just a claim |
| **Security & Compliance Auditor** | Scans for leaked secrets, known vulnerabilities, and licence conflicts before anything ships |
| **Brand Guardian** | Keeps your own branding consistent across everything visible |
| **AI Developer** | Builds in AI features safely, only if your idea genuinely needs one |
| **Fixer** | The smallest, precise repair when something gets stuck |
| **Cut-Recorder** | Keeps a permanent note of ideas deliberately not built, so they're never silently re-proposed |
| **Cost Monitor** | Keeps spending on the cheaper side, warns you before anything pricier |
| **Publisher** | Ships your finished app privately to your own GitHub, under your own name |
| **Memory Keeper** | Remembers everything about your project between sessions, safely |
| **Maintenance Agent** | Comes back later for fixes and new features on an already-published project |

**Brought in only when your project needs them** (an AI feature, a user
interface, stored data, more than one language, and so on) — added in
v2.0.0 to cover the full range of professional software and AI work:

| Role | What it does | Turns up when… |
| :-- | :-- | :-- |
| **QA Lead** | Decides what "tested enough" means and plans the testing, before any test is run | your project is Standard-sized or bigger |
| **Release Manager** | Sets the version number and writes the plain-English "what changed" notes | it's time to publish something bigger than tiny |
| **DevOps Engineer** | Sets up a repeatable way to build and put your app online | your app needs to be hosted or packaged |
| **SRE / Observability** | Makes a running app's problems visible instead of silent | your app runs as a live, always-on service |
| **Prompt Engineer** | Writes and fine-tunes the instructions behind any AI feature | your idea includes an AI feature |
| **MLOps Engineer** | Keeps measuring an AI feature's quality over time | an AI feature needs to keep working well |
| **Responsible-AI Reviewer** | Checks an AI feature for fairness, harm and honesty | your idea includes an AI feature |
| **UX Designer** | Makes the app easy and pleasant to move through | your app has a screen people use |
| **Accessibility Specialist** | Makes sure people with disabilities can use it | your app has any user interface |
| **Technical Writer** | Writes the plain-English guide for *your* finished app | your app needs its own instructions |
| **Data Engineer** | Designs how your app stores data so it's safe to change | your app keeps data between uses |
| **Privacy Officer** | Checks personal data is collected minimally and honestly | your app handles personal data |
| **Localisation Specialist** | Makes the app work in more than one language (e.g. English + Bangla) | your app needs more than one language |
| **Researcher** | Finds current, real facts so decisions aren't guesswork | a choice depends on an up-to-date fact |
| **Project Assistant** | Keeps the task list, checklists and logs tidy behind the scenes | any project; always-on for the biggest ones |

## The skills (6 skills — how it all runs)

| Skill | What it does |
| :-- | :-- |
| `studio` | The main coordinator — runs the whole process end to end |
| `first-run` | A short, one-off "getting to know you" setup, the very first time you ever use it |
| `dev-memory` | The plain-text memory system that makes every project resumable, in a new session or the same one |
| `cost-guard` | The spending rules that keep costs predictable and on the cheaper side |
| `yagni-rules` | The lean-coding rules every Builder follows — nothing gets built that wasn't actually needed |
| `publish-github` | The exact, safety-checked steps for publishing to your GitHub |

## Installing

**Requires Claude Code.** GRU953-Studio is a Claude Code plugin — it needs
Claude Code's specific abilities (spawning specialist sub-agents, running
safety checks before every action) that the Claude Desktop app doesn't
have. It does **not** work inside Claude Desktop.

### Option 1 — from the marketplace (recommended, always up to date)

These are two small, one-time installs — click the links below and follow
the on-screen instructions, then run the two lines shown.

```
/plugin marketplace add GRU-953/GRU953-Studio
/plugin install gru953-studio
```

### Option 2 — from a downloaded zip file

Every release has a ready-to-download zip attached to it — useful if you'd
rather not type the marketplace command, or want a specific version.

1. Go to the [Releases page](https://github.com/GRU-953/GRU953-Studio/releases)
   and download the `.zip` file under the version you want (the newest one
   is at the top).
2. Unzip it anywhere on your computer.
3. In Claude Code, add it as a local marketplace, pointing at the folder
   you just unzipped (replace the path with wherever you put it):
   ```
   /plugin marketplace add /path/to/the/unzipped/folder
   /plugin install gru953-studio
   ```

Either option needs [Node.js](https://nodejs.org) installed (it powers the
plugin's safety checks — the secret scanner, the publish gate, and the
licence scanner) and, only when you're ready to publish, the free [GitHub
CLI](https://cli.github.com) signed in (`gh auth login`).

## Licence

Free for any noncommercial purpose — personal use, research, hobby
projects, and use by charities, schools and public-benefit organisations —
under the [Polyform Noncommercial License 1.0.0](governance/LICENSE), a
professionally drafted, independently reviewed licence template recognised
by GitHub and by dependency-compliance tooling. Commercial use, including
apps GRU953-Studio builds for you that you go on to sell, requires a
separate paid licence — see the "Commercial use" section at the end of the
licence, or email aninda.sh15@gmail.com. The GRU953 name and logo are
governed separately — see
[governance/TRADEMARKS.md](governance/TRADEMARKS.md) and
[governance/LOGO-USAGE.md](governance/LOGO-USAGE.md).

## Community

[Code of Conduct](governance/CODE_OF_CONDUCT.md) ·
[Contributing](governance/CONTRIBUTING.md) ·
[Security policy](governance/SECURITY.md) ·
[Governance](governance/GOVERNANCE.md)

## About

Built by [Aninda Sundar Howlader](https://github.com/GRU-953), for
non-technical people who have a real idea and just need the software part
handled for them.

---

"Claude" and "Claude Code" are trademarks of Anthropic PBC. GRU953-Studio
is an independent, unofficial plugin and is not affiliated with, sponsored
by, or endorsed by Anthropic.
