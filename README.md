<p align="center">
  <img src="docs/brand/gru953-logo-colour.svg" alt="GRU953 logo" width="132">
</p>

<h1 align="center">GRU953-Studio</h1>

<p align="center"><strong>Simple technology. For everyone.</strong><br>
<span lang="bn">সহজ প্রযুক্তি। সবার জন্য।</span></p>

<p align="center">
  <a href="https://gru-953.github.io/GRU953-Studio/"><img alt="Website" src="https://img.shields.io/badge/website-gru--953.github.io-416CBD"></a>
  <a href="https://github.com/GRU-953/GRU953-Studio/wiki"><img alt="Guide" src="https://img.shields.io/badge/guide-the%20wiki-2E4F8E"></a>
  <a href="https://github.com/GRU-953/GRU953-Studio/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/GRU-953/GRU953-Studio?color=157E47&label=release"></a>
  <a href="https://github.com/GRU-953/homebrew-tap"><img alt="Homebrew tap" src="https://img.shields.io/badge/dynamic/regex?url=https%3A%2F%2Fraw.githubusercontent.com%2FGRU-953%2Fhomebrew-tap%2Fmain%2FFormula%2Fgru953-studio.rb&search=studio-cli-%28%5B0-9.%5D%2B%29.tgz&replace=v%241&label=homebrew&color=00769E"></a>
  <a href="LICENSE"><img alt="Licence" src="https://img.shields.io/badge/licence-PolyForm%20Noncommercial%201.0.0-6F4900"></a>
  <a href="CODE_OF_CONDUCT.md"><img alt="Contributor Covenant" src="https://img.shields.io/badge/code%20of%20conduct-Contributor%20Covenant%202.1-873831"></a>
</p>

<p align="center">
Describe an app in your own words. Answer a few simple pop-up questions.<br>
Get a real, working, tested app — with its own content, in your own language —<br>
published safely to your own GitHub account, under your name.<br>
<strong>No coding. No jargon. Nothing to install and forget about.</strong>
</p>

<p align="center">
📖 <a href="https://github.com/GRU-953/GRU953-Studio/wiki"><strong>Read the full plain-English guide on the wiki →</strong></a>
</p>

> **New to all this?** That's exactly who this is for. If you can describe your
> idea to a friend, you can use GRU953-Studio. The
> [wiki guide](https://github.com/GRU-953/GRU953-Studio/wiki) walks you through
> every step, in plain English.

---

## What is GRU953-Studio?

You talk to GRU953-Studio in plain English inside **Claude Code**, **Claude
Desktop** or **Google Antigravity** — and you can project it into any major 2026
AI coding platform (Cursor, Windsurf, Copilot, Devin, Replit, Aider, OpenHands,
Cline, Augment Code, Tabnine, JetBrains AI).

You tell it what you want — "a habit tracker for my phone", "a page that lists my
recipes". It asks a few multiple-choice questions to understand exactly what you
mean. Then a team of behind-the-scenes AI specialists **designs it, shows you a
clickable mock-up first, writes it, fills it with real content, tests it, and —
only when you say the word — publishes it** to your own GitHub account.

You never write or read a single line of code. You answer questions, one clear
pop-up at a time, each with a recommended answer already marked.

**In numbers:** one coordinator you talk to · a team of up to **38 specialist
roles** · **37 skills** (the internal playbooks the team follows) · **11 simple
commands** · **two automatic push-time safety hooks** (plus a suite of
pre-publish and CI integrity checks) · **zero third-party code dependencies**.

### Latest version: 6.1.0

Everything the studio does is listed in plain English in
[CHANGELOG.md](CHANGELOG.md), newest first — including what each release fixed
and how it was proved.

---

## Features at a glance

- **🖼️ See it before it's built.** A clickable mock-up ("warframe") of your app,
  plus a plain-English plan for what comes first and what comes later — you
  approve both before a single line of real code is written.
- **📝 Real content, not placeholder text.** Buttons, onboarding and messages
  written natively in **Bangla and English**; optional AI-generated images, audio
  and video using your own Google account, always with a cost estimate and your
  yes first.
- **📱 💻 Every platform, one team.** Android, iPhone/iPad, Mac, Windows and Linux —
  with a dedicated specialist for each of 10 programming languages (Dart/Flutter,
  Kotlin, Swift, Java, C#, Python, Rust, Go, C++, TypeScript), so the right expert
  builds the right platform.
- **🎛️ Stay in control.** Pause, resume, stop, skip, or schedule any piece of work
  for later — plus a visual one-page dashboard showing your app's concept, design,
  plan and content in one place.
- **🧠 Never loses your place.** Everything is saved in plain-text notes; close
  your laptop, come back next week, and it picks up exactly where it stopped.
- **💰 Cheapest option first, always shown.** An automatic chooser picks the right
  AI model and effort for each step — spending more only where it genuinely
  matters — and pauses to ask before anything unusually expensive.
- **🏗️ Grows in safe stages.** The smallest useful version first, then improvements
  in order — with a private backup of your work after every stage.
- **🔒 Safety built in, not bolted on.** Checks for leaked passwords, known
  weaknesses and licence problems run automatically before anything ships;
  publishing is private by default, with a separate, explicit step to make
  something public.

→ Full detail: **[Features and how it works](https://github.com/GRU-953/GRU953-Studio/wiki/Features)** on the wiki.

---

## What it can (and can't) build for you

**Great for:** small, genuinely useful, self-contained apps — a personal tracker,
a simple website, a small tool that does one job well, a page that organises
information, a little utility for your phone or computer, on whichever platform
you actually use. It handles the whole job: understanding the idea, designing it,
showing you a mock-up, writing the code, filling it with real content, checking
it, testing it, and publishing it.

**Not for:** very large, complex systems (a full banking platform, a social
network for millions of people). GRU953-Studio deliberately builds the smallest
version that actually works — then you can grow it later, in stages. It tells
you honestly, in plain English, if something is bigger than it should take on.

---

## Quick start (one-time setup)

**1. Get Claude Code.** GRU953-Studio is an add-on for
[Claude Code](https://claude.com/claude-code). It works in the Claude Code
desktop app (macOS, Windows, Linux), in a web browser on
[Claude Code on the web](https://claude.com/claude-code), and inside the VS Code
and JetBrains editor extensions. Install and sign in first.

**2. Add GRU953-Studio.** Type these two lines into Claude Code, one at a time:

```
/plugin marketplace add GRU-953/GRU953-Studio
/plugin install gru953-studio@gru953-studio
```

That's it — type `/studio-start` to begin. The very first time, it runs a short, one-off
"getting to know you" setup; it never asks again.

### Other ways to install it

**On a Mac or Linux with [Homebrew](https://brew.sh)** — one line, and it
installs Node.js for you too:

```
brew install GRU-953/tap/gru953-studio
```

Then run `gru953-studio install` to set the studio up in every AI tool it finds.
(Homebrew may ask you to trust the tap first; `brew trust GRU-953/tap` answers
that.)

**Or let one command do all of it.** If you would rather not type anything into
Claude Code, paste this into your terminal instead and it finds every AI tool on
your computer and sets them all up:

```
# macOS and Linux
curl -fsSL https://raw.githubusercontent.com/GRU-953/GRU953-Studio/main/tools/installers/install.sh | sh
```

```
# Windows (in PowerShell)
irm https://raw.githubusercontent.com/GRU-953/GRU953-Studio/main/tools/installers/install.ps1 | iex
```

Piping a script from the internet into your shell is a real risk, whoever
publishes it — [SECURITY.md](SECURITY.md) explains how to download and read it
first instead, which gets the same result.

**Prefer a download?** Every release has a ready-made installer for Claude Code,
Claude Desktop, Antigravity and VS Code on
[the releases page](https://github.com/GRU-953/GRU953-Studio/releases), each with
step-by-step instructions inside.

**Two free tools it relies on.** [Node.js](https://nodejs.org) (powers the
built-in safety checks — install once) and, only when you publish, the
[GitHub CLI](https://cli.github.com) (`gh auth login` once). If either is missing
when it's needed, the studio stops and tells you exactly what to do — it never
fails silently.

→ Step-by-step for every platform, updating and removing: **[Installing GRU953-Studio](https://github.com/GRU-953/GRU953-Studio/wiki/Installation)**.

---

## Optional: connect Ollama, OpenRouter and Gemini

All three are entirely optional, and all three always ask before doing anything.

- **[Ollama](https://github.com/GRU-953/GRU953-Studio/wiki/Connecting-Ollama)** —
  a free tool that runs AI models directly on your own computer, no cloud needed.
  The studio can use it as a private, free alternative to the cloud for an app it
  builds, or as a free second opinion for its own team. Claude stays the default;
  it always asks before installing anything or downloading a model.
- **[OpenRouter](https://openrouter.ai/)** — one account that reaches hundreds
  of AI models made by many different companies, including some that are free to
  use. The studio can offer it as a backend for an app it builds, and it
  **only ever picks free models unless you say otherwise** — decided by each
  model's real price, not by a name that happens to say "free". Run
  `/studio-models` to see what is free today and choose one. Worth knowing
  before you turn it on: the words your app sends go to OpenRouter and then on
  to the company that runs the model you picked.
- **[Gemini](https://github.com/GRU-953/GRU953-Studio/wiki/Connecting-Gemini)** —
  Google's cloud models, used **only** for generated images, audio and video (all
  written text is always produced by Claude). It is off until you turn it on, uses
  your own Google key, and shows a cost estimate and asks before every generation.

GRU953-Studio's own team of specialists always runs on Claude. Claude Code does
not support running on other companies' models, so these three are for the apps
the studio builds for you, not for the studio itself.

---

## The team behind it

You only ever talk to **one** friendly coordinator — the **Project Lead**. It
quietly brings in only the specialists your particular project needs and hides all
the machinery. A tiny website wakes a handful; a bigger app with logins, data and
content wakes more. There are **38 specialist roles in total**, and you never
manage any of them yourself.

| Group | Roles |
| :-- | :-- |
| **Core team** (most projects) | Project Lead, Interviewer, Architect, Scope Guardian, Builder, Reviewer, Tester, Security & Compliance Auditor, Brand Guardian, AI Developer, Fixer, Cost Monitor, Publisher, Memory Keeper |
| **Content team** (after you approve the mock-up) | Content Director, Text Content Specialist, and — only with your yes — Image, Audio and Video Content Specialists |
| **A native specialist per platform** | Flutter/Dart, Kotlin, Swift, Java, C#, Python, Rust, Go, C++, TypeScript |
| **Brought in only when needed** | Maintenance Agent, DevOps Engineer, Responsible-AI Reviewer, UX Designer, Accessibility Specialist, Technical Writer, Data Engineer, Localisation Specialist, Researcher |

→ Every role explained in plain English: **[The team of specialists](https://github.com/GRU-953/GRU953-Studio/wiki/The-Team)** · the playbooks they follow: **[Skills and capabilities](https://github.com/GRU-953/GRU953-Studio/wiki/Skills-and-Capabilities)**.

---

## Sample use cases

Type any of these between square brackets, or something like them:

- **A personal one-page site** — `[ a one-page website listing my favourite books, with a short review for each ]` (the simplest kind of job).
- **A small business tool** — `[ a booking page where my hairdressing clients can pick a free slot and leave their phone number ]` (logins and stored data, so a bigger team wakes automatically).
- **An iPhone app** — `[ an iPhone app that tracks how much water I drink each day ]` (built natively for iOS).
- **One app, every device** — `[ a to-do list that works the same on my Android phone, my iPhone and my laptop ]`.
- **An app in Bangla** — `[ a small recipe app for my mother, with all the buttons and messages in Bangla ]`.
- **An AI-powered feature** — `[ a tool that reads a long PDF report and gives me a plain-English summary ]`.

→ A fuller gallery, grouped by kind: **[Sample use cases](https://github.com/GRU-953/GRU953-Studio/wiki/Sample-Use-Cases)**.

---

## Staying in control

You never have to sit and watch. A few simple commands, typed any time:

| Command | What it does |
| :-- | :-- |
| `/studio-start` | Start a new project, or resume the current one. |
| `/studio-status` | A plain-English progress report. |
| `/studio-pause` · `/studio-resume` | Pause, then pick up exactly where you left off. |
| `/studio-stop` | Set everything down cleanly for the day. |
| `/studio-skip` | Set the current task aside and move on; nothing is deleted. |
| `/studio-schedule` | Ask it to pick a task back up at a time you choose. |
| `/studio-dashboard` | Open a one-page visual summary of your project. |
| `/studio-publish` | Publish privately to your own GitHub (with confirmations). |
| `/studio-models` | See which AI models are free to use right now, and pick one. |
| `/studio-update` | Manually check for and apply a studio update right now. |

---

## Safety and honesty

The built-in checks reliably stop *accidental* early publishing and *obvious*
leaked passwords — a careful safety net for normal, honest use. They protect
against honest mistakes, not deliberate sabotage, and we say so plainly rather
than overclaiming. There is no "100% secure" here — the exact protections and
their honestly-disclosed limits are written up in full in
[SECURITY.md](SECURITY.md), with nothing glossed over.

**What has actually been tested, and what has not.** Every automatic check runs
on macOS, Windows and Linux before anything ships: the installer runs end to
end into a throwaway folder on all three, every downloadable package is opened
and inspected, and the packaging is proved to produce identical files from
identical source. What no automatic test can do is open Claude Desktop, VS Code
or Antigravity and confirm they load what was installed — so
[docs/INSTALL-VERIFY.md](docs/INSTALL-VERIFY.md) is a ten-minute set of steps you
can follow yourself, and it says plainly which parts still need a person.

GRU953-Studio is an **independent, unofficial** plugin. It is not made or endorsed
by Anthropic (the makers of Claude) or Google (the makers of Gemini).

---

## Licence & trademark, in plain terms

**Free for non-commercial use** — personal projects, learning, research, hobbies,
and use by charities, schools and public-benefit organisations — under the
[PolyForm Noncommercial License 1.0.0](LICENSE), a professionally drafted, widely
recognised licence.

**Selling something built with it?** Commercial use (including apps you build with
GRU953-Studio and then sell) needs a separate paid licence — see
[COMMERCIAL-LICENCE.md](COMMERCIAL-LICENCE.md), or email **aninda.sh15@gmail.com**.

> **A note on the GitHub licence label.** GitHub's automatic licence detector only
> recognises the licences in its built-in catalogue, which does not include
> PolyForm — so GitHub may show this repository's licence as "Other". That is a
> display limitation on GitHub's side; the [LICENSE](LICENSE) file is the exact,
> official PolyForm Noncommercial 1.0.0 text. See [NOTICE](NOTICE) for detail.

The **GRU953 name and Soaring Bird logo** are protected separately — see
[governance/TRADEMARKS.md](governance/TRADEMARKS.md) and
[governance/LOGO-USAGE.md](governance/LOGO-USAGE.md). In short: you may use the
logo, unaltered, to refer or link to GRU953-Studio; please don't restyle it or use
it as your own.

---

## Community & governance

[Website](https://gru-953.github.io/GRU953-Studio/) ·
[Wiki guide](https://github.com/GRU-953/GRU953-Studio/wiki) ·
[Get help](SUPPORT.md) ·
[Discussions](https://github.com/GRU-953/GRU953-Studio/discussions) ·
[Code of Conduct](CODE_OF_CONDUCT.md) ·
[Contributing](CONTRIBUTING.md) ·
[Security policy](SECURITY.md) ·
[Governance](governance/GOVERNANCE.md) ·
[Changelog](CHANGELOG.md)

---

## About

Made by [Aninda Sundar Howlader](https://github.com/GRU-953) — for people who have
a real idea and just want the software part handled for them, simply and honestly.
GRU953-Studio is actively maintained: every release is checked against Anthropic's
own official documentation, and the team of specialists grows only when a real,
named gap needs filling — never for its own sake.

> GRU953 is a not-for-profit, open-technology organisation on a mission to make
> technology simple — and accessible — for all. Built openly with a global
> community and a home in Bangladesh, GRU953 designs tools that are free for
> personal use and open to study and improve. Simple technology. For everyone.

<p align="center"><em>Making technology simple — and accessible — for all.<br>
<span lang="bn">সবার জন্য প্রযুক্তি — সহজ ও নাগালের মধ্যে।</span></em></p>

---

<sub>"Claude" and "Claude Code" are trademarks of Anthropic PBC. "Gemini" is a
trademark of Google LLC. GRU953-Studio is an independent, unofficial plugin and is
not affiliated with, sponsored by, or endorsed by Anthropic or Google.</sub>
