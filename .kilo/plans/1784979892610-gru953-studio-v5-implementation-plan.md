# GRU953-Studio v5.0 Implementation Plan

**Status**: CONVERGED - All 12 expert teams verified  
**Generated**: 2026-07-25  
**Review Rounds**: 3 (Independent → Synthesis → Convergence)  
**Zero Blocking Concerns Remaining**

---

## Executive Summary

This plan transforms GRU953-Studio from a mature v4.3 plugin into a **production-grade, multi-platform, AI-native development platform** with enterprise governance, free-tier defaults, and non-technical user accessibility.

**Core Philosophy**: Progressive enhancement - every feature works at baseline (markdown memory, 3 providers, 2 platforms) and enhances opt-in (semantic memory, 10 providers, 7 platforms) without breaking changes.

---

## Phase 1: Security + Onboarding + Foundations (Weeks 1-4)

### P0 - Must Ship Before Any Feature Work

| # | Task | Owner | Validation Gate |
|---|------|-------|-----------------|
| 1.1 | **Tiny AI Guardrail** - `responsible-ai-reviewer` activates for ALL tiers on AI features | T1/T5 | `studio` skill routes AI tasks to reviewer regardless of Tier |
| 1.2 | **Multi-Pass Secret Scan** - Decode (base64, gzip, UTF-16/32) → Normalize → Scan | T1 | Red team test: 100% detection on encoded secrets |
| 1.3 | **Lockfile License Scan** - All 10 ecosystems parse lockfiles, fail closed on copyleft | T1 | Injection test: GPL dep in each ecosystem → BLOCKED |
| 1.4 | **Guided Tier Interview** - Plain English + examples + "Explain" links per question | T11/T2 | 5/5 non-tech users complete without confusion |
| 1.5 | **Interactive Onboarding** - Welcome → First-Run → Demo Project → Publish → Dashboard | T6/T11 | Time-to-first-publish < 30 min for new user |
| 1.6 | **INTERFACE.md Contracts** - All 10 `lang-*` skills declare: build/test/lint/format/deps commands | T3 | `repo-integrity.mjs` validates all 10 present |
| 1.7 | **Git-Backed Memory** - `memory-keeper` writes via signed commit to `memory/session-*` branch | T7 | Every memory write = signed commit in git log |
| 1.8 | **Structured Evidence JSON** - Replace `verified:` free text with `{taskId, criterion, command, exitCode, stdout, stderr, duration, artifacts[]}` | T4 | CI dashboard parses and displays |

### Phase 1 Go/No-Go Criteria
- [ ] All 8 P0 tasks validation gates pass
- [ ] Zero critical security findings in audit
- [ ] 3+ new users complete onboarding unassisted

---

## Phase 2A: Platforms + Quality Gates + AI Routing (Weeks 5-8)

### Core Deliverables

| # | Task | Owner | Validation Gate |
|---|------|-------|-----------------|
| 2A.1 | **Tauri v2 + React Native/Expo Templates** - Free-tier deploy to device + store | T2/T3 | Clean build + TestFlight/Play Console internal |
| 2A.2 | **Tiered Parallel Gates** - Tiny(3)/Standard(6)/Complex(9) all parallel, skip unchanged via git diff | T1/T4/T12 | Standard publish < 10 min (was 25+) |
| 2A.3 | **Capability Registry + 3-Tier Providers** - Default(Anthropic+Ollama) / Opt-In(OpenRouter+Groq) / Enterprise(Bedrock/Vertex/Azure) | T5 | Cost/task < $0.05; circuit breakers fire on simulated outage |
| 2A.4 | **Adaptive Build Swarm** - 1-4 builders based on task graph parallelism + ROI model | T2/T12 | Build time ↓ 30% vs fixed 2; compute cost tracked |
| 2A.5 | **Free-Tier Architect Defaults** - 6 stacks (Astro/Pages, Next.js/Vercel/Supabase, Hono/Workers/Turso, Expo/EAS, Go/Releases, Next.js/Ollama) | T8 | Each deploys free end-to-end |

### Phase 2A Go/No-Go Criteria
- [ ] 2 new platforms template-to-deploy verified
- [ ] Gate latency meets targets
- [ ] AI routing cost target met
- [ ] Build Swarm adapts correctly (benchmarked)

---

## Phase 2B: Serverless + Language Baselines + Memory Opt-In (Weeks 9-12)

| # | Task | Owner | Validation Gate |
|---|------|-------|-----------------|
| 2B.1 | **Serverless/Edge Platforms** - Vercel, Cloudflare Workers, Deno Deploy templates | T2/T3 | Each deploys free tier |
| 2B.2 | **BASELINE.md per Language** - Idiomatic config: `ruff.toml`, `cargo-deny.toml`, `golangci.yml`, `detekt.yml`, `clang-tidy.yaml`, `swiftlint.yml`, `Directory.Packages.props`, `melos.yaml`, `biome.json` | T3 | `lang-*` skill loads baseline; CI passes |
| 2B.3 | **Local Embeddings Opt-In** - `nomic-embed-text` via Ollama + Tantivy BM25 hybrid search | T7 | Recall@10 ↑ 40% on 50-session project; < 2s query |
| 2B.4 | **Project Budget Dashboard** - Per-provider, per-phase, projected total, alerts at 50/80/95% | T12 | Alerts fire correctly on simulated overspend |

### Phase 2B Go/No-Go Criteria
- [ ] 3 serverless platforms deploy free
- [ ] All 10 language baselines active
- [ ] Semantic recall measurable improvement
- [ ] Budget alerts accurate

---

## Phase 3: Advanced Quality + Governance + Demand Platforms (Weeks 13-16)

| # | Task | Owner | Validation Gate |
|---|------|-------|-----------------|
| 3.1 | **Mutation Testing** - 80% score gate for Standard/Complex (Stryker/Mutmut/Cargo-Mutants/Go-Mutesting/Pitest/Mutcpp/Swift-Mutator/CsCheck/Dart-Mutation) | T4 | CI fails below 80% |
| 3.2 | **Contract Testing** - Pact for service boundaries (REST/gRPC/GraphQL/AsyncAPI) | T4 | Consumer-driven contracts verified in CI |
| 3.3 | **Multi-Party Approval** - Configurable roles (security, legal, product) for publish/go-public | T10 | Org policy enforced; audit trail immutable |
| 3.4 | **RFC Process Live** - Template + 7-day review + decision record + implementation tracking | T10 | First RFC completes cycle |
| 3.5 | **Demand Platforms** - WASI (wasmtime) + Wails (if 3+ requests tracked) | T2 | Only if demand validated |

### Phase 3 Go/No-Go Criteria
- [ ] Mutation gate blocks < 80%
- [ ] Contract tests run in CI
- [ ] Governance workflows operational
- [ ] RFC process used at least once

---

## Cross-Cutting Architecture Decisions (Locked)

| Decision | Rationale | Implementation |
|----------|-----------|----------------|
| **Progressive Enhancement** | Baseline works; opt-in enhances | Feature flags in skills; graceful degradation |
| **Capability-Based AI Routing** | User picks "what", not "who" | Registry maps capability → provider |
| **Tiered Gates** | Velocity for Tiny, rigor for Complex | Parallel execution + skip unchanged |
| **Git-Backed Memory** | Audit trail + conflict resolution | `memory-keeper` uses signed commits |
| **Free-Tier Default Stacks** | Zero-cost start for all users | `architect.md` stack menu updated |
| **Structured Evidence** | Machine-readable + human-readable | JSON schema + pretty printer |
| **Capability Registry Over Provider List** | Future-proof; adding providers = 1 registry entry | YAML registry + router query |

---

## Risk Register & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Provider API breaking changes | High | Medium | Capability registry abstraction; circuit breakers; fallback chains |
| Scope creep from platform requests | High | High | Demand validation gate (3+ requests) before platform work |
| Memory git history bloat | Medium | Low | Squash old session branches; archive > 1yr |
| Mutation testing flakiness | Medium | Medium | Quarantine flaky mutants; baseline per project |
| Onboarding complexity for non-tech | Medium | High | Continuous user testing; simplify if > 30 min |
| Governance overhead for individuals | Low | Medium | Default: single-user auto-approve; opt-in for multi-party |

---

## Success Metrics (Measurable)

### Technical
- [ ] **Gate pass rate** > 95% first attempt (baseline ~70%)
- [ ] **Publish latency** < 10 min Standard (baseline ~25 min)
- [ ] **AI routing cost** < $0.05/task average
- [ ] **Build time** ↓ 30% via adaptive swarm
- [ ] **Secret scan** 100% on encoded test vectors
- [ ] **License scan** 100% ecosystems "checked"

### User Experience
- [ ] **Time-to-first-publish** < 30 min new user
- [ ] **Tier interview completion** 100% without "I don't know" dead-end
- [ ] **Error message comprehension** > 90% in user testing
- [ ] **Platform deploy success** 100% free-tier templates

### Governance
- [ ] **RFC cycle time** < 14 days average
- [ ] **Compliance evidence** auto-collected per release
- [ ] **Multi-party approval** enforced where configured

---

## File Inventory for Implementation

### New/Modified Skills
- `skills/studio/SKILL.md` - Add guided interview, adaptive swarm, capability routing
- `skills/model-router/SKILL.md` - 3-tier providers, capability registry, TCO routing
- `skills/dev-memory/SKILL.md` - Git-backed writes, schema validation, structured lessons
- `skills/quality-gate/SKILL.md` - Tiered parallel gates, mutation/contract dimensions
- `skills/warframe-prototype/SKILL.md` - Free-tier stack defaults
- `skills/tdd-workflow/SKILL.md` - Tiered verification (smoke/TDD/mutation)
- `skills/micro-task-planning/SKILL.md` - Structured evidence JSON
- `skills/gemini-integration/SKILL.md` - Provider rights matrix
- `skills/first-run/SKILL.md` - Interactive onboarding flow
- `skills/lang-*/SKILL.md` - INTERFACE.md + BASELINE.md per language

### New/Modified Hooks
- `hooks/scan.mjs` - Multi-pass decode + LFS/submodule scan
- `hooks/licence-scan.mjs` - Lockfile parsing all 10 ecosystems
- `hooks/verify-progress.mjs` - Structured evidence JSON parsing
- `hooks/quality-gate.mjs` - Tiered parallel execution + skip logic
- `hooks/memory-integrity.mjs` - Schema validation (AJV)
- `hooks/gate.mjs` - Capability-based confirmations
- `hooks/confirm-publish.mjs` - Multi-party approval workflow

### New Files
- `skills/dev-memory/schemas/` - JSON Schema for FOCUS/INDEX/GRAPH/LESSONS
- `skills/lang-*/INTERFACE.md` - Command contract per language
- `skills/lang-*/BASELINE.md` - Idiomatic config per language
- `skills/model-router/capability-registry.yaml` - Provider → capability mapping
- `governance/RFC-TEMPLATE.md` - RFC process
- `governance/policies/` - OPA/Rego policy bundles
- `devops-engineer/templates/dr-runbook.md` - DR template per tier
- `publish-github/multi-party-approval.yaml` - Configurable approval roles

---

## Implementation Readiness Checklist

- [x] All 12 expert teams verified convergence
- [x] Zero blocking concerns unresolved
- [x] Phase gates with measurable criteria
- [x] Cross-cutting decisions locked
- [x] Risk register with mitigations
- [x] Success metrics defined
- [x] File inventory complete
- [x] Dependencies mapped (no circular deps)

**Status**: **READY FOR IMPLEMENTATION**

---

## Next Steps

1. **Assign Phase 1 tasks** to implementation agents
2. **Set up tracking** (GitHub Projects / Linear / similar)
3. **Schedule Phase 1 review** at Week 4
4. **Begin Phase 1.1-1.8** in parallel where independent