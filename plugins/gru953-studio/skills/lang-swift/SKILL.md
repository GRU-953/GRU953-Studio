---
name: lang-swift
description: The Swift ecosystem pack — the exact build, test, lint, format and dependency commands, plus the idioms, that the swift-developer agent uses. Load when a task is implemented in Swift. Covers SwiftPM/xcodebuild, XCTest, SwiftLint, swift-format, and Swift Package Manager dependency/licence norms for iOS and macOS.
---

# Swift pack

The shared toolchain knowledge for Swift work (iOS/macOS), so the
`swift-developer` agent stays thin. Plain-English rule is as set in the `studio`
skill.

## The five standard commands (used as acceptance-proving commands)

| Purpose | Command |
| :-- | :-- |
| build | `swift build` (app targets: `xcodebuild -scheme <s> build`) |
| test | `swift test` (or `xcodebuild test -scheme <s> -destination …`) |
| lint | `swiftlint` (treat violations as failures in CI) |
| format | `swift-format lint --strict` (apply with `swift-format format -i`) |
| deps | Swift Package Manager — declare in `Package.swift`; resolve with `swift package resolve` |

## Idioms and gotchas

- Prefer value types (`struct`/`enum`) and optionals over force-unwrap (`!`);
  each `!` is a potential crash `reviewer` will flag.
- Use `guard`/`if let` for safe unwrapping; handle errors with `do/try/catch`,
  not `try!`.
- Respect memory: avoid retain cycles (`[weak self]` in closures).
- Tests use XCTest; a failing test written first fits the `tdd-workflow` skill.

## Dependencies & licences

- Dependencies live in `Package.swift`; the lockfile is `Package.resolved`.
- `hooks/licence-scan.mjs` detects SwiftPM (`Package.resolved`) and reports it
  best-effort (no single canonical licence field), so `security-compliance-auditor`
  reviews before Publish; CocoaPods/Carthage projects are reviewed manually.
- Every added package passes the `yagni-rules` ladder.
