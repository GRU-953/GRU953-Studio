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

`winget/` holds the three manifest files winget requires. Their SHAPE is now
correct and schema-valid, but **two values must be set at release time before they
can be submitted** — see the header comment in `GRU953.Studio.installer.yaml`.

### The mistake that was caught first, recorded so it is not repeated

The original manifests declared a `gru953-studio` command and pointed at
`gru953-studio-claude-code-<version>.zip`. That archive contains 128 markdown
files and no executable of any kind — it is the plugin, not the command. winget
would have rejected it, and submitting it would have wasted Microsoft's reviewers'
time on something that could never work. Found by downloading the published
archive and looking inside it, rather than by reading the build script.

The fix needed a new release asset:
`gru953-studio-windows-portable-<version>.zip`, containing a `.cmd` shim plus the
CLI, with Node.js declared as a winget package dependency rather than bundled.
`tools/build-release-assets.mjs` builds it, and both CI and `hooks.test.mjs` now
assert it contains something runnable and no markdown — the exact distinction that
was got wrong.

### Why this is still not submitted

This repository publishes **immutable** releases, so an asset cannot be added to
`v6.0.0` after the fact — GitHub returns `HTTP 422: Cannot upload assets to an
immutable release`. winget needs a stable URL to an archive containing the command,
so the Windows portable package has to ship with a release, and the manifests can
only be completed once it has.

**The order is therefore:** cut the next release (which builds and attaches the
Windows package automatically) → fill in `PackageVersion`, the version in
`InstallerUrl`, and `InstallerSha256` → then submit.

Submitting means a pull request to `microsoft/winget-pkgs`, which Microsoft's own
reviewers accept or reject on their own timetable.

So: **do not tell users `winget install` works until a submission has actually
been accepted.** Until then the one-line installer and npm are the routes that do
work, and those are what the README points at.

Two honest caveats about the manifests themselves:

1. **`InstallerSha256`, `PackageVersion` and the `InstallerUrl` version are
   placeholders**, for the reason above. `SHA256SUMS.txt` in each release carries
   the real checksum, or compute it directly:
   `shasum -a 256 dist/gru953-studio-windows-portable-<version>.zip`
2. **winget prefers a real installer** (`.msi` or `.exe`) over a portable
   archive. This project ships neither, because building a signed Windows
   installer needs a code-signing certificate that costs money annually and is
   not justified for a command that npm already installs in one line. The
   manifests therefore describe a portable package, which winget does support but
   reviewers scrutinise more closely. That may be the reason a submission is
   declined, and if it is, that is a reasonable outcome rather than a bug to fix.
3. **`GRU953` is not yet a publisher in winget-pkgs** (checked: `manifests/g/GRU953`
   returns 404), so a submission also creates that folder, which reviewers look at
   more carefully than an update to an existing package.
