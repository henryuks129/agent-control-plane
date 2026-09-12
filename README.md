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

## v0.5 local project onboarding

Register an existing local Git checkout without cloning it, changing its remote, or storing its secrets:

```bash
node dist/src/cli/main.js project:onboard /absolute/path/to/repository
node dist/src/cli/main.js project:list
node dist/src/cli/main.js project:show PROJECT-ID
```

Project settings are stored separately from `.env` and reject secret-looking fields. Use a JSON file containing only routing, budget, timeout and non-secret profile overrides:

```bash
node dist/src/cli/main.js project:settings PROJECT-ID
node dist/src/cli/main.js project:settings:set PROJECT-ID settings.json
```

To use those settings for a task, add its registered `projectId` to the task JSON. Project-specific profiles, role preferences, budgets and timeouts are resolved for that run; API keys remain in `.env`.

Read-only task history is available through `history:show TASK-0002`; use `artifact:preview TASK-0002 ARTIFACT-ID` to preview a stored text artifact safely.

Use `task:graph TASK-0002` for the validated, read-only dependency graph behind the dashboard view.

## v0.4 graph and test gate

Custom task graphs are checked for duplicate IDs, missing dependencies, self-dependencies and cycles before execution. The `test` node is a dedicated deterministic worker: it runs typecheck, build and tests, then saves command evidence as an artifact. The reviewer graph node only opens the review gate; ACP performs its authoritative deterministic and optional LLM review once after the graph completes.

The local dashboard exposes the same human patch gate. Start it with `node dist/src/cli/main.js ui`, choose a task, validate a patch, inspect the result, approve it, and only then use Apply. Apply always revalidates the patch against the worktree.

External review is optional. Set `CODERABBIT_ENABLED=true` and set `CODERABBIT_COMMAND` to the complete command you want ACP to run; then use `review:external <TASK-ID>`. ACP stores its evidence and does not enable or contact an external review service by default.


## v0.3.1 recursive learning release

v0.3.1 adds the first concrete upgrade-iteration engine. Review evidence is clustered into bounded candidate upgrades, linked through parent IDs, and moved through an explicit lifecycle: candidate → approved → applied → validated (or rejected/rolled back). The loop is deliberately evidence-backed and approval-gated.
