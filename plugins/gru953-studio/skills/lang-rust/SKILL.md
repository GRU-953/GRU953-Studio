---
name: lang-rust
description: The Rust ecosystem pack — the exact build, test, lint, format and dependency commands, plus the idioms, that the rust-developer agent uses. Load when a task is implemented in Rust. Covers Cargo, clippy, rustfmt, Cargo dependency/licence norms, and the Tauri desktop-app framework (Rust core, web front end).
---

# Rust pack

The shared toolchain knowledge for Rust work, so the `rust-developer` agent
stays thin. Plain-English rule is as set in the `studio` skill. Covers
plain Rust binaries/libraries and the Tauri desktop-app framework's native
shell (2026-07-26 audit finding 27) — Tauri is a stack choice within the Rust
ecosystem, not a separate role, the same way `typescript-developer`'s own
pack already covers React Native within the TypeScript ecosystem.

## The six standard commands (used as acceptance-proving commands)

| Purpose | Command |
| :-- | :-- |
| build | `cargo build` (release: `cargo build --release`) |
| test | `cargo test` |
| lint | `cargo clippy --all-targets -- -D warnings` (warnings fail, deliberately) |
| format | `cargo fmt --check` (apply with `cargo fmt`) |
| deps | edit `Cargo.toml` / `cargo add <crate>`; fetch with `cargo build` or `cargo fetch` |
| package (2026-07-26 audit finding 15) | plain binary: ship the `cargo build --release` output directly; Tauri desktop app: `cargo tauri build` produces a real installer per OS — `.dmg` (macOS), `.msi` (Windows), `.deb`/AppImage (Linux) |

## Idioms and gotchas

- Prefer the ownership/borrow model over reference-counting; reach for `Rc`/
  `Arc`/`RefCell` only when a real shared-ownership need is shown, not by habit.
- Handle errors with `Result` and `?`; avoid `unwrap()`/`expect()` outside tests
  and truly-impossible cases (each one is a potential panic — a data-loss/crash
  risk `reviewer` will flag).
- Keep `unsafe` out unless a concrete need is documented next to it.
- Tests live in `#[cfg(test)]` modules or `tests/`; a failing test written first
  fits the `tdd-workflow` skill directly.

## Dependencies & licences

- Dependencies are crates in `Cargo.toml`; the lockfile is `Cargo.lock`.
- `hooks/licence-scan.mjs` reads `Cargo.toml`/`Cargo.lock` for the dependency
  set; `security-compliance-auditor` runs it before Publish. For a deeper audit
  `cargo deny check` (if available) covers licences and advisories — best-effort,
  never assumed installed.
- Every added crate still passes the `yagni-rules` ladder — a crate is a
  dependency to justify, not a default.

## Interface Contract (for `repo-integrity.mjs` INV11)

```yaml
commands:
  build: "cargo build --release"
  test: "cargo test"
  lint: "cargo clippy --all-targets -- -D warnings"
  format: "cargo fmt --check"
  deps: "cargo add"
  dev_env: "mise install rust@latest"
```
