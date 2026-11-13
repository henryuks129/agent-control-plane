# Project memory

ACP keeps one memory that every connected agent reads. This guide shows how
to set it up and what each command does. The reasons behind the design are in
ADR-0008 §9g and §9l.

## The layers

| Layer | Holds | Where | In Git? |
|---|---|---|---|
| You | Preferences for every project | `<ACP data folder>/memory/user.md` | No |
| Project | Goals, rules, decisions | `.acp/knowledge.md` | Yes |
| Path rules | Rules for matching files | `.acp/rules/*.md` | Yes |
| Task | Checkpoints | `.acp/local/` | No |

An agent receives the layers from broadest to narrowest. When two disagree,
the narrower one wins.

## Set it up

```bash
node dist/src/cli/main.js memory:init
```

This creates `.acp/knowledge.md` and `.acp/rules/`, and adds `.acp/local/` to
`.gitignore`. It never overwrites a file you already have.

## Write a rule

A rule is one Markdown file in `.acp/rules/`:

```markdown
---
paths: [src/api/account/**]
keywords: [password, signup]
check: npm test -- account
learned-from: TASK-0042
---
Hash passwords with the existing helper before saving.
```

| Field | Meaning |
|---|---|
| `paths` | Files the rule applies to. `**` crosses folders, `*` stays in one. A folder name alone covers everything inside it. |
| `keywords` | Whole words in a request that make the rule relevant even when no path matches. |
| `check` | A command that can detect the mistake. Without one, the rule is advice only. |
| `learned-from` | The task or pull request the rule came from. Such rules are shown as past mistakes. |

## See what a task would receive

```bash
node dist/src/cli/main.js memory:show --request "add a password reset" src/api/account/reset.ts
```

This is the mistake guard: it picks the rules that match the files or the
request and leaves the rest out. Rules share a 2 KB budget. A rule is shown
whole or not at all; the ones left out are named so an agent can open them.
Matching uses paths and keywords only, so it is free and gives the same
answer every time.

Tasks run through ACP receive this automatically.

## Share it with agents outside ACP

```bash
node dist/src/cli/main.js memory:sync
```

- Writes a summary into a marked block in `AGENTS.md`. Everything outside the
  block is yours and is never changed.
- Adds `@AGENTS.md` to `CLAUDE.md` (or creates it), so Claude Code reads the
  same file.
- The summary holds the knowledge and one line per rule. It is kept under
  8 KB because agents load these files into every session.
- If someone edits inside the block by hand, sync stops and says so instead
  of overwriting the edit. Move the edit into `.acp/`, then sync again.
- If memory appears to contain a key, token or password, nothing is written.

`memory:sync --check` changes nothing and fails when the files are out of
date. CI runs it on every pull request.

## Not built yet

- Folder-level `AGENTS.md` blocks and `.claude/rules/` files for path rules.
  Today the root summary lists each rule and where to read it.
- Turning a hand edit of the block into a proposed change to `.acp/`.
- Running each rule's `check` during review, and drafting rules from failed
  checks.
- Importing memory from Claude Code, Codex and OpenCode.
