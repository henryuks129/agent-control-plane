# Connect and run your agents

ACP uses the coding agents already on your computer: Claude Code, Codex and
OpenCode. You sign in to each one in its maker's own tool. ACP never asks for
a password, never reads a token, and never signs in for you. The reasons are
in ADR-0007 §4.

## See what is connected

```bash
acp /agents list
```

```text
claude    Claude Code  2.1.190  ready       Claude Pro plan
codex     Codex        0.160.0  signed out  Run: codex login
opencode  OpenCode     -        not installed  Install OpenCode from https://opencode.ai
```

ACP shows a plan or provider name only. It does not show or store your email,
organisation or keys.

| To sign in to | Run |
|---|---|
| Claude Code | `claude auth login` |
| Codex | `codex login` |
| OpenCode | `opencode auth login` |

## Run a request

```bash
acp /run codex "Explain how memory rules are matched"
```

| Option | What it does |
|---|---|
| (none) | **Ask.** The agent can read and answer but cannot change files. This is the default. |
| `--edit` | The agent may change files, only inside the run's own worktree. |
| `--files a,b` | The files the request is about. They decide which memory rules the agent receives. |
| `--model <name>` | Use a specific model, in the agent's own naming. |
| `--timeout <minutes>` | How long the run may take. Default: 15 for a question, 30 with `--edit`. |

Every run:

1. Checks the agent is installed and signed in, and says what to do if not.
2. Creates a Git worktree and a branch `acp/run-…`. Your project folder is
   never touched.
3. Gives the agent ACP's memory for those files, then your request
   (see [memory](memory.md)).
4. If the request is design work, adds the built-in design skills
   (see [design skills](design-skills.md)).
5. Lists the files the agent changed. Nothing is merged; you review the
   branch and decide.

## How each agent is limited

| Agent | Ask | Edit |
|---|---|---|
| Claude Code | `plan` permission mode | `acceptEdits`: file edits allowed, shell commands refused |
| Codex | `read-only` sandbox | `workspace-write` sandbox, confined to the worktree |
| OpenCode | its `plan` agent | its `build` agent with `--auto` |

These limits are enforced by each tool, not by ACP.

## If a run fails

- **"sign-in was refused":** the tool reported it was signed in, but its
  service rejected the saved sign-in. Sign in again with the command shown.
- **A model is not available on your plan or in your country:** choose
  another with `--model`. `opencode models` lists OpenCode's.
- **"was stopped after N minutes":** the run reached its time limit. The
  work it did is kept in the worktree. Give the next run longer with
  `--timeout <minutes>`.
- **No output for a long time:** some models or providers hang, and the
  time limit ends the run.
- **"MCP tool call requires approval" in Codex's output:** Codex's own
  browser or other tools need an approval that a run with nobody watching
  cannot give. Codex carries on without them.

## Clean up runs

Every run keeps its worktree and branch so you can review it.

```bash
acp /runs list
acp /runs clean
acp /runs remove <run> --force
```

`/runs clean` removes only runs that changed nothing. A run that holds work
is kept until you remove it by name with `--force`.

## Your request stays private

ACP sends the request to the agent on standard input, not as a
command-line argument, so other users of the same computer cannot read it
in the process list.

## Not built yet

- Threads with several tasks, live progress in a web app, and approving
  individual actions while an agent works.
- Orchestrators that hand tasks to other agents.
- Plan usage and limits.
- Antigravity.
