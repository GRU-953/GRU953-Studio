# GRU953-Studio bridge for Google Antigravity

Sets up a project's `.agents/` folder (linking in the `studio` skill) and a
`Dev-Memory/` folder, so Google Antigravity can use the studio protocol —
the sibling of `clients/cli` for other AI hosts.

## Usage

Run it from the root of the project you want to set up:

```
gru953-studio-antigravity
```

(the `bin` name declared in this package's `package.json`, available once
this package is installed or linked — see below.)

This currently only works run from inside a full GRU953-Studio checkout
(e.g. cloned for development): it copies the `studio` skill from this
repo's own `plugins/gru953-studio/skills/`, and there is no published,
standalone npm package to install instead yet (the same documented
limitation as `clients/cli`; see `.agents/AGENTS.md` or `clients/vscode/README.md`,
which document it too). Two ways to
run it from a checkout:

```
# after `npm link` inside clients/antigravity/, from any project directory:
gru953-studio-antigravity

# or directly, no linking needed:
node <path-to-repo>/clients/antigravity/src/index.js
```

## Licence

See [LICENSE](LICENSE) — PolyForm Noncommercial License 1.0.0, the same
licence as the rest of GRU953-Studio.
