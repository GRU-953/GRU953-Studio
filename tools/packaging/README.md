# Packaging for Homebrew and winget

Two extra ways to install the `gru953-studio` command, for people who expect
software to arrive the way everything else on their computer does.

**Read this first: neither of these is live yet, and the difference between them
matters.** One is entirely within this project's control and works as soon as the
repository below is created. The other depends on review by Microsoft and cannot
be promised. Nothing in the user-facing documentation claims either works until
it does.

---

## Homebrew (macOS and Linux) — ours to publish

`formula/gru953-studio.rb` is a complete Homebrew formula. It installs the
published npm package and its Node dependency, and nothing else.

There are two ways to publish a formula, and only one of them is available:

| Route | Who decides | Status |
| :-- | :-- | :-- |
| **A tap** — a repository named `GRU-953/homebrew-tap` | Us, entirely | Ready to publish. Nothing external to wait for. |
| **Homebrew core** — the default catalogue | Homebrew's maintainers | Not attempted. Core requires a package to meet notability criteria that are theirs to judge, so it would be dishonest to describe it as pending. |

To publish the tap (a one-off, about five minutes):

1. Open <https://github.com/new> in your web browser.
2. In "Repository name", type exactly: `homebrew-tap`
3. Make sure the owner is **GRU-953**.
4. Choose **Public**. A tap has to be public for Homebrew to read it.
5. Click **Create repository**.
6. Copy `formula/gru953-studio.rb` from this folder into a folder called
   `Formula` in that new repository, and commit it.

From then on, anyone can install with:

```
brew install GRU-953/tap/gru953-studio
```

Updating it later means editing the `version` line in the formula whenever a new
version is published to npm.

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
