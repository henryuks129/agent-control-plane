# Agent Control Plane (ACP) v0.3.1

A local-first, provider-agnostic control plane for resilient multi-agent software development.

## v0.3 capabilities

- dependency-graph task planning
- sequential, parallel and bounded swarm execution
- configurable low / medium / high / maximum effort budgets
- task/node token, request, duration and agent caps
- task-scoped context routing and compact checkpoints
- configurable model routing and retry/failover
- per-model + global concurrency control
- Git worktree isolation and patch artifacts
- deterministic tests/typecheck + optional Fallow review
- LLM review with structured findings
- recursive evidence-backed learning loop with bounded upgrade iterations; candidates never become canonical silently
- SQLite state + local artifact store
- governed design library with anti-AI-slop rules
- local operational UI

## Cost

ACP itself has no subscription requirement. NVIDIA/API usage and optional external tools are separate costs/limits.

## Quick start

```bash
cp .env.example .env
# add NVIDIA_API_KEY if you want live model execution
npm install
npm run typecheck
npm run build
node dist/src/cli/main.js doctor
node dist/src/cli/main.js task:create tasks/TASK-0001.json
node dist/src/cli/main.js task:plan TASK-0001
node dist/src/cli/main.js ui
```

The initial implementation deliberately uses Node built-ins for storage and the UI so ACP has no required runtime framework subscription or hosted service.

## Recursive learning and upgrade loop

ACP treats learning as a bounded feedback system:

```text
run → evidence → findings → lessons → candidate upgrade
  ↑                                      │
  └──── approved → applied → validated ──┘
```

A candidate upgrade is never promoted automatically. Use the CLI to inspect and gate an iteration:

```bash
node dist/src/cli/main.js learning:propose-upgrade TASK-0001 1
node dist/src/cli/main.js upgrade:list candidate
node dist/src/cli/main.js upgrade:approve <UPGRADE-ID>
node dist/src/cli/main.js upgrade:apply <UPGRADE-ID>
# make the bounded product/code change, then run deterministic + AI review
node dist/src/cli/main.js upgrade:validate <UPGRADE-ID>
```

This is intentionally recursive but not unrestricted self-modification. ACP may generate the next improvement candidate from evidence, while safety boundaries, secret handling, and approval policy remain human-controlled.

## v0.4 patch gate

Builder output is stored as a patch artifact. ACP will not apply it automatically: validate it against the task scope and current worktree, inspect it, then approve and apply it explicitly.

```bash
node dist/src/cli/main.js patch:list <TASK-ID>
node dist/src/cli/main.js patch:validate <TASK-ID> <PATCH-ARTIFACT-ID>
node dist/src/cli/main.js patch:show <TASK-ID> <PATCH-ARTIFACT-ID>
node dist/src/cli/main.js patch:approve <TASK-ID> <PATCH-ARTIFACT-ID>
node dist/src/cli/main.js patch:apply <TASK-ID> <PATCH-ARTIFACT-ID>
```

## v0.4 graph and test gate

Custom task graphs are checked for duplicate IDs, missing dependencies, self-dependencies and cycles before execution. The `test` node is a dedicated deterministic worker: it runs typecheck, build and tests, then saves command evidence as an artifact. The reviewer graph node only opens the review gate; ACP performs its authoritative deterministic and optional LLM review once after the graph completes.


## v0.3.1 recursive learning release

v0.3.1 adds the first concrete upgrade-iteration engine. Review evidence is clustered into bounded candidate upgrades, linked through parent IDs, and moved through an explicit lifecycle: candidate → approved → applied → validated (or rejected/rolled back). The loop is deliberately evidence-backed and approval-gated.
