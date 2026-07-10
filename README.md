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

## Installing

These are two small, one-time installs — click the links below and follow
the on-screen instructions, then run the two lines shown.

```
/plugin marketplace add GRU-953/GRU953-Studio
/plugin install gru953-studio
```

You'll need [Node.js](https://nodejs.org) installed (it powers the
plugin's safety checks — the secret scanner, the publish gate, and the
licence scanner) and, only when you're ready to publish, the free [GitHub
CLI](https://cli.github.com) signed in (`gh auth login`).

## Licence

Free for any noncommercial purpose — personal use, research, hobby
projects, and use by charities, schools and public-benefit organisations —
under the [GRU953 Community Licence 1.0](governance/LICENSE). Commercial
use, including apps GRU953-Studio builds for you that you go on to sell,
requires a separate paid licence — see Section 3 of the licence, or email
aninda.sh15@gmail.com. The GRU953 name and logo are governed separately —
see [governance/TRADEMARKS.md](governance/TRADEMARKS.md) and
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
