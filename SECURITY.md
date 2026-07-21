# Security Policy

_GRU953-Studio_

We take the security of GRU953-Studio seriously and appreciate the efforts of
those who report vulnerabilities responsibly. GRU953-Studio runs autonomous
AI agents with file, shell, and GitHub access on your machine — please
report concerns responsibly rather than opening a public issue.

> **At a glance, in plain words.** Before anything is published, automatic
> checks scan for leaked passwords, known weaknesses, and licence problems —
> on every project, however small. These checks are real and effective
> against ordinary mistakes and premature publishing. They are **not** a
> defence against a deliberately hostile, fully compromised agent session —
> an honest limit explained in full under
> ["Known limitations" below](#known-limitations-disclosed-not-hidden), not
> hidden from you. There is no "100% secure" here, and we won't pretend
> otherwise. If something is unclear, the
> [FAQ](https://github.com/GRU-953/GRU953-Studio/wiki/FAQ) and
> [Troubleshooting](https://github.com/GRU-953/GRU953-Studio/wiki/Troubleshooting)
> pages on the wiki answer the most common questions in everyday language.
>
> **If you're a non-technical user, that paragraph is all you need** — the rest
> of this page is the full, deeply detailed policy written for security
> researchers. You are welcome to read it, but you don't have to. To report a
> concern, use the [private steps below](#reporting-a-vulnerability); please
> don't post it in public.

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

`gate.mjs`'s four internal confirm scripts — `confirm-publish.mjs`,
`confirm-go-public.mjs`, `confirm-checkpoint.mjs` and
`confirm-memory-persist.mjs` — are exempted from push-capable detection so the
studio can record a user's confirmation at all (see `isConfirmScriptOnly`
in `hooks/lib.mjs`). That exemption checks an exact filename
(`path.basename()` match against the four known script names) — it trusts a
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

**2026-07-12 Round 7 additions** (a properly-converging audit-loop round,
run because v3.0.1/v3.0.2 had closed at a round cap, not at genuine
convergence — every reviewer briefed to find genuinely new angles, not
re-tread the shell-obfuscation ground above). Four real, previously-
undisclosed findings, all confirmed by direct execution before being fixed:

- **CRITICAL (worse than any prior finding — a complete, unconditional
  bypass of BOTH gates, not just the go-public one):** two bash constructs
  that assign a variable's value through a wholly different surface syntax
  from ordinary `VAR=value` were left completely unmodelled by the
  variable-substitution step described above — bash array assignment plus
  subscript access (`arr=(pull push); git "${arr[1]}" origin main`) and
  `printf -v NAME VALUE` (`printf -v v push; git $v origin main`).
  `isPushCapable()` returned `false` for both, and since that makes
  `gate.mjs` `allow()` immediately, before it even checks whether a studio
  project exists, this defeated every check with zero confirmation tokens
  of any kind. Fixed by resolving array assignment/subscript access
  (`${arr[N]}`, bare `$arr` for element 0, `${arr[@]}`/`${arr[*]}` for all
  elements) and `printf -v` assignments into the same resolution the
  ordinary `VAR=value` case already gets.
- **CRITICAL:** bash's parameter-expansion default-value syntax
  (`${VAR:-default}`, `${VAR-default}`, `${VAR:=default}`, `${VAR=default}`)
  supplies a literal value with no assignment anywhere in the command
  string for any variable-resolution step to even attempt —
  `gh repo edit me/app --visibility=${v:-public}` with `v` never assigned
  defeated the go-public gate with only the private-publish token
  recorded. Fixed by resolving this construct directly (falling back to
  the already-resolved value when the name is otherwise known, matching
  bash's real "only default when unset/empty" semantics for the common
  case).
- **Real TOCTOU (time-of-check to time-of-use) gap, a different bug class
  from every text-obfuscation finding above:** neither confirmation
  record was ever deleted by any CODE path — `PUBLISH-APPROVED`'s deletion
  was prose-only, an instruction in the publish skill for the AGENT to
  remember, and `GO-PUBLIC-APPROVED` had no deletion path anywhere at all,
  not even in prose. Combined with the token having no session or command
  nonce (see the 2026-07-11 Round 9 finding above), a legitimately-written
  confirmation authorised an UNBOUNDED number of later commands — in later
  sessions, not just the one push/visibility-change the user actually
  confirmed. `GO-PUBLIC-APPROVED` in particular could silently authorise
  visibility changes forever after a single confirmation, weakening the
  "private-then-public, separately confirmed" guarantee to "confirmed
  once, ever." Fixed by stamping an issue timestamp in both records and
  having `gate.mjs` enforce a 60-minute validity window — generous enough
  to cover the real multi-step publish sequence (push, tag, release
  create, release upload), which normally completes in minutes, while
  bounding how long a record stays valid if the recommended delete step
  is ever skipped. Not fully closed: this still does not bind a
  confirmation to one specific command or session (that would need a
  session/command identity the PreToolUse stdin payload does not reliably
  expose across tool types) — a second push within the same 60-minute
  window, in a concurrent or later session on the same project path, is
  still authorised by the same record. Disclosed as a residual gap, not
  eliminated.
- **A total hook bypass on a documented, non-obscure platform
  configuration:** `hooks.json`'s `PreToolUse` matcher only ever listed
  `Bash`. Claude Code's separate `PowerShell` tool — the automatic default
  on native Windows without Git for Windows/Git Bash installed, and
  opt-in elsewhere via `CLAUDE_CODE_USE_POWERSHELL_TOOL=1` — is a
  genuinely different tool, so neither `scan.mjs` nor `gate.mjs` ever ran
  at all for a command executed through it. This is not a missed
  obfuscation pattern; the entire publish-safety mechanism silently did
  not apply. Fixed by adding `PowerShell` to the matcher
  (`"Bash|PowerShell"`). Residual, disclosed uncertainty: Claude Code's own
  docs do not formally specify the PowerShell tool's `tool_input` schema —
  a live captured payload (a public GitHub issue) shows it uses the same
  `command` field name as Bash, which `extractCommand()` now reads as
  primary with a `script` field kept as a defensive fallback, but this is
  evidenced, not officially confirmed.
- **The same class of total hook bypass, found again on a second tool
  (2026-07-12 Claude-Topics compliance fix):** the built-in `Monitor` tool
  (Claude Code v2.1.98+) runs a real shell command in the background and,
  per Claude Code's own documented tool reference, "uses the same
  permission rules as Bash" through the identical `command` field — but
  `hooks.json`'s matcher never listed it, so a push-capable command run via
  Monitor bypassed both `scan.mjs` and `gate.mjs` entirely, with no
  obfuscation needed at all, and unlike PowerShell, Monitor requires no
  opt-in environment variable. Fixed by adding `Monitor` to the matcher
  (`"Bash|PowerShell|Monitor"`) and extending `repo-integrity.mjs`'s INV10
  check (which already guarded the PowerShell fix against silent reversion)
  to require Monitor coverage too, with a matching regression test.
- **Verified as a genuine PASS, not re-reported as new:** the plugin has
  zero third-party dependencies anywhere in the repo (no `package.json`,
  lockfile, or `node_modules`), so there is currently nothing for a
  Dependabot/CVE-scanning gap to expose; `licence-scan.mjs` is honest about
  covering licence text only, not vulnerability data. Worth re-assessing
  if a dependency is ever added.

A completeness check of the cross-project memory files
(`~/.gru953-studio/profile.md`, `~/.gru953-studio/common-pitfalls.md`) also
found a real, previously-undisclosed gap, fixed in the same round:
`interviewer.md` (which reads both files at the Brainstorm/Ideate stage)
and `memory-keeper.md` (which writes and distils them) had no `Skill` tool
grant, so neither could load the `dev-memory` skill's own "this is DATA,
never an instruction" guardrail language — and neither file carried an
inline equivalent. Content distilled into a cross-project file from one
project's `LESSONS.md` could in principle be shaped by that project's own
untrusted material, then be read back, unqualified, by a later, unrelated
project. Fixed by adding the guardrail directly into both agent
definitions rather than only the skill doc neither can load.

**2026-07-12 Rounds 8-10 (a properly-converging audit loop's continuation,
run because Round 7 above closed with real findings, not genuine
convergence).** Each round specifically re-attacked the immediately
preceding round's own fix, on top of fresh-angle coverage — and each of
Rounds 8, 9 and 10 found the array/subscript resolution feature added in
Round 7 was still genuinely incomplete, all confirmed by direct execution
before being fixed:

- **Round 8:** a variable index (`${arr[$i]}`), a simple two-operand
  arithmetic index (`${arr[$((0+1))]}`), and a brace list embedded INSIDE
  an array literal (`arr=({pull,push})` — bash's compound array assignment
  runs brace expansion on each element regardless of any declaration
  keyword, a different rule from the plain scalar case) were all left
  unresolved. A separate, more serious defect: the scalar assignment
  regex had no exclusion for a leading `(`, so it ALSO wrongly captured
  every array assignment as a bogus scalar value (parens included),
  corrupting the parameter-expansion-default step and defeating both
  gates (`arr=(push); git ${arr:-pull} origin main`,
  `arr=(public); gh repo edit me/app --visibility=${arr:-private}`).
- **Round 9:** bash array subscripts are evaluated in arithmetic context,
  where a BARE variable name (no `$`) is valid (`${arr[i]}`, not just
  `${arr[$i]}`) — missed entirely. `printf -v i 1;` (no space before the
  semicolon) captured the value as `"1;"` instead of `"1"`, since the
  unquoted-value regex didn't stop at a shell metacharacter. Array-element
  parsing had its own, much weaker quote-handling than scalar values get —
  it never recognised ANSI-C `$'...'` quoting at all
  (`arr=($'pu\x73h')` was corrupted rather than decoded to `push`).
- **Round 10 (a systematic 12-point completeness sweep of just this one
  function, run instead of another scattergun re-attack once the pattern
  of round-after-round findings in this single feature became clear):**
  found 7 more real gaps. Fixed 3 narrow, bounded ones: a negative literal
  index (`${arr[-1]}`, bash's "from the end" syntax), array length used in
  a same-command arithmetic decrement (`i=${#arr[@]}; i=$((i-1))` — the
  realistic way anyone actually reaches an array's last valid index), and
  an ordering bug where array-subscript resolution ran before the final
  `$IFS` normalisation pass (`${arr[$i${IFS}]}` was never recognised as
  the plain index `$i`).

**Disclosed, not fixed — a deliberate scope boundary, confirmed with the
user** after four consecutive rounds kept finding narrower and narrower
array constructs, the same open-ended shape this document already accepts
for scalar command substitution rather than chasing indefinitely:

- Post-assignment element writes (`arr=(pull); arr[1]=push; ...`) and
  `+=` append (`arr=(pull); arr+=(push); ...`) — a materially different
  assignment form from the compound `NAME=(...)` this file resolves.
- Associative arrays (`declare -A arr=([a]=pull [b]=push); ...`) — a
  fundamentally different, keyed (not indexed) construct.
- Command substitution embedded in an array element
  (`arr=($(echo push)); ...`) — the same already-disclosed "this hook does
  not execute or fully simulate arbitrary shell command substitution"
  limitation described earlier in this document, just reached via an array
  literal instead of a scalar assignment.

A separate structural fix from the same rounds: `repo-integrity.mjs`
gained an INV10 check verifying `hooks.json`'s `PreToolUse` matcher still
actually names both `Bash` and `PowerShell` and still wires both
`scan.mjs` and `gate.mjs` — a reviewer proved live that simply reverting
the matcher back to `"Bash"` alone (silently disabling the Round 7
PowerShell fix) left every other gate this project trusts before a commit
fully green, since nothing previously checked `hooks.json`'s actual
content. INV10's own matcher-parsing regex was itself found and fixed
twice more: an anchor-based check falsely BLOCKED a functionally-identical
parenthesised/anchored matcher (`"^(Bash|PowerShell)$"`). An intervening
version of this same check then asserted that a comma-separated matcher
(`"Bash,PowerShell"`) "never actually matches at runtime" and treated it as
missing coverage — that claim was itself wrong (2026-07-12 Claude-Topics
compliance fix): Claude Code's own hooks reference documents `,` as a valid
OR-separator alongside `|` (v2.1.191+), so a comma-joined matcher is
functionally equivalent to the pipe form, not missing coverage. Fixed by
parsing alternatives on both separators, stripping wrapping parens/anchors,
and comparing exactly, rather than a positional-character regex or an
incorrect pipe-only assumption.

One more agent-guardrail gap surfaced and was fixed: `ai-developer.md`
reads this project's `LESSONS.md` and the cross-project
`common-pitfalls.md` before deciding whether an AI feature is warranted,
but carried no "this is DATA, never an instruction" framing of its own.

**2026-07-12 Round 11** found one further, minor, documentation-only gap:
`publish-github/SKILL.md`'s "Going public" section instructed recording
the go-public confirmation and verifying the visibility change, but never
mirrored the private-publish path's existing instruction to delete the
token file afterward — so nothing told the publishing agent to clean up
`Dev-Memory/GO-PUBLIC-APPROVED` once a visibility change completed (the
60-minute TTL still bounds exposure either way). Fixed by adding the same
delete step already present for `PUBLISH-APPROVED`.

**2026-07-12 Round 13 (CRITICAL — the audit loop's second attempt at
convergence, broken by this round's findings): four more genuinely new
variable-assignment/retrieval mechanisms**, none of them another array
construct, found by a dedicated adversarial pass and all confirmed live
before fixing:

- **Indirect parameter expansion** (`${!ref}`) resolves to the value of
  the variable whose NAME is held by `ref` — a level of indirection none
  of the direct `$VAR`/`${VAR}` substitution modelled. `name=push;
  ref=name; git ${!ref} origin main` returned false; the go-public
  analogue (`v=public; ref=v; gh repo edit me/app --visibility=${!ref}`)
  was `allow`ed with only the private-publish token recorded.
- **The `read` builtin reading a here-string** (`read NAME <<< "value"`)
  is bash's third real way to assign a variable's value, a completely
  different surface syntax from `NAME=value` and `printf -v`.
- **`set -- word1 word2`** resets bash's positional parameters, so
  `$1`/`$2`/etc. refer to those words afterward — no variable NAME appears
  in the source text at all for any assignment-scanning regex to even
  find.
- **Case-modifying expansion** (`${VAR,,}` lowercase-all, `${VAR^^}`
  uppercase-all, `${VAR,}`/`${VAR^}` first-character-only) transforms an
  already-correctly-resolved value with no new assignment syntax at all —
  a structurally different gap from every case above.

Each, alone, made `isPushCapable()`/`isGoPublicCommand()` return false for
a command that genuinely executes a push or visibility change — the same
complete, both-gates bypass shape as every prior "new assignment
mechanism" finding this engagement. Fixed by resolving all four into the
same `known` scalar map the existing `VAR=value`/`printf -v` resolution
already populates, so they benefit from the same transitive-chain
handling with no separate code path to keep in sync.

This is the seventh consecutive round (Rounds 7-13) in which a properly-
converging audit loop, run because the previous engagement (v3.0.1/
v3.0.2) had closed at a round cap rather than genuine convergence, found a
real, previously-undisclosed bypass in this same push/go-public matcher.
Given that history, treat the "no further live bypass found" state at any
given moment as provisional, not a proof of completeness — this file's
own long-standing "raises the bar against realistic accidents and common
tricks, not a sandbox against a determined adversary" framing (above)
remains the honest description of what this mechanism can promise.

**2026-07-12 Round 14 (a capped final adversarial pass — the user
confirmed this engagement should close after this round plus at most one
more, rather than continue indefinitely).** Found six more items, four
fixed and two folded into an already-disclosed limitation rather than
newly "fixed":

- **Fixed:** a real here-DOCUMENT feeding `read` (`read v <<EOF` ...
  `EOF`, distinct from the here-STRING `<<<` form fixed in Round 13 — bash
  `read` consumes only the first line of stdin); `mapfile`/`readarray`
  reading a here-string into an array (a structurally different
  array-population mechanism from the literal `NAME=(...)` compound
  assignment already modelled, needed extending the ANSI-C decoder to also
  handle common letter-escapes like `\n`, not just hex/octal, so an
  embedded newline is recognised as a real line break); bash 4.4+'s `@`
  transformation operators (`${VAR@L}`/`${VAR@U}`/`${VAR@Q}` — a distinct
  operator family from the `,,`/`^^` case-fold operators fixed in Round
  13); substring expansion (`${VAR:offset:length}` — a different
  colon-form from the `:-`/`:=` default-value pair).
- **Not fixed, folded into the existing disclosed limitation:** process
  substitution feeding `read` (`read v < <(echo push)`) and a co-process
  (`coproc CP { echo push; }; read v <&"${CP[0]}"`) both require actually
  executing a real subprocess to know the produced value — the same
  already-disclosed "this hook does not execute or simulate arbitrary
  shell commands" gap as ordinary command substitution, just reached via a
  different syntax, not a genuinely new bug class. Re-confirmed nested
  indirection (`${!${!x}}`) is invalid bash syntax (real bash itself
  rejects it), so it is correctly out of scope rather than a missed case.

**2026-07-12 Round 15 (dispatched as the absolute final round per the
cap; the user then explicitly asked to stop the audit loop entirely and
publish, so this finding is disclosed rather than fixed).** One more
genuinely new indirection mechanism: bash's `declare -n` (nameref)
variables make one variable a live alias for another — `declare -n
ref=v; v=push; echo $ref` prints `push` — a different mechanism from the
`${!ref}` indirect *expansion* fixed in Round 13 (that resolves a name
held in a variable; a nameref makes the alias itself part of the
variable's declared type). Confirmed live: `declare -n ref=v; v=push; git
$ref origin main` returned `false` from `isPushCapable()`; the go-public
analogue (`v=public; declare -n ref=v; gh repo edit me/app
--visibility=$ref`) was `allow`ed with only the private-publish token
recorded. Disclosed, not fixed, per the capped-engagement decision above.

This closes the capped engagement per the user's own decision: the
codebase is published with everything found through Round 14 fixed, and
the seven items above (4 array-related limitations from Round 10, process
substitution and co-processes from Round 14, and `declare -n` namerefs
from Round 15) named explicitly as accepted, deliberately-unclosed
residual limitations — consistent with this document's standing position
that this mechanism
raises the bar against realistic accidents and common tricks, not a proof
against a determined, patient adversary who keeps searching for the next
alternate variable-assignment syntax.

## New capabilities added since this document was last updated (2026-07-17)

The three features below shipped across v3.1.0-v3.3.0 and were not yet
reflected here — a genuine staleness gap in this document, found by a
2026-07-17 docs-accuracy review, not a newly-discovered hole in any of
them. None weaken the push/go-public protections described above; all
three are separate capabilities with their own, already-designed
confirmation gates.

**Third-party plugin installation (`ecosystem-finder` skill).** When a
task genuinely needs an existing Claude Code skill/plugin GRU953-Studio
doesn't provide natively, `researcher` may recommend one and `builder`
may install it (`claude plugin marketplace add` / `claude plugin
install`) — but only after an explicit "install it" answer to a
`project-lead` pop-up naming the specific plugin. This installs
independent third-party code that GRU953-Studio's own hooks do not
govern or scan; the user is relying on Anthropic's own marketplace
vetting (for `claude-plugins-official`/`claude-plugins-community`
sources) or their own judgement (for any other source), not on anything
this project's security hooks check.

**External software installation (`ollama-integration` skill).** With
the same kind of explicit, per-instance confirmation, GRU953-Studio can
install Ollama itself (`curl -fsSL https://ollama.com/install.sh | sh`
on macOS/Linux, the equivalent `.ps1`/`.exe` on Windows) and download AI
model files ranging "from roughly 1GB to well over 100GB" — a real,
disclosed cost in disk space and bandwidth, never started without a
fresh yes for that specific install or pull. Six roles beyond
`ai-developer` now carry both `Bash` and `Skill` specifically to support
this and the second-opinion use case: `reviewer`,
`security-compliance-auditor`, `architect`, `builder`, `devops-engineer`,
and `publisher`.

**Fixer's bounded unsupervised attempts (`self-healing` skill).** When a
verification command fails during Build/Test, `fixer` now gets up to 2
attempts to diagnose and modify code on its own, before the Project
Lead's Stuck Protocol tells the user anything — a genuine, disclosable
increase in autonomy compared to every other code change in this
product, which is always shown to a human before or as it happens. The
bound is enforced by instruction-following, not by the hook itself. The hook
(`hooks/self-heal-nudge.mjs`, wired on the `PostToolUseFailure` event with the
same `Bash|PowerShell|Monitor` matcher as the publish-safety hooks) reliably
FIRES on every Build/Test shell failure inside a studio project and injects one
fixed reminder — making the hand-off to `fixer` structural rather than dependent
on the agent remembering. It is stateless: it does NOT itself count attempts,
write to `Dev-Memory/SESSION-LOG.md`, or escalate (2026-07-21 Round 6 accuracy
fix — this paragraph previously over-claimed those as hook-enforced). The
2-attempt ceiling, the per-attempt logging to `SESSION-LOG.md`, and the
third-failure escalation to the full, user-visible Stuck Protocol are specified
in the `self-healing` skill (`skills/self-healing/SKILL.md`) and carried out by
the `fixer`/`builder`/`tester`/`project-lead` roles — soft, instruction-level
enforcement, the same honest hook-vs-instruction distinction this document draws
for the memory-write secrets-scan gap above. This mechanism never touches
Publish or any push-capable action — confirmed directly with the user before it
was built, and unchanged by anything in this document above.

## Currency update (2026-07-21, through v4.2.0)

A brief note bringing this document current, so it does not silently go
stale — a gap this file has flagged against itself before. None of the
items below weaken the push/go-public protections above; each ships with
its own already-designed confirmation gate.

**Real content generation (`content-creation` skill, v3.4.0–v4.1.x).** After
an approved prototype, the studio can generate an app's own content. Text is
produced natively by Claude. Images, audio and video are opt-in only, via the
Gemini integration below. Every generated asset is recorded in the project's
`Dev-Memory/CONTENT.md` with its approval, provenance, rights and alt-text,
and `hooks/content-check.mjs` blocks Publish if that record is incomplete.

**Google Gemini media generation (`gemini-integration` skill, v4.1.x).** This
is the studio's first optional external cloud service. It is off unless the
user turns it on, and it uses the **user's own Google API key read from their
environment** — never written to a project file, never printed, never
committed. `scan.mjs` independently blocks Google `AIza…` keys and key-file
names from any push, so a key that ever slipped into a file could not ship.
Each generation is confirmed first, with a plain cost estimate and an explicit
"this content is sent to Google" notice; it degrades gracefully (a placeholder
plus a step-by-step guide) when no key or network is available.

**This release (v4.2.0)** is a documentation and packaging update only — a
rebuilt README, a new wiki guide, a slimmer landing website, the canonical
PolyForm Noncommercial licence text, self-hosted brand fonts, and tidied
community files. It changes **no** security-relevant behaviour, hook, gate, or
confirmation flow described anywhere above. (The gate changes described below
shipped separately, in **v4.3.0** — see the next section.)

## v4.3.0 hardening (2026-07-21 gold-standard audit) — new coverage and residuals

A multi-lens audit (each finding adversarially verified against the real code)
closed two previously-undisclosed gate weaknesses; both are now matched and
regression-tested. The residual limits they leave behind are disclosed here in
the same spirit as the shell-obfuscation list above. None of these weaken any
existing gate — each is additive.

- **`gh api` writes are now gated.** `isPushCapable()` and `isGoPublicCommand()`
  previously ignored `gh api` (the GitHub CLI's raw REST interface), so a write
  such as `gh api -X PATCH repos/me/app -f visibility=public` bypassed BOTH the
  publish and go-public gates. Now a `gh api` call with a write method
  (`-X`/`--method` POST|PATCH|PUT|DELETE) or a body flag
  (`-f`/`-F`/`--field`/`--raw-field`/`--input`) is push-capable, and a
  visibility-to-public one needs the GO-PUBLIC-APPROVED token; a read (`gh api
  user`) stays allowed. **Residual, not closed:** a visibility value living only
  inside an `--input` file, and a raw `curl` to `api.github.com`, are not parsed —
  the same "this hook does not read referenced files or run arbitrary commands"
  boundary as the command-substitution cases above. More broadly, `gh api`
  go-public detection matches GitHub's documented repo-creation endpoints
  (`/user/repos`, `orgs/<org>/repos`, `repos/<owner>/<tmpl>/generate`) and the
  `-f`/`-F`/`--field` private/visibility fields; like the shell-obfuscation matcher,
  it is a best-effort **bar-raiser against realistic accidents, not an exhaustive
  guarantee** against a novel or future `gh api` visibility mechanism. This is a
  backstop only — the studio's own publish flow never reaches for `gh api`; it uses
  `gh repo create --private` and `gh repo edit`, both fully covered.
- **ReDoS removed from the core matcher.** The git-push regex used two
  fully-overlapping alternatives that backtracked exponentially on a long,
  flag-heavy, non-push `git` command (measured ~22 s at 28 flags) — and it runs on
  every Bash/PowerShell/Monitor command. Replaced with a linear pattern that
  classifies identically; a timing regression test guards it.
- **The secret scan now also covers unpushed history.** `scan.mjs` scanned only
  the working tree, index and untracked files; a branch push ships commits, so a
  secret committed and then removed still shipped via a checkpoint/memory-persist
  branch push. It now also scans content added in unpushed commits (`HEAD --not
  --remotes`) — added coverage only. **Residual:** a value present only in a file
  referenced by a command (not in committed content) is still not read; and the
  history scan applies the same content + key-file/Dev-Memory-name checks as the
  working-tree scan (2026-07-21 Round 2 completion).
- **Bounded, adversarial-only matcher cost (disclosed, not closed).**
  `normalizeForPushCheck` (shared by both matchers, run on every command) resolves
  in-command variable assignments in a way that is superlinear in the *number of
  assignments in a single command* — negligible for real commands (<30 assignments,
  sub-millisecond) but reaching a fraction of a second at ~2,000 same-command
  assignments. Such input is machine-generated/adversarial, inside the
  determined-adversary threat model this document already disclaims. The Round 1
  ReDoS fix removed the separate input-*length* blow-up; this residual is the
  assignment-*count* case, disclosed here rather than closed.
- **A stray binary byte no longer hides a co-located ASCII secret (2026-07-21
  Round 11).** `scan.mjs` used to skip a file's *entire* content scan the instant
  it held any NUL byte, and the history scan ran `git log -p` without `--text` (so
  git rendered a NUL-containing blob as "Binary files differ") — together these
  let an ordinary would-ship **text** file that captured one stray binary byte
  beside a real ASCII secret (a log that recorded a byte of binary output next to
  a logged API key; a SQL/DB dump with a BLOB column beside a plaintext
  credential) ship unflagged on BOTH paths at once. Now a NUL-containing file
  that is predominantly text is scanned for its extractable ASCII — working tree:
  NUL→newline, preserving line numbers; history: `--text` plus a **per-file** text
  classification (Round 12 corrected this from a per-line guard, see below) — while
  a genuine binary asset (font, image, compiled blob) is still skipped. Valid UTF-8
  (Bangla included) counts as text, so a non-Latin dump is still scanned.
  **Residual, disclosed:** a file that is predominantly non-text is not
  content-scanned, and a NUL-interleaved encoding such as UTF-16LE (≈50% NUL)
  classifies as non-text and is not scanned — the same "high-signal scan of
  ordinary mistakes, not a determined-adversary guarantee" boundary this document
  states throughout.
- **A publish integrity gate no longer fails open on an unusual table shape
  (2026-07-21 Round 11).** `verify-progress.mjs` (the mechanical check that every
  "done" task carries `verified:` evidence) used to return *clean* whenever it
  could not name the Status column — a bolded `**Status**`, a synonym `State`, a
  composite `Task Status`, or a pipe-less GFM table all made it skip every row and
  pass. It now broadens Status detection (strips emphasis, accepts Status/State
  incl. a composite last word, and reads pipe-less tables) and, when a task table
  carries a `done` cell but no identifiable Status column, **fails closed** with a
  clear hint — matching its four sibling publish gates. This is a quality/integrity
  gate, not a secret/authorisation boundary (the publish-safety hooks still run);
  it is recorded here for completeness of the same audit.
- **`gh repo create --internal` now needs the go-public token (2026-07-21 Round
  12, HIGH).** The go-public matcher recognised `--public` and `--visibility
  public|internal` but not the standalone `--internal` flag — yet `gh repo create`
  has no `--visibility` flag, and an *internal* repository is visible to the whole
  organisation/enterprise, i.e. NOT private. A private-scope token (including a
  routine per-phase **checkpoint**) therefore authorised creating a non-private
  repo, contradicting the gate's own guarantee that a checkpoint can never make a
  repo public. Now `--internal` is treated as go-public exactly like `--public`;
  `--private` stays a private push (the studio's own publish flow uses `gh repo
  create --private`).
- **History secret scan restored to full parity with the working-tree scan
  (2026-07-21 Round 12).** The Round 11 history scan guarded each *diff line* with
  a text-fraction test; a real ASCII secret sharing one line with ~32+ bytes of
  binary dropped that line below the threshold and was skipped, even though the
  working-tree scan caught the identical content. The history scan now classifies
  and scans added content **per file** (mirroring the working-tree `bufIsTextish →
  scanText` decision), so a secret co-located with binary on one line is caught on
  both paths; a genuine binary file's added content is still skipped.
- **Large text files are now content-scanned, not silently skipped (2026-07-21
  Round 12).** A would-ship file over the 4 MB in-memory cap used to be skipped
  entirely before any text/binary check, so a plaintext secret in a large ordinary
  text file (a Terraform `.tfstate`, a SQL/DB dump, a verbose `.log`) shipped
  unflagged — and for a single compound `git add && commit && push` the history
  scan cannot backstop it (the commit does not exist yet at check time). Files over
  the cap are now **stream-scanned** line-by-line in bounded memory, after a
  head-sample classification that still skips a genuine large binary (video, model,
  image). **Residual, disclosed:** classification samples the file head, so a file
  whose first ~64 KB is binary but which contains text later is treated as binary —
  the same head-sample boundary the working-tree NUL/binary path already carries.
- **Decorated `done` values and mixed table styles no longer slip past the
  done-requires-verified gate (2026-07-21 Round 12).** `verify-progress.mjs` now
  de-emphasises the status *value* (`**done**`, `` `done` ``, `✅ done`), not only
  the header, and normalises GFM's optional outer pipes so a row written in a
  different pipe style from the header is not column-shifted; a row whose columns
  cannot be lined up fails closed. Quality/integrity gate, as above.
- **A force-added gitignored secret is no longer invisible to the scan (2026-07-21
  Round 13, HIGH).** The would-ship file set is built with `git ls-files --others
  --exclude-standard`, which omits gitignored files. A single compound `git add -f
  <ignored-secret> && git commit && git push` therefore slipped BOTH scans — at
  check time the file is untracked+ignored (in none of the three list calls) and no
  commit exists yet (empty history range). Now, when the command itself force-adds
  (`-f`/`--force`, run through the same obfuscation normaliser as the push matcher),
  the gitignored files that force-add would stage are enumerated and scanned too,
  **scoped to the force-add pathspecs** so an ordinary push — and a force-add of one
  file — never sweeps in unrelated ignored trees such as `node_modules`. The pathspec
  parser is quote-aware (Round 14), so a quoted filename containing spaces (`git add
  -f "prod copy.secret"`) is kept as one pathspec. **Residual, disclosed:** a
  force-add pathspec that survives only as a runtime shell expansion, or a
  backslash-escaped space that `normalizeForPushCheck` unescapes before the parser
  runs — the same command-parsing boundary the other disclosed shell cases carry.
- **The history scan now surfaces merge-commit content (2026-07-21 Round 13,
  HIGH).** `git log -p` emits no diff for a merge commit by default, so a secret
  unique to a merge resolution (present in neither parent — an "evil merge"), later
  removed, shipped in the merge commit's tree undetected. The invocation now uses
  `-m` (per-parent diffs, the ordinary single-`+` format the parser already
  handles), so merge-unique added content — secret, key-file name, or Dev-Memory
  path — is scanned like any other commit.
- **History secret scan brought to true head-sample parity (2026-07-21 Round 13).**
  The Round 12 per-file history classifier tested the *whole* added content while
  the working-tree path samples the first ~64 KB; the two disagreed for a
  text-headed but binary-tailed file (a DB dump), which the tree scan caught and the
  history scan skipped. The history classifier now head-samples too, so both paths
  make the identical text/binary decision.
- **The history scan walks every pushable local ref, not just HEAD (2026-07-21
  Round 14, HIGH).** It previously ran `git log … HEAD --not --remotes`, which only
  equals "what a push sends" when the pushed ref is the current checkout. `git push
  --all`, `git push --mirror`, and `git push origin <branch>` (while standing on a
  different branch) all ship commits on non-HEAD refs, which HEAD-only excluded (and
  the working-tree scan reflects only the checkout, so both paths missed them). The
  range is now `--branches --tags HEAD --not --remotes` — the finite superset of
  every pushable local ref not already on a remote (HEAD kept explicitly for a
  detached-HEAD push). A clean unpushed branch is still allowed; anything already on
  a remote is still excluded.
- **Commit messages and annotated-tag messages are now scanned (2026-07-21 Round
  15, HIGH).** A branch push ships whole commit objects — including their commit
  *message* — and `git push --tags`/`--follow-tags`/`--mirror` ships annotated-tag
  objects and their messages; none of that is a file diff, so the scanner (which
  only read diff hunks and file content) never saw it. A credential pasted into a
  commit message — one of the most common real-world leak vectors — shipped
  unflagged. Commit messages are now scanned over the same ref range as the diff
  scan; annotated-tag messages are scanned when the command actually ships tags
  (so an ordinary `git push origin main` is untouched). **Residual, disclosed:**
  pushing a single annotated tag by its bare name (ambiguous with a branch) is not
  detected as a tag push, so that one tag's message is not scanned.
- **`traceability-check.mjs` now reads a decorated "met" status (2026-07-21 Round
  15).** The Round 12 decorated-value fix (`**met**`, `` `met` ``, `✅ met`) was
  ported from `verify-progress.mjs`, so a requirement marked met with a decorated
  status is still held to the "a met requirement carries verification evidence"
  rule, and a decorated "deferred" no longer causes a spurious dropped-requirement
  block. Quality/integrity gate.
