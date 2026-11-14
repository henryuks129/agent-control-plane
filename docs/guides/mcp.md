# ACP's MCP server

MCP (Model Context Protocol) is how coding agents call outside tools. ACP's
server gives any agent that speaks it the project's shared memory, whether
ACP started the agent or you did in a terminal. The reasons are in ADR-0008
§9e and §9n.

## Start it

```bash
acp /mcp
```

It reads requests on standard input and answers on standard output, so you
do not run it yourself: you tell your agent to. Run these from your project
folder (they need the `acp` command, which `npm link` in ACP's folder sets up):

| Agent | Command |
|---|---|
| Claude Code | `claude mcp add acp -- acp /mcp` |
| Codex | `codex mcp add acp -- acp /mcp` |

The server works on the folder the agent is started in.

## What an agent can do

| Tool | What it does |
|---|---|
| `memory_get` | Reads the memory for the files and request at hand: your preferences, project rules, and the rules for those files, including past mistakes |
| `memory_search` | Finds a word or phrase in memory, with the file and line |
| `memory_propose_rule` | Suggests a rule. It is saved for you to review and does not apply until you accept it |
| `checkpoint_write` | Saves where a task stands (done, next, notes) so another agent can continue |
| `checkpoint_read` | Reads the latest checkpoint for a task |

## What an agent cannot do

- Change `.acp/knowledge.md` or `.acp/rules/`. Those change only when you
  accept a proposal:

  ```bash
  acp /memory proposals
  acp /memory accept <name>
  ```

- Save anything that looks like a key, password or token. The write is
  refused and the agent is told why.
- Save a checkpoint over 4 KB. Checkpoints are meant to be short.

Proposals and checkpoints live in `.acp/local/`, which Git ignores.

## Not built yet

- Attaching the server automatically to agents ACP starts. Today you add it
  to each agent once, with the commands above.
- Handing a task to another agent, project activity, and the design library
  as tools.
- OpenCode setup has not been tried; it reads MCP servers from its own
  config file.
