# Packaging for Homebrew and winget

Extra ways to install the `gru953-studio` command, for people who expect software to
arrive the way everything else on their computer does. One worked; one turned out to
be impossible, and the record of why is kept here deliberately.

**Status as of 2026-08-11: Homebrew is LIVE. winget is NOT VIABLE and has been
abandoned — do not try again without reading why below.**

---

## Homebrew (macOS and Linux) — ours to publish

`formula/gru953-studio.rb` is a complete Homebrew formula. It installs the
published npm package and its Node dependency, and nothing else.

There are two ways to publish a formula, and only one of them is available:

| Route | Who decides | Status |
| :-- | :-- | :-- |
| **A tap** — [`GRU-953/homebrew-tap`](https://github.com/GRU-953/homebrew-tap) | Us, entirely | **Live since 2026-08-11.** |
| **Homebrew core** — the default catalogue | Homebrew's maintainers | Not attempted. Core requires a package to meet notability criteria that are theirs to judge, so it would be dishonest to describe it as pending. |

The tap is published, so there is nothing to set up. Anyone can install with:

```
brew install GRU-953/tap/gru953-studio
```

**Homebrew 6 may ask the user to trust the tap first** — it refuses to load a
formula from a third-party tap until told to. `brew trust GRU-953/tap` answers it.
Found by tapping from GitHub as a new user would, not by reading the docs, and
documented in the tap's own README.

`formula/gru953-studio.rb` here is a copy of what the tap publishes. It is kept in
step by hand, so when they disagree, **the tap is what users actually get**.

### Releasing a new version

The formula pins one exact published tarball, so two lines change per release:

1. Get the new checksum:
   `curl -sL https://registry.npmjs.org/@gru953/studio-cli/-/studio-cli-<version>.tgz | shasum -a 256`
2. Update `url` and `sha256` in `formula/gru953-studio.rb` here **and** in
   `Formula/gru953-studio.rb` in the tap repository.
3. Verify before pushing the tap — all three of these, which caught a real style
   error and confirmed the checksum on the first release:
   ```
   brew style GRU-953/tap/gru953-studio
   brew audit --strict --online GRU-953/tap/gru953-studio
   brew fetch GRU-953/tap/gru953-studio
   ```

There is no `version` line: Homebrew reads the version from the tarball's filename,
and stating it twice is one more place to go stale.

---

## winget (Windows) — NOT VIABLE, abandoned 2026-08-11

**Do not attempt this again without reading this section.** It cost five rounds of
changes to a pull request on someone else's repository before the real cause was
found, and the cause makes the whole approach impossible.

### The blocker, in one line

winget accepts exactly **one** file type for a portable package. From
`winget-cli`'s own source (`src/AppInstallerCommonCore/Manifest/ManifestValidation.cpp`):

```cpp
constexpr std::array<std::wstring_view, 1> s_AllowedPortableFiletypes = {
    L".exe",
};
```

GRU953-Studio's command is a Node.js script whose Windows launcher is a `.cmd`. No
manifest can make that valid. This is an architectural mismatch, not a manifest
defect, and no amount of manifest editing will fix it.

`winget validate` says so directly:

```
Manifest Error: The file type of the referenced file is not allowed.
[RelativeFilePath] Value: gru953-studio.cmd
```

### Why we are not shipping an .exe to get around it

Two routes exist, and both were rejected on the owner's decision:

| Route | Cost |
| :-- | :-- |
| Node's Single Executable Application (bundles the runtime) | ~110MB per architecture, so ~220MB added to every release, plus a `postject` build dependency |
| A small compiled C launcher | ~50KB, but an **unsigned** .exe — Windows SmartScreen warns on download, which is a poor first impression for a deliberately non-technical audience. Code signing has an annual cost |

For a tool that `npm install -g @gru953/studio-cli` installs in one line, neither is
a good trade. Windows users already have four working routes: npm, the one-line
PowerShell installer, the downloadable packages, and the Claude Code marketplace.

### The lesson, which is the useful part

The manifests were **schema-valid at every stage**. Five rounds of validating against
the official JSON schemas passed cleanly while the submission kept failing, because
the constraint that mattered lives in winget's C++ source, not in its schema or its
documentation. Four of those five rounds were spent re-reading the specification —
the thing that was already passing.

What actually worked, in order of usefulness:

1. **Running the real tool on the real platform.** `winget validate` on a Windows
   machine gave the exact answer in seconds.
2. **Comparing against something known to be accepted.** Diffing our manifest against
   `manifests/s/sharkdp/fd` found two real problems (nested field placement, and
   `Architecture: neutral`, which no accepted package uses) that the schema permitted.
3. Reading the specification. This found nothing, twice.

Applies well beyond winget: when a gate keeps failing and the spec keeps passing, the
rule being enforced is not the rule being read.

### The manifests are kept, deliberately

`winget/` still holds the three manifests, at the point they were abandoned. They are
kept rather than deleted so that anyone who revisits this can see exactly how far it
got and what was already correct — schema 1.12.0, the right folder shape and casing,
verified checksums, and the installer structure matching an accepted package. Only
the `.exe` requirement defeated it.

They are **not submitted and must not be submitted as they stand.** They also lack the
`# yaml-language-server: $schema=` header that `winget validate` warns about, which
would need adding first.

The pull request, with the full history including the errors, is
[microsoft/winget-pkgs#415492](https://github.com/microsoft/winget-pkgs/pull/415492).
