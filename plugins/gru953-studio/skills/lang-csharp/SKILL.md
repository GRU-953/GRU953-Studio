---
name: lang-csharp
description: The C# / .NET ecosystem pack — the exact build, test, lint, format and dependency commands, plus the idioms, that the csharp-developer agent uses. Load when a task is implemented in C#. Covers the dotnet CLI, xUnit/NUnit, analyzers, dotnet format, and NuGet dependency/licence norms for Windows and cross-platform .NET.
---

# C# / .NET pack

The shared toolchain knowledge for C#/.NET work (Windows and cross-platform), so
the `csharp-developer` agent stays thin. Plain-English rule is as set in the
`studio` skill.

## The five standard commands (used as acceptance-proving commands)

| Purpose | Command |
| :-- | :-- |
| build | `dotnet build -c Release` |
| test | `dotnet test` |
| lint | `dotnet build` with analyzers as errors (`-warnaserror`), or `dotnet format --verify-no-changes` for style |
| format | `dotnet format` (check with `dotnet format --verify-no-changes`) |
| deps | NuGet — `dotnet add package <pkg>`; restore with `dotnet restore` (recorded in the `.csproj`) |

## Idioms and gotchas

- Prefer immutability (`readonly`, records) and nullable reference types enabled;
  avoid returning `null` where an empty collection or `Option`-style result is
  clearer.
- Use `using`/`await using` for `IDisposable`/`IAsyncDisposable`; never swallow
  exceptions silently.
- Favour `async`/`await` end-to-end; avoid blocking on tasks (`.Result`/`.Wait()`).
- Tests use xUnit or NUnit; a failing test written first fits the `tdd-workflow`
  skill.

## Dependencies & licences

- Dependencies are declared in the `.csproj` (PackageReference) and locked in
  `packages.lock.json` when enabled.
- `hooks/licence-scan.mjs` detects .NET projects (`*.csproj`/`packages.lock.json`)
  best-effort; `security-compliance-auditor` reviews NuGet licences before
  Publish (`dotnet list package` gives the resolved set).
- Every added package passes the `yagni-rules` ladder.
