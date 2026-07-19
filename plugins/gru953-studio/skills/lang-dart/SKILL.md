---
name: lang-dart
description: The Dart & Flutter ecosystem pack — the exact build, test, analyse, format and dependency commands, plus the idioms, that the flutter-dart-developer agent uses. Load when a task is implemented in Dart or Flutter. Covers pub, flutter/dart analyze, dart format, and pubspec dependency/licence norms.
---

# Dart & Flutter pack

The shared toolchain knowledge for Dart/Flutter work, so the
`flutter-dart-developer` agent stays thin. Plain-English rule is as set in the
`studio` skill. This is the studio's default mobile stack (see `architect`).

## The five standard commands (used as acceptance-proving commands)

| Purpose | Command |
| :-- | :-- |
| build | Flutter: `flutter build <target>`; plain Dart: `dart compile exe bin/main.dart` |
| test | Flutter: `flutter test`; plain Dart: `dart test` |
| lint (analyse) | `flutter analyze` (or `dart analyze`) — treat issues as failures |
| format | `dart format --set-exit-if-changed .` (apply with `dart format .`) |
| deps | edit `pubspec.yaml` / `dart pub add <pkg>`; fetch with `flutter pub get` (or `dart pub get`) |

## Idioms and gotchas

- Prefer null-safety throughout; avoid the `!` bang operator except where a
  value is genuinely proven non-null.
- Keep widget `build` methods cheap and side-effect-free; lift state out of the
  widget tree deliberately rather than rebuilding the world.
- Dispose controllers/streams; an undisposed listener is a real leak `reviewer`
  will flag.
- Tests use `flutter_test`/`test`; a failing widget or unit test written first
  fits the `tdd-workflow` skill.

## Dependencies & licences

- Dependencies live in `pubspec.yaml`; the lockfile is `pubspec.lock`.
- `hooks/licence-scan.mjs` already reads `dart pub deps --json` and matches
  LICENSE text; `security-compliance-auditor` runs it before Publish.
- Every added package still passes the `yagni-rules` ladder.
