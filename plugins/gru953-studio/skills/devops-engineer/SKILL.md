---
name: devops-engineer
description: The protocol for the devops-engineer agent — owns the built app's build, packaging, deployment, and live-running reliability. Covers CI/CD config, containerisation, environment/config management, reproducible deploys, health checks, structured logging, and failure posture. Use when the app needs hosting, a pipeline, a reproducible build/deploy, or runs as a live service.
---

# DevOps Engineer Skill

## Mission

Make the finished app reproducibly buildable, deployable, AND observable by its owner — one documented command to build, one to run, one to deploy, and a clear way to tell whether it is healthy.

## When to apply

- **Standard/Complex Tier** projects that need hosting, packaging, or continuous build
- Any project with a deploy pipeline, container, or live service
- Projects requiring health checks, structured logging, or failure posture

## Method

### 1. Apply YAGNI to Infrastructure

Start with the simplest deploy that works:
- Static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages) for static sites
- Single container (Docker + cloud run) for web services
- One-line deploy script for simple apps

Never build a pipeline the project doesn't need today.

### 2. Reproducible Build

- Document the exact build command in `DEPLOY.md` (or README)
- Use lockfiles (package-lock.json, Cargo.lock, go.sum, pom.xml, etc.)
- Where helpful, provide a minimal Dockerfile or build container so same inputs produce same output

### 3. Externalise Configuration

- No environment-specific values or secrets baked into code
- Use environment variables or a config file the owner edits
- Secret concerns → `security-compliance-auditor`

### 4. Reliability for Live Services

**For apps that run as live, long-lived services (web backend, scheduled job, always-on tool):**

- **Health signal**: Health-check endpoint (`/healthz`), or clear exit code + log for jobs
- **Structured logging**: Readable logs at key points (start/stop, errors, slow paths) — never noisy debug spew, never logged secrets
- **Failure posture**: Define in plain terms what happens when a dependency is down — fail loudly, retry, or degrade gracefully. Chosen, not accidental.
- **Self-recovery** (where appropriate, per `self-healing` skill part b):
  - Auto-restart on crash (via hosting platform, not custom supervisor)
  - Bounded retry-with-backoff for transient failures
  - Every auto-recovery event logged, never silent

### 5. Owner Documentation

Provide a plain-English "how to deploy and check on this yourself" note for the owner — in `technical-writer`'s docs where one exists.

### 6. Decision Recording

Record deploy and reliability decisions, and any deliberate omissions, in `Dev-Memory/decisions/`.

## Required Command Families (for `repo-integrity.mjs` INV11)

This skill declares the following command families that any CI/CD setup must cover:

| Family | Example Commands |
|--------|------------------|
| **build** | `npm run build`, `cargo build --release`, `go build`, `./gradlew build`, `dotnet build`, `mvn package` |
| **test** | `npm test`, `cargo test`, `go test ./...`, `./gradlew test`, `dotnet test`, `mvn test` |
| **lint** | `npm run lint`, `cargo clippy`, `golangci-lint run`, `./gradlew check`, `dotnet format --verify`, `mvn checkstyle:check` |
| **format** | `npm run format`, `cargo fmt`, `go fmt ./...`, `./gradlew spotlessApply`, `dotnet format`, `mvn spotless:apply` |
| **deps** | `npm audit`, `cargo deny check`, `govulncheck`, `./gradlew dependencyCheckAnalyze`, `dotnet list package --vulnerable`, `mvn dependency:analyze` |

## Output

- Build/deploy config (CI file, container, or script as appropriate)
- Health/logging/failure-handling code for live services
- Exact commands run to prove the build works (with log/health evidence)
- One-line plain-English note: how the owner runs, deploys, and checks health