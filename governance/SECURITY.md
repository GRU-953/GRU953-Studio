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
parenthesised/anchored matcher (`"^(Bash|PowerShell)$"`), and — the more
severe direction — falsely PASSED a comma-separated matcher
(`"Bash,PowerShell"`) that would never actually match at runtime, since
only `|` is a real OR-separator in Claude Code's matcher syntax. Fixed by
parsing alternatives properly (split on `|` only, strip wrapping
parens/anchors, compare exactly) rather than a positional-character regex.

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
