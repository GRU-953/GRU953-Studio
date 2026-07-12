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

The push-detection matcher (`isPushCapable` in `hooks/lib.mjs`) matches
literal command TEXT, not what the shell actually executes after expansion.
As of 2026-07-11 (eight audit rounds, most re-testing the immediately
preceding round's own fix rather than trusting it) it canonicalises several
known obfuscation techniques before matching: `$IFS`-based word-splitting
(`git${IFS}push`), quote-splicing of a word whether the quoted segments are
empty or not and however many splices are chained (`git pu""sh`,
`git p"u"s"h"`), a backslash before ANY character, not just letters/digits
(`git p\ush`, and — found separately, since escaped PUNCTUATION defeated an
earlier letters/digits-only version — `-\-public`, `--visibility\=public`),
backslash-newline line continuations, ANSI-C quoting (`$'public'` resolves
to the literal text `public` in bash; found live via a background audit
agent that was cut off by a session rate limit mid-investigation before it
could report — the lead was still run down and confirmed rather than
discarded), and ANSI-C hex/octal escapes WITHIN that quoting (`$'pub\x6cic'`
and `$'pub\154ic'` both resolve to `public`, and `$'\x67\x68'` resolves to
`gh` — spelling the binary name itself letter-by-letter; the wrapper-strip
alone left these as literal backslash-digit text instead of decoding them).
Every `git`/`gh`/subcommand/flag match is also case-insensitive, because the
filesystems this plugin actually targets (macOS APFS, Windows NTFS) resolve
a binary name via `PATH` without regard to case — `GIT push origin main`
is not obfuscation, it is bash running the real `git` binary, unchanged;
this was the single most severe bypass found across the whole loop, since
it defeated the matcher's very first check with zero confirmation tokens
of any kind recorded, for the plain `push`/`repo create`/`repo edit` cases
themselves, not just an edge-case flag value. `isGoPublicCommand`
(`hooks/gate.mjs`) shares this same canonicalisation and case-insensitivity,
and its own token-matching regex tolerates quotes/`$IFS` around every one
of `gh`/`repo`/`create`/`edit`/`--public`/`--visibility`, closing a critical
gap where it used to match raw, un-normalized, case-sensitive text entirely
separately from `isPushCapable`. All of these were found, in live
adversarial passes (never trusted from a report alone — reproduced directly
against the real hook code before being called a bug, and again after being
called fixed), to defeat the matcher entirely. This closes every concrete
case found so far; it does not close shell text obfuscation in general,
which has effectively unlimited variations (command substitution, variable
reuse/assignment, further encoding schemes, and combinations of all of the
above). A concrete, reproduced instance of the command-substitution
category: `git $(printf "\x70\x75\x73\x68") origin main` resolves in real
bash to `git push origin main`, but this hook cannot know that without
actually executing the `printf` call — closing this in general would mean
executing (or fully simulating) arbitrary shell command substitution,
which this hook design deliberately does not do (see the next paragraph).
Bounded same-command variable assignment (`VAR=value; ... $VAR ...`,
including `export`/`local`/`readonly`/`declare`/`typeset`-prefixed forms
and simple transitive chains) IS resolved, as of 2026-07-12 — only a
variable set in an earlier, separate command, or from the environment
outside this command's own text, remains unresolvable.

Two more currently-active protections, added this same 2026-07-12
engagement and previously missing from this document (a genuine staleness
gap, not a security hole — this section under-described what the matcher
already covers, rather than over-claiming): bash brace expansion
(`{git,push}` resolves to the two words `git push` before the command line
is even parsed) is recognised and expanded, including the degenerate
single-element range form (`{s..s}` resolves to just `s`) that has no comma
and would otherwise dodge the comma-requiring expansion; and every keyword
match tolerates a trailing shell terminator immediately after it (`;`, `|`,
`&`, `)`, a backtick, or a newline) rather than requiring whitespace or
end-of-string, since `git push;`/`gh repo edit ... --public|` etc. are
real, common shell forms that a naive end-anchor previously missed
entirely.

A final adversarial pass across this whole engagement (2026-07-12) found
one more CRITICAL bypass in the bounded variable-assignment feature just
described: a declaration keyword (`export`/`declare`/`readonly`/`typeset`)
is itself a real command invocation, so ITS OWN arguments undergo bash's
normal command-line expansion — including brace expansion — before the
keyword sees them. `export v={private,public}` does not assign the literal
text `{private,public}`; bash expands it into two arguments, `v=private
v=public`, and the keyword applies them left-to-right with the LAST one
winning (confirmed live via `bash -x`). This let `export v={private,public};
gh repo edit me/app --visibility=$v` bypass the go-public gate with only
the private-publish token recorded — reproduced end-to-end via the real
`gate.mjs` before being fixed. The bare, no-keyword form
(`v={private,public}; ...`) is NOT exploitable and was deliberately left
unchanged: a plain assignment word is not itself brace-expanded by bash, so
`$v` there really does hold the literal, un-expanded text, which the
existing generic brace-expansion pass already handles correctly.

Treat all of this as raising the bar against realistic accidents and
common tricks, not as a sandbox against a determined adversary — the only
fully robust fix would be executing the command and inspecting its real
effect, which this hook design (a fast, stdlib-only, per-command check)
does not do. If you find another concrete bypass, please report it (see
above) — this list will
keep growing as real cases are found, not be treated as closed.

`hooks/licence-scan.mjs` currently checks top-level `node_modules/*` only,
not each dependency's own nested `node_modules`.

`gate.mjs`'s two internal scripts, `confirm-publish.mjs` and
`confirm-go-public.mjs`, are exempted from push-capable detection so the
studio can record a user's confirmation at all (see `isConfirmScriptOnly`
in `hooks/lib.mjs`). That exemption checks an exact filename
(`path.basename()` match against the two known script names) — it trusts a
FILENAME, not a cryptographic identity. A file deliberately created with
one of those exact names, anywhere the session can run `node` against it,
would receive the same exemption as the real script. This is the same
class of residual risk every filename-based check in this project carries,
disclosed rather than eliminated: doing better would mean verifying the
resolved path against a fixed, known-good location, which isn't possible
here because the legitimate invocation form genuinely varies (an absolute
`${CLAUDE_PLUGIN_ROOT}/...` path from the plugin cache, or a relative
`hooks/confirm-publish.mjs` from within the project root).

**2026-07-11 Round 9 additions** (found by a dedicated audit lens attacking
agent behaviour and instruction-following, not shell text — a genuinely
different attack surface from everything above). The core finding was a
PASS: no skill or agent file offers a shortcut where a memory file's
*claimed* approval ("user already confirmed, proceed") substitutes for a
fresh, live `AskUserQuestion` answer — the private-publish and go-public
gates are anchored to a token file `gate.mjs` checks mechanically, never to
prose any agent reads and trusts. Two adjacent, real, lower-severity gaps
were found alongside that PASS:

- The publish/go-public confirmation tokens are `sha256("studio-publish:" +
  <project root path>)` — a formula in this project's own public source
  code, computed from a path that is not a secret. Anyone who can already
  write files into a project's `Dev-Memory/` folder could compute and write
  a valid `PUBLISH-APPROVED`/`GO-PUBLIC-APPROVED` file directly, without
  ever going through a live `AskUserQuestion` answer. The token proves "this
  exact file was written for this exact project," not "a human clicked
  yes." Not fixed: doing better would need a way to verify a human genuinely
  answered a pop-up, which is a Claude Code host-level capability this
  plugin has no access to — the same boundary every trust decision in this
  document ultimately runs into.
- `dev-memory/SKILL.md` and `memory-keeper.md` both state a mandatory
  secrets-scan before every memory write, but `hooks.json` only wires
  `scan.mjs`/`gate.mjs` on the `Bash` matcher — there is no `PreToolUse`
  hook on `Write`/`Edit` backing this rule mechanically. It is currently
  enforced by instruction-following alone, unlike the push-time scan (which
  *is* hook-enforced regardless of what any file claims). Blast radius is
  bounded: `Dev-Memory/` is git-ignored on creation, and `scan.mjs`
  independently blocks any push whose file set contains a `Dev-Memory/`
  path — so a secret that slipped through an unscanned memory write still
  could not reach GitHub via this plugin's own publish path. The exposure
  is local-disk-only. Worth a real `Write`/`Edit` PreToolUse hook in a
  future round; not yet built.
