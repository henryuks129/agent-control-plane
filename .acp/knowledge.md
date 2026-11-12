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
