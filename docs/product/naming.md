# Product name options

**Decision (2026-11-10):** keep **ACP — Agent Control Plane** for now. Write
the full name everywhere so it is not confused with the Agent Client Protocol.
The options below stay here in case we rename before a public launch.

**Why rename:** "ACP" is already the Agent Client Protocol, the standard T3
Code, Zed and Google use to connect agents. ACP will support that protocol, so
sharing its name would confuse users and search.

Checked on 2026-11-10: npm package, GitHub user/org name, and a web search for
coding-agent tools with the same name.

## Shortlist

| Name | Idea | npm | GitHub org | Same-space conflict |
|---|---|---|---|---|
| **Samethread** (recommended) | Every agent stays on the same thread; matches "hand off without losing the thread" | `samethread` free | `samethread-dev` free (`samethread` taken) | None found |
| Almanac | The shared book of what the project knows (`knowledge.md`) | `almanac` taken; `almanac-dev` free | `almanac-dev` free | Not checked in depth |
| Hearth | The place every agent gathers | `hearth` taken | `hearth-dev` free | Hearth, an agent-native game engine; Hearth AI (CRM) |

## Rejected (already used for a similar product)

| Name | Conflict |
|---|---|
| Baton | Baton, a desktop app that runs Claude Code, Codex and OpenCode in parallel worktrees |
| Corral | agent-corral, open-source multi-agent coding orchestrator |
| Cairn | agentcairn and others: local memory for coding agents |
| Commonplace | A knowledge-base framework for coding agents |
| Conductor | Conductor, a Mac app for parallel Claude Code sessions |
| Relay, Tandem, Quorum, Cadre, Muster, Keel, Harbor | npm and GitHub names taken |

## Before deciding

- Check the trademark database (USPTO / EUIPO / WIPO) for the final pick.
- Check the domain (`.dev`, `.app`, `.so`).
- The CLI command should be short: `samethread` could ship as `st` or `thread`.
