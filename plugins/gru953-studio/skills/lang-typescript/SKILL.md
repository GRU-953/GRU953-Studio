---
name: lang-typescript
description: The TypeScript ecosystem pack — the exact build, test, lint, format and dependency commands, plus the idioms, that the typescript-developer agent uses. Load when a task is implemented in TypeScript. Covers tsc, jest/vitest, eslint, prettier, and npm dependency/licence norms for web and cross-platform (React Native/Electron/Node) work.
---

# TypeScript pack

The shared toolchain knowledge for TypeScript work (web, Node, React Native,
Electron), so the `typescript-developer` agent stays thin. Plain-English rule is
as set in the `studio` skill.

## The five standard commands (used as acceptance-proving commands)

| Purpose | Command |
| :-- | :-- |
| build | `tsc --noEmit` (type-check) and/or the project's `npm run build` |
| test | `npm test` (jest or vitest) |
| lint | `eslint .` (treat warnings as errors in CI) |
| format | `prettier --check .` (apply with `prettier --write .`) |
| deps | npm — `npm install <pkg>`; recorded in `package.json`, locked in `package-lock.json` |

## Idioms and gotchas

- Enable `strict` mode; avoid `any` — prefer precise types, `unknown` at
  boundaries, and discriminated unions. Each `any`/`as` is a hole `reviewer`
  will question.
- Handle promise rejections; never leave a floating promise unawaited.
- Keep runtime dependencies minimal (`yagni-rules`); a browser bundle's size is a
  real cost.
- Tests use jest or vitest; a failing test written first fits the `tdd-workflow`
  skill.

## Dependencies & licences

- Dependencies are declared in `package.json` and locked in `package-lock.json`.
- `hooks/licence-scan.mjs` already scans npm (`node_modules/*/package.json`) with
  a real SPDX field, so TypeScript dependency licences are covered by the
  existing npm scan — no new ecosystem needed. `security-compliance-auditor` runs
  it before Publish.
- Every added package passes the `yagni-rules` ladder.
