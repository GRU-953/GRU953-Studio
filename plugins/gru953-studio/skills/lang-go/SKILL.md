---
name: lang-go
description: The Go ecosystem pack — the exact build, test, lint, format and dependency commands, plus the idioms, that the go-developer agent uses. Load when a task is implemented in Go. Covers the go toolchain, go test, go vet/staticcheck, gofmt, and Go modules dependency/licence norms for services, CLIs and Linux.
---

# Go pack

The shared toolchain knowledge for Go work (services, CLIs, Linux), so the
`go-developer` agent stays thin. Plain-English rule is as set in the `studio`
skill.

## The five standard commands (used as acceptance-proving commands)

| Purpose | Command |
| :-- | :-- |
| build | `go build ./...` |
| test | `go test ./...` (race detector: `go test -race ./...`) |
| lint | `go vet ./...` (and `staticcheck ./...` when available) |
| format | `gofmt -l .` (non-empty output = unformatted; apply with `gofmt -w .`) |
| deps | Go modules — `go get <pkg>`; recorded in `go.mod`/`go.sum`, tidied with `go mod tidy` |

## Idioms and gotchas

- Handle every returned `error` explicitly; never discard it with `_` unless
  genuinely irrelevant (and say why). Wrap with `fmt.Errorf("...: %w", err)`.
- Keep interfaces small and defined at the consumer; prefer composition.
- Use `defer` for cleanup; guard against goroutine leaks (contexts, cancellation).
- Tests use the standard `testing` package; a failing test written first fits the
  `tdd-workflow` skill.

## Dependencies & licences

- Dependencies are declared in `go.mod` and locked in `go.sum`.
- `hooks/licence-scan.mjs` detects Go modules (`go.mod`) best-effort (module
  licences aren't a single machine-readable field); `security-compliance-auditor`
  reviews before Publish (`go list -m all` gives the module set; `go-licenses`
  when available).
- Every added module passes the `yagni-rules` ladder — the standard library
  first, as Go itself encourages.
