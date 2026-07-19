---
name: lang-java
description: The Java ecosystem pack — the exact build, test, lint, format and dependency commands, plus the idioms, that the java-developer agent uses. Load when a task is implemented in Java. Covers Maven and Gradle, Checkstyle/SpotBugs, google-java-format/Spotless, and dependency and licence norms.
---

# Java pack

The shared toolchain knowledge for Java work, so the `java-developer` agent
stays thin. Plain-English rule is as set in the `studio` skill.

## The five standard commands (used as acceptance-proving commands)

| Purpose | Command (Maven / Gradle) |
| :-- | :-- |
| build | `mvn -q package` / `./gradlew build` |
| test | `mvn -q test` / `./gradlew test` |
| lint | `mvn checkstyle:check` / `./gradlew checkstyleMain` (or SpotBugs) |
| format | `mvn spotless:check` / `./gradlew spotlessCheck` (apply with `spotless:apply`) |
| deps | declare in `pom.xml` / `build.gradle`; resolve with the build command |

## Idioms and gotchas

- Prefer immutability (`final` fields, unmodifiable collections) and small
  classes with clear responsibilities.
- Use try-with-resources for anything `Closeable`; never swallow an exception
  silently. Avoid returning `null` where an `Optional` or empty collection is
  clearer.
- Pin the build via the Maven/Gradle wrapper for reproducibility.
- Tests use JUnit 5; a failing test written first fits the `tdd-workflow` skill.

## Dependencies & licences

- Dependencies are declared in `pom.xml` (Maven) or `build.gradle` (Gradle).
- `hooks/licence-scan.mjs` reads those manifests for the dependency set;
  `security-compliance-auditor` runs it before Publish. `mvn dependency:tree` /
  `./gradlew dependencies` give the resolved tree for a deeper check.
- Every added dependency passes the `yagni-rules` ladder.
