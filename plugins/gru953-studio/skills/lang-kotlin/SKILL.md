---
name: lang-kotlin
description: The Kotlin ecosystem pack — the exact build, test, lint, format and dependency commands, plus the idioms, that the kotlin-developer agent uses. Load when a task is implemented in Kotlin. Covers Gradle, ktlint/detekt, and Gradle/Maven dependency and licence norms.
---

# Kotlin pack

The shared toolchain knowledge for Kotlin work (JVM and Android), so the
`kotlin-developer` agent stays thin. Plain-English rule is as set in the
`studio` skill.

## The five standard commands (used as acceptance-proving commands)

| Purpose | Command |
| :-- | :-- |
| build | `./gradlew build` (Android: `./gradlew assembleDebug`) |
| test | `./gradlew test` (Android instrumented: `./gradlew connectedAndroidTest`) |
| lint | `./gradlew ktlintCheck` or `./gradlew detekt` (also `./gradlew lint` on Android) |
| format | `./gradlew ktlintFormat` (check-only in CI with `ktlintCheck`) |
| deps | declare in `build.gradle(.kts)`; resolve with `./gradlew build`/`dependencies` |

## Idioms and gotchas

- Prefer immutable `val` and null-safety; avoid `!!` except where non-null is
  genuinely proven.
- Use data classes and sealed hierarchies for modelling; keep coroutines
  structured (scoped, cancellable) — a leaked coroutine scope is a real bug.
- Wrap the Gradle wrapper (`./gradlew`) rather than a system Gradle so builds are
  reproducible.
- Tests use JUnit/kotlin.test; a failing test written first fits the
  `tdd-workflow` skill.

## Dependencies & licences

- Dependencies are declared in `build.gradle(.kts)` (or `pom.xml` on Maven).
- `hooks/licence-scan.mjs` reads the Gradle/Maven manifests for the dependency
  set; `security-compliance-auditor` runs it before Publish. `./gradlew
  dependencies` gives the full resolved tree for a deeper check.
- Every added dependency passes the `yagni-rules` ladder.
