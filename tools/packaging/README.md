# Packaging for Homebrew and winget

Two extra ways to install the `gru953-studio` command, for people who expect
software to arrive the way everything else on their computer does.

**Status as of 2026-08-11: Homebrew is LIVE; winget is not.** The difference is
who decides. The Homebrew tap is entirely within this project's control and is now
published. winget depends on review by Microsoft and cannot be promised, so nothing
in the user-facing documentation claims it works.

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

## winget (Windows) — Microsoft's to accept

`winget/` holds the three manifest files winget requires. They are complete and
valid in shape, but submitting them is a pull request to
`microsoft/winget-pkgs`, which Microsoft's own reviewers accept or reject on
their own timetable.

So: **do not tell users `winget install` works until a submission has actually
been accepted.** Until then the one-line installer and npm are the routes that do
work, and those are what the README points at.

Two honest caveats about the manifests themselves:

1. **The `InstallerSha256` is a placeholder.** winget requires the checksum of
   the exact file it will download, so it can only be filled in once a specific
   release asset exists. `SHA256SUMS.txt` in each release carries the real value.
2. **winget prefers a real installer** (`.msi` or `.exe`) over a portable
   archive. This project ships neither, because building a signed Windows
   installer needs a code-signing certificate that costs money annually and is
   not justified for a command that npm already installs in one line. The
   manifests therefore describe a portable package, which winget does support but
   reviewers scrutinise more closely. That may be the reason a submission is
   declined, and if it is, that is a reasonable outcome rather than a bug to fix.
