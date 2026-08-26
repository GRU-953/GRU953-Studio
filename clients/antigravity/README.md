# GRU953-Studio bridge for Google Antigravity

Installs GRU953-Studio as a Google Antigravity **plugin**: a `plugin.json`
marker, all of the studio's skills, and two generated rules files — the
specialist roster and the operating charter. The sibling of `clients/cli` for
other AI hosts.

By default it installs for your whole account, at
`~/.gemini/config/plugins/gru953-studio`. Pass `--workspace` to install into one
project instead, at `<project>/.agents/plugins/gru953-studio`.

It does **not** create a `Dev-Memory/` folder. The studio creates that itself
when a project actually needs one.

> **Corrected 2026-08-22 (finding X252).** This paragraph used to say the command
> "sets up a project's `.agents/` folder (linking in the `studio` skill) and a
> `Dev-Memory/` folder". All three of those were removed by the rewrite of
> 2026-08-10, which the code itself records in its own header comments — it wrote
> to `.agents/skills/`, linked exactly ONE skill, and created `Dev-Memory/`
> eagerly. The description was never updated, so this page described a version
> that no longer exists.

## Usage

Run it from the root of the project you want to set up:

```
gru953-studio-antigravity
```

(the `bin` name declared in this package's `package.json`, available once
this package is installed or linked — see below.)

**This currently only works when run from inside a full GRU953-Studio checkout**
(for example one cloned for development): it copies the studio's skills from this
repository's own `plugins/gru953-studio/`, resolved relative to this package's
own location.

> **A known limitation, stated plainly (finding X252, 2026-08-22).** This package
> IS published to npm — `.github/workflows/publish.yml` publishes it — but its
> `files` list ships only `src/` and `LICENSE`, with no bundled copy of the
> studio and no `prepack` step to make one. So an installed copy has nothing to
> copy from and stops with "Could not find GRU953-Studio's skills at …". It fails
> clearly rather than half-installing, but it does not work. Its sibling
> `clients/cli` solves this by bundling the plugin at pack time; doing the same
> here changes what the published tarball contains, so it is the owner's call and
> is recorded as an open finding rather than changed quietly. Until then, install
> from a checkout.

Two ways to run it from a checkout:

```
# after `npm link` inside clients/antigravity/, from any project directory:
gru953-studio-antigravity

# or directly, no linking needed:
node <path-to-repo>/clients/antigravity/src/index.js
```

## Licence

See [LICENSE](LICENSE) — Apache License 2.0, the same
licence as the rest of GRU953-Studio.
