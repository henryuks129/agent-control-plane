# ACP Product Specification — v0.3

ACP is intended to become a developer-facing multi-agent control plane for software engineers and vibe coders.

## Core promise

Give ACP an outcome, not a sequence of prompts. ACP decomposes the outcome, routes work to configurable models, preserves compact checkpoints, isolates code changes, reviews evidence and learns from confirmed failures.

## User controls

- effort: low / medium / high / maximum
- execution: sequential / parallel / swarm
- model profiles: configurable
- task/node budgets
- concurrency limits
- review gates
- design-library requirements

## Future product surface

The first UI is a local operational dashboard. Future releases can add GitHub connection, repository onboarding, model/API configuration, design-library importing, task graph visualization, artifacts, review history, memory and upgrade history.

## Recursive upgrade loop

ACP records review failures, creates candidate lessons, and exposes human approval as an explicit boundary. Approved lessons can be retrieved by later context builds. Future upgrade iterations can compare metrics across runs before changing prompts, routing, budgets or design policy.
