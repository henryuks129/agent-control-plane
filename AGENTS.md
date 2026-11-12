# Agent Control Plane — Agent Rules

## Mission
Build a reliable, provider-agnostic multi-agent engineering control plane that minimizes context consumption while preserving task continuity, code quality, UX consistency, and recoverability.

## Non-negotiables
1. Never give an agent the whole repository unless the task explicitly requires it.
2. Context is pull-based: task first, relevant files/contracts second, historical context only on demand.
3. Git is the source of truth for code state.
4. Task state describes intent/progress, not the entire codebase.
5. Checkpoints must be compact and resumable.
6. Agents work in isolated Git worktrees.
7. Every meaningful change passes deterministic checks before merge.
8. Never silently invent a new component when the design library or component registry already has a suitable pattern.
9. Canonical design-library changes require approval; agents may create candidates.
10. Provider/model choice is configuration, not business logic.
11. Secrets must never be written to task state, checkpoints, logs, prompts, or Git.
12. Review findings must distinguish evidence from model judgment.

<!-- acp:begin sha256=c0978a506130 generated from .acp/ by ACP; edit the files in .acp/ instead of this block -->
## Project memory (managed by ACP)

# Project knowledge

What stays true about Agent Control Plane (ACP). Every connected agent reads
this. The non-negotiable rules are in AGENTS.md and are not repeated here.

## Goals

- A free, open-source workspace where the coding agents a person already
  uses share one memory, work in parallel, and change nothing until that
  person approves it.
- ACP's own value is the shared memory, the mistake guard, evidence-first
  review and built-in design skills.

## Rules

- Changes go branch → pull request → `dev` → pull request → `main`. Never
  push to `dev` or `main`. Open pull requests into `dev`; the maintainer
  merges.
- Commit messages and pull request text carry no dates, no tool or AI
  attribution, and do not name or compare other products.
- Node built-ins first. Ask before adding a dependency.
- Write the test first and watch it fail before writing the code.
- Comment the reason for a decision, not what the code already says.

## Decisions

- Reasons for each decision are in `docs/decisions/`. ADR-0008 holds the
  current build order.
- Memory is layered: user, project (`.acp/knowledge.md`), path rules
  (`.acp/rules/`), task. The narrower layer wins.

### Rules for specific paths
Before changing a file, read the rules that apply to it. If two disagree, the narrower path wins.
- `docker-env` applies to `compose.yaml`, `Dockerfile`, `docs/guides/docker.md` (.acp/rules/docker-env.md)
- `memory-module` applies to `src/memory/**`, `tests/memory.test.ts` (.acp/rules/memory-module.md)
<!-- acp:end -->
