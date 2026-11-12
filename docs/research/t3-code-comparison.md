# T3 Code compared with ACP

Checked 2026-11-12 against `pingdotgg/t3code` at commit `1d218d15`, from its
README, its `docs/` folder and its source. T3 Code is MIT licensed and
describes itself as "the open-source control plane for coding agents".

## What T3 Code is

One server runs on the machine that owns the project. It starts the coding
agents you are already signed in to (Claude Code, Codex, Cursor, OpenCode,
Antigravity and others). Web, desktop (Electron) and phone apps are all
clients of that server. T3 does not resell tokens.

## Features that matter to ACP

| T3 feature | What it does | ACP status |
|---|---|---|
| Your own subscriptions | Starts each maker's own agent; never handles tokens | Decided (ADR-0007), not built |
| Many agents in one thread | Change agent mid-thread | Decided, not built |
| Orchestrator MCP server | An agent creates a child task on any provider; the child gets only the task prompt | Decided (ADR-0008 §9e), not built |
| Portable handoffs | A budgeted selection of recent messages, plus a tool to read older ones | Decided differently: written checkpoints (§9f) |
| Worktrees | Each thread in its own worktree, with setup scripts | Worktrees built (v0.5) |
| Diff review and pull requests | Per-turn diff, commit, push, PR on 8 Git hosts, stacked PRs | Patch review built; GitHub only planned |
| Usage and limits | Token use and plan limits per provider | Decided (§9c), not built |
| Preview browser and captures | Screenshots and recordings by user or agent | Decided (§9i), not built |
| Web, desktop and phone clients | One server, same threads everywhere | Web and desktop decided (§9m); phone later |
| Remote access | T3 Connect relay, local network, Tailscale, SSH | Later, with the optional account (§9a) |
| Permission modes | Supervised, auto-accept edits, auto, full access; per thread | Adopted (§9n) |
| Forks and side chats | Branch a thread, or ask about it without adding to it | Adopted (§9n) |
| Visual replies | Agent answers with a sandboxed HTML page in the thread | Adopted (§9n) |
| Secrets | Reads from 1Password; agent asks for a secret in a private card | Secret request card adopted (§9n) |
| Text generators | A cheap model writes titles, commit messages, PR text | Adopted (§9n) |
| Scenarios | Real-app tests that prove a fix: fail before, pass after | Adopted (§9n) |
| Outside agents | Agents T3 did not start control it over MCP | Adopted through ACP's MCP server (§9n) |
| Scheduled tasks | Recurring work without an open thread | Later |
| Managed policy | An administrator locks settings for a machine | Not planned |
| Voice input, themes, SnapShots | Dictation, theme editor, window capture with accessibility data | Not planned |

Correction to an earlier note: T3's "visual replies" are close to Claude's
artifacts. They are pages in a thread, not published links.

## Not found in T3 Code

Searched its docs and source; "memory" there refers to RAM.

- Memory shared across agents and owned by the user.
- Checks that gate a change, evidence kept apart from model opinion, a merge
  queue that re-runs checks.
- Learning from mistakes: saved rules and a guard before each task.
- A design library, or skills that attach to a task on their own.

These are where ACP should spend its effort.

## Two cautions

- **Overlap.** T3 already ships most of the client ACP planned. ACP builds its
  own server and clients (ADR-0008 §9m) because its memory, review gates and
  guard sit in the middle of every task, which is hard to bolt on from
  outside. ACP's MCP server (§9e) also lets T3, Claude Code or Codex use ACP's
  memory directly, so the two can work together.
- **Name.** In T3 and other tools "ACP" means Agent Client Protocol. Expect
  confusion; say "Agent Control Plane" in full on first mention.
