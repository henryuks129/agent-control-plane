# ACP v0.3 Control-Plane Specification

ACP is a local-first, provider-agnostic execution control plane. The model is a replaceable worker; ACP owns task state, context routing, checkpoints, budgets, concurrency, isolation, review and learning.

## Execution

`queued → planning → assigned → running → checkpointed → review → passed|failed → merged|blocked`

A task is represented as a dependency graph. Independent nodes may execute concurrently, subject to global and per-model concurrency limits. Failed/retryable workers are replaced from configured model candidates without replaying the entire conversation.

## Context economy

Context is pull-based. Tier 0 is task + critical rules. Tier 1 is scoped source/contracts. Tier 2 is relevant architecture/design/neighboring code. Tier 3 is historical lessons. Checkpoints store progress, not transcripts.

## Budgets

Each task chooses `low | medium | high | maximum`. The effort profile controls token, request, duration and agent caps. Node-level budgets can override the task profile. This is an orchestration budget, not a claim about provider-side reasoning modes.

## Swarm

Parallel execution is DAG-based rather than blind fan-out. The concurrency manager enforces the configured global limit and each model's `maxConcurrent`. A swarm is therefore logically large but physically bounded.

## Review

Deterministic checks run before model review. Findings preserve evidence separately from model judgment. Optional external reviewers such as Fallow and CodeRabbit are adapters, not required runtime dependencies.

## Learning

Review findings feed a recursive learning loop. The loop creates evidence-backed candidate rules and lessons. Canonical project/design rules require approval; an agent cannot silently rewrite policy.

## Design library

`reference → candidate → reviewed → canonical → deprecated`. Agents search before creating UI abstractions. The library includes foundations, components, patterns, UX rules and anti-patterns. External inspiration is analyzed into candidates rather than copied wholesale.

## Storage

SQLite stores state and metadata locally. Artifacts live under `.data/artifacts` and are accessed through an abstraction so storage can later move to Oracle, Wasabi, DigitalOcean Spaces or another S3-compatible service without changing orchestration logic.

## Model lifecycle and routing

ACP does not treat the public model catalog as runtime truth. Model profiles are
capability-based and carry runtime health. A provider/model returning a terminal
availability error is marked unavailable and removed from active routing until
reconfigured or revalidated. Transient failures are degraded and remain eligible
only when the route explicitly permits degraded candidates.

Tasks request roles and effort levels; the router selects among configured
profiles. This allows model retirement, provider failure, and model quality
changes without changing task or agent code.
