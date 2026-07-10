# Security Policy

_GRU953-Studio_

We take the security of GRU953-Studio seriously and appreciate the efforts of
those who report vulnerabilities responsibly. GRU953-Studio runs autonomous
AI agents with file, shell, and GitHub access on your machine — please
report concerns responsibly rather than opening a public issue.

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public issue for a
suspected vulnerability.

- **Email:** aninda.sh15@gmail.com

Include as much detail as you can: affected component, steps to reproduce,
potential impact, and any proof-of-concept material. Please do not include
real secrets or personal data in the report itself.

## What to expect

- **Acknowledgement** within **72 hours** of your report.
- **Initial triage** within **7 days**, including a first assessment of validity
  and severity.
- **Coordinated disclosure** within a target window of **90 days** from the
  acknowledgement, agreed with the reporter where possible.

## Severity

Severity is assessed using the **Common Vulnerability Scoring System (CVSS)** —
a standard 0–10 scale for rating how serious a vulnerability is.

## Identifiers and credit

Where appropriate, we will request a **CVE** (a public catalogue ID for a
vulnerability) and a **GHSA** (a GitHub Security Advisory) for confirmed issues.
Reporters will be **credited** for their findings unless they ask to remain
anonymous.

## Safe harbour

We will not pursue or support legal action against anyone who reports a
vulnerability in good faith, makes a reasonable effort to avoid privacy
violations and service disruption, and gives us a reasonable opportunity to
resolve the issue before public disclosure. Activity conducted under this
policy is considered authorised.

## Scope

In scope: GRU953-Studio's own code (agents, skills, hooks, commands) —
particularly the security hooks in `plugins/gru953-studio/hooks/` (secret
scanning, the publish gate, the licence scanner). Out of scope: the security
of code that GRU953-Studio *builds for you* in a separate project.

## Known limitations (disclosed, not hidden)

The publish-safety hooks (`scan.mjs`, `gate.mjs`) defend against accidental
or premature publishing and ordinary secret leaks. They are not a defence
against a fully compromised or deliberately adversarial agent session —
Claude Code's hook mechanism cannot verify that a human, rather than the
agent itself, actually approved an action. If you find a way to defeat these
mechanisms in an honest, non-adversarial session, that IS a bug — please
report it.

`hooks/licence-scan.mjs` currently checks top-level `node_modules/*` only,
not each dependency's own nested `node_modules`.
