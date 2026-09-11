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
