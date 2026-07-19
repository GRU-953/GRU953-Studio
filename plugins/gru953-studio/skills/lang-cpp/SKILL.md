---
name: lang-cpp
description: The C++ ecosystem pack — the exact build, test, lint, format and dependency commands, plus the idioms, that the cpp-developer agent uses. Load when a task is implemented in C++. Covers CMake/CTest, clang-tidy, clang-format, and vcpkg/Conan dependency and licence norms (best-effort).
---

# C++ pack

The shared toolchain knowledge for C++ work, so the `cpp-developer` agent stays
thin. Plain-English rule is as set in the `studio` skill.

## The five standard commands (used as acceptance-proving commands)

| Purpose | Command |
| :-- | :-- |
| build | `cmake -S . -B build && cmake --build build` |
| test | `ctest --test-dir build --output-on-failure` |
| lint | `clang-tidy` over the translation units (via `compile_commands.json`) |
| format | `clang-format --dry-run --Werror <files>` (apply without `--dry-run`) |
| deps | vcpkg (`vcpkg install <pkg>`) or Conan (`conan install .`); wire into CMake |

## Idioms and gotchas

- Prefer RAII and smart pointers (`unique_ptr`/`shared_ptr`) over raw
  `new`/`delete`; a raw owning pointer is a leak or double-free waiting to
  happen — `reviewer` will flag it.
- Use modern C++ (C++17/20), `const`-correctness, and standard containers over
  hand-rolled memory.
- Treat compiler warnings as errors where feasible (`-Wall -Wextra -Werror`),
  and run with sanitizers (`-fsanitize=address,undefined`) in test builds to
  catch memory/UB bugs the compiler cannot.
- Tests use CTest with a framework (GoogleTest/Catch2); a failing test written
  first fits the `tdd-workflow` skill.

## Dependencies & licences

- Dependencies come via vcpkg (`vcpkg.json`) or Conan (`conanfile.txt/.py`), or
  are vendored.
- C++ has no single canonical manifest, so `hooks/licence-scan.mjs` treats C++
  dependency licences as **best-effort** and reports "not checked" for anything
  it cannot resolve — never a false pass. `security-compliance-auditor`
  supplements with a manual review of vendored/third-party licences before
  Publish.
- Every added dependency passes the `yagni-rules` ladder.
