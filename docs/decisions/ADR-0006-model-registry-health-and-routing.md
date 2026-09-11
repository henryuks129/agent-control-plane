# ADR-0006 — Model Registry, Health and Capability Routing

## Decision

ACP routes by role + capability + effort budget, not by hard-coded model names.
Each model profile carries provider, capabilities, concurrency, context window,
reasoning/tool/vision support, priority and runtime health.

Runtime availability is authoritative over catalog metadata. A failed 404/410
marks a model unavailable; transient provider failures mark it degraded. The
router excludes unavailable models and can fail over to another configured
candidate.

## Initial NVIDIA profiles

- builder: `moonshotai/kimi-k3`
- reviewer: `nvidia/nemotron-3.5-lightning-30b-a3b`
- researcher: `deepseek-ai/deepseek-v4-flash-0731`
- recovery: `nvidia/nemotron-3.5-lightning-30b-a3b`
- planner: `deepseek-ai/deepseek-v4-pro-0813`
- coding-specialist: `poolside/laguna-xs-2.1`

These defaults remain configuration-driven and can be replaced through
`ACP_MODELS_JSON` without changing application code.

## Effort routing

Low/medium/high/maximum budgets remain independent from model identity. ACP
can therefore spend fewer tokens on routine work and reserve larger reasoning
budgets for complex tasks.
