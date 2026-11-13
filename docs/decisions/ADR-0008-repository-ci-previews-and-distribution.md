# ADR-0008 — Repository, CI, previews and distribution

**Status:** Accepted (direction); implementation in progress
**Date:** 2026-11-10
**Deciders:** henryuks (maintainer)

## Context

ACP (Agent Control Plane) is free and open source (ADR-0007). Before the
public launch it needs a GitHub repository that outside people can
contribute to safely, automated checks, previews of each change, a desktop
app people download from the website, and a way for anyone, technical or
not, to report problems.

This ADR records the decisions the maintainer made on 2026-11-10. The
step-by-step setup is in `docs/guides/ci-setup.md`.

## Decision

### 1. Only the maintainer can change `main`

Branch flow (decided 2026-11-11):

```text
your branch → pull request → dev → pull request → main
```

- **`dev`** is where every change lands first, and it is the repository's
  default branch, so new pull requests target it automatically. Changes are
  tried on `dev` until they are known to be free of bugs.
- **`main`** is the released code. It only accepts pull requests from `dev`
  (the "Only dev merges into main" check fails anything else). The website
  is published from `main`.
- Contributors fork the repository or work on a branch and open a pull
  request into `dev`. Nobody pushes to `dev` or `main` directly.
- Rulesets on both branches require: a pull request, all required checks
  passing, review threads resolved, and no force pushes or deletions.
  Nobody can bypass these, the maintainer included.
- A second ruleset on each branch requires one approval from a code owner
  (`.github/CODEOWNERS` names the maintainer). GitHub does not let anyone
  approve their own pull request, so repository admins may bypass this one
  rule, and only when merging a pull request.
- Merge methods: pull requests into `dev` are squashed (one commit each, a
  straight-line history). `dev` into `main` uses a merge commit, so the two
  branches keep the same commits and never drift apart.
- Branches are deleted automatically when their pull request is merged
  (repository setting) or closed without merging (the "Branch flow"
  workflow). `dev` and `main` are never deleted. A deleted branch can be
  restored from its pull request page.
- Only the maintainer can merge. Agents never merge; they open pull requests.

### 2. CI checks, and why each exists

| Check | Catches | Status |
|---|---|---|
| Typecheck (`tsc --noEmit`) | Type errors before anything runs | Added (step 1) |
| Build (`tsc`) | Code that does not compile to JavaScript | Added (step 1) |
| Tests (`node --test`) | Behaviour that broke | Added (step 1) |
| Patch report template | Pull requests without evidence | Added (step 2) |
| Docker build and smoke test | An image that does not start | Planned (step 4) |
| Secret scanning (gitleaks) | Keys and passwords committed by mistake | Planned (step 5) |
| Dependency audit (`npm audit`) | Packages with known vulnerabilities | Planned (step 5) |
| Static security analysis (CodeQL) | Injection and other unsafe code patterns | Planned (step 5) |
| Pull request size label, context budget | Changes too large to review well; agent instructions that keep growing | Planned (step 6) |

Rules for the workflows themselves:
- Read-only permissions by default; a job gets write access only when it
  needs it.
- Pull requests from forks never receive secrets. Workflows use the
  `pull_request` trigger, never `pull_request_target` with the
  contributor's code.
- Third-party actions are pinned to a commit SHA before launch.

### 3. A preview for every pull request

Each pull request gets its own preview so the maintainer can see what was
added and how it works before merging.

- **Website:** Cloudflare Pages builds every pull request and posts a link
  such as `pr-12.acp-site.pages.dev`. It is free, needs no server, and the
  link is removed when the pull request closes. When ACP has a domain, the
  previews move to `pr-12.preview.<domain>`.
- **App:** CI builds the Docker image for each pull request and tags it
  `pr-12`, so the maintainer can run it with one `docker run` command. A
  hosted app preview comes later. It runs contributor code, so it must run
  with no secrets and be deleted when the pull request closes.

### 4. Docker container

The existing `Dockerfile` (two stages, runs as the `node` user, port
4317) stays. To add: a health check on `/healthz`, a `compose.yaml` for
local use, a CI build with a smoke test, and images published to GitHub
Container Registry (`ghcr.io`) from `main` and for each pull request.

### 5. Desktop app: Electron, with native code only where needed

- **Electron** for macOS, Windows and Linux. ACP is already Node and
  TypeScript, so Electron can run the ACP server inside the app and reuse
  the web interface.
- **Electron does not build iOS apps.** An iPhone or iPad app is a separate
  project (SwiftUI) and a later phase. The likely first version is a
  remote view of a desktop's tasks and approvals, not a full workspace.
- **Swift only where Electron falls short**, as a small helper the app
  calls. Examples: a menu-bar extra, macOS sandbox or Keychain details.
  None are needed for the first release.
- **macOS distribution:** apps downloaded outside the App Store must be
  signed with an Apple Developer ID and notarised, or macOS blocks them.
  This needs the Apple Developer Program (US$99 a year). Windows signing is
  needed later to avoid SmartScreen warnings.
- **Rejected for now:** Tauri (smaller app, but it needs Rust and a Node
  sidecar for ACP's server), and a fully native Swift app (two codebases
  and no Windows or Linux).

### 6. Website: downloads and detailed pages

- The download page detects the visitor's operating system and chip (for
  example macOS on Apple silicon) and recommends that build. Every other
  build stays one click away.
- Each operating system also gets terminal install commands, for example a
  Homebrew command on macOS, a `curl` install script on Linux, and `winget`
  on Windows, plus `npm install -g` for the CLI.
- Every page explains what the user is installing, what it can access, what
  stays on their machine, and what each connected provider receives. Pages
  planned: Home, Download, Docs (Get started, Connect agents, Free models,
  Orchestrators, Agent Exchange, Memory, Review and safety checks, Plan
  limits), Security and privacy, Report a problem, Changelog, Contribute.

### 7. Reporting problems

- **Technical users:** GitHub issue forms (`bug.yml`, `feature.yml`)
  that apply labels automatically.
- **Non-technical users:** a "Report a problem" form on the website and in
  the app, with no GitHub account needed. A small serverless function
  (for example a Cloudflare Worker) creates the GitHub issue using a GitHub
  App token, which is never sent to the browser. A CAPTCHA (Cloudflare
  Turnstile) limits spam. The app can attach logs only after the user
  previews them, and secrets are removed first.
- **Labels:** `type:bug`, `type:feature`, `type:docs`, `type:question`;
  `area:desktop`, `area:terminal`, `area:website`, `area:orchestrator`,
  `area:memory`, `area:connectors`; `source:github`, `source:website`,
  `source:app`; `needs-triage`; `priority:p0` to `priority:p3`.
- **Priority:** reporters say how bad the problem is ("I can't work", "a
  workaround exists", "it looks wrong"). That suggests a priority, and
  triage sets the final one. Triage can be done by an ACP agent, with the
  maintainer confirming any `priority:p0`.

### 8. Git host view inside ACP

ACP shows activity from the user's own project host (GitHub first): recent
commits, open pull requests, CI results and issues, linked to ACP tasks.

- It uses the credentials the user already has (`gh` CLI or Git), the same
  way ACP uses vendor runtimes. No "Sign in with GitHub" is required.
- It is read-only by default. Opening a pull request or posting a comment
  needs the user's approval.
- It lets the orchestrator act on events: a failing CI run or a new issue
  becomes a proposed task, and a merged pull request closes its task.

### 9. Plan limits and patch reports

Confirmed by the maintainer: plan usage windows drive routing (ADR-0007
§2), and every patch carries a Problem / Change / Scope / Verification
report (ADR-0007 §8a). The pull request template uses the same shape.

### 9a. Accounts: Clerk for the optional ACP account, not for agents

Clerk is a hosted sign-in service. Agents are never onboarded through it:
each provider signs in through its maker's own app or key.

For ACP:
- ACP works with no account. If we add an account (for remote access, the
  phone app or syncing settings), Clerk is a good fit.
- Agents keep connecting through their makers' runtimes (ADR-0007).
  Clerk signs users in to *our* app. It can't hold a user's Claude or ChatGPT
  subscription login, and vendors don't allow passing those tokens through a
  third party.
- Only Clerk's public keys go in the client. The secret key stays on the
  server.

### 9b. Chat and coding in one thread, with no mode switch

Most agent workspaces are for coding only, with general chat as a separate
product. Baton and agent-corral/coral run coding agents in worktrees and
have no plain chat. agentcairn and Commonplace are memory or knowledge
layers that plug into those agents rather than apps.

Decided 2026-11-11: one kind of thread, and no Code / Ask switch (the
maintainer found it confusing). A question gets an answer in the thread;
a request for a change becomes tasks. No switch is needed for safety,
because agents only edit their own worktree and nothing reaches the
project until the user approves it in Review.

### 9b-1. Thread controls live on the tasks, not in the header

Decided 2026-11-11: no Stop, Resume or Review buttons in the thread
header. The header shows only a status line ("2 working · 2 ready to
review").
- A ready task shows a **Review** button on its own row.
- A stopped task shows **Resume** on its row.
- A working task can be stopped from its opened row ("Stop this task").
- Stopping everything uses a stop button beside Send in the message box,
  shown only while agents are working, as in common chat apps.
- A new request shows as working the moment it is sent, before the
  orchestrator has split it into tasks.

### 9c. Where plan usage comes from

ACP doesn't invent the numbers. Each harness reports them, and ACP turns
them into one format:
- Claude Code: the Claude Agent SDK's usage request and its rate-limit
  events (5-hour and 7-day windows).
- Codex: rate-limit readings sent by the Codex app-server.
- Antigravity: Google's quota service, using the user's own sign-in.
- API and free models: no plan window. ACP counts its own requests and
  reads the provider's rate-limit replies, for example NVIDIA's about 40
  requests a minute, and labels these as estimates.

### 9d. Checkpoints stay

Checkpoints (`docs/protocols/checkpoint.md`) are still the core: a few
hundred tokens per step, saved as work happens. `handoff.md` is built from
the latest checkpoint, the task ledger and Git. The app shows each task's
checkpoints as a short timeline, with `handoff.md` one click away.

### 9e. Tools, browser, sub-agents: borrow what the harness has, add one ACP server

- Agents keep their own skills, plugins, MCP servers, sub-agents, browser
  and computer-use tools. ACP lists and toggles them; it does not reinstall
  them.
- ACP adds one server of its own, injected into every agent session: memory
  (read and write `knowledge.md` and checkpoints), task hand-off to another
  agent, project activity and the design library. Nothing to install.
- Knowledge and design-library skills are plain files ACP passes in. "Calling
  a tool instead of installing it" works because the ACP server is already
  attached to every session.
- An embedded preview browser comes later, after the Electron app.
- **Orchestrator hand-offs go through ACP's server:** an orchestrator
  starts a child task on any connected agent (for example Claude handing work
  to Codex or a free model) through the ACP server. The child receives the
  task, its scope and the relevant memory, not the parent's whole chat.
  Each agent's own sub-agents keep working inside that agent.

### 9f. What "memory" means in ACP

Vendor memory today (checked 2026-11-11):
- Claude Code: `CLAUDE.md` files written by people and an auto-memory folder
  written by Claude. Chats are saved as files on the computer.
- Codex: `AGENTS.md` files and an optional Memories feature that summarises
  past sessions into `~/.codex/memories/`. Chats are saved in
  `~/.codex/sessions/`.
- Claude (chat app): an "import memory" tool. Claude gives you a prompt to
  paste into ChatGPT, and you paste ChatGPT's answer back. It moves remembered
  facts, not full chats, and it is for the chat apps, not Codex sessions.
- None of these is shared between vendors.

Shared memory across vendors is ACP's answer to this, and a core reason ACP
exists (confirmed by the maintainer 2026-11-11). ACP memory is one store
shared by every connected agent, Claude, Codex, Antigravity and OpenCode
models alike, with two parts:
- **Project knowledge** (`knowledge.md`): goals, rules and decisions that
  stay true. Changed by agents with the user's approval.
- **Task progress** (checkpoints): what each task has done and what is
  next. Written automatically as work happens.

When one agent stops, the next one reads the task's latest checkpoint and the
relevant knowledge, not the whole chat, so the user writes no briefing. ACP
hands over a written state, not a selection of raw messages.

### 9g. Memory belongs to the project, in layers

Decided 2026-11-11. Memory is per project, not per file. Rules can be
narrowed to files or folders, the way Claude Code (`CLAUDE.md` in
subfolders, `.claude/rules/` with paths) and Codex (nested `AGENTS.md`,
closest file wins) already work.

| Layer | Holds | Where |
|---|---|---|
| User | Preferences for every project | ACP account or local settings |
| Project | `knowledge.md`: goals, rules, decisions, tools | One per project |
| Path rules | Rules for matching files, e.g. `src/api/**` | Project memory, matched by path |
| Task | Checkpoints and `handoff.md` | One per task |

- An agent receives the user layer, the project layer, only the path rules
  that match the files it is working on, and its task's latest checkpoint.
- When layers disagree, the narrower one wins (task over path rule over
  project over user), as in Codex.
#### Memory files in the repository (decided 2026-11-11)

1. **Source of truth: files in Git, for the project and path layers.**
   They live in `.acp/knowledge.md` and `.acp/rules/*.md` (each rule file has
   a `paths:` list, such as `src/api/**`). This follows non-negotiable 3
   (Git is the source of truth), means changes are reviewed in pull requests
   like code, and works without ACP running. The user layer and task
   checkpoints are not project files: they stay in ACP's store (local, a
   folder, or the user's database). ACP keeps a search index of everything,
   rebuilt from these sources, never edited by hand. One writer per layer
   means there is no two-way sync to get wrong.
2. **Existing `AGENTS.md` and `CLAUDE.md`: never rewritten.** ACP adds one
   marked block to `AGENTS.md` (`<!-- acp:begin -->` … `<!-- acp:end -->`)
   and leaves everything outside it alone. If `CLAUDE.md` exists and does
   not mention `AGENTS.md`, ACP adds the line `@AGENTS.md` (Claude Code's
   import syntax) instead of copying content. On first connect, the existing
   content is offered for import into `.acp/` as proposals (§9h); the user
   may then shorten the original files, but ACP does not.
   Path rules are written where each tool looks for them: a block in
   `AGENTS.md` inside the matching folder (Codex, OpenCode) and
   `.claude/rules/acp-<name>.md` with the same `paths:` (Claude Code).
3. **Committed:** `.acp/knowledge.md`, `.acp/rules/`, and the generated
   blocks and files, so teammates and CI agents get the same memory and
   every change shows in a diff. **Ignored:** `.acp/local/` (checkpoints,
   `handoff.md`, captures, caches, personal notes). ACP adds that line to
   `.gitignore` itself. Checkpoints stay out of Git because they change
   constantly and can quote secrets from logs.
4. **Size limits:** the generated block is a summary with pointers, not the
   whole memory. Budget: 8 KB for the root `AGENTS.md` block, 4 KB per folder
   block or rule file. Codex stops reading project instructions at 32 KiB by
   default, and every byte loads into every session, so the budget leaves
   room for the user's own text. Agents fetch the full memory on demand
   through ACP's server. The CI context budget check (action item 6) fails a
   pull request that goes over.
5. **Edits made straight to the files:**
   - Outside the ACP block: the user's own text. ACP never touches it.
   - In `.acp/` files: normal edits; that is the source, so nothing to sync.
   - Inside a generated block: ACP stores a hash of what it wrote. If the
     hash no longer matches, ACP does not overwrite it; it shows the edit as
     a proposed change to `.acp/` for the user to accept or reject, then
     regenerates.
   - The same check runs in CI, so an edited block cannot merge unnoticed.

### 9h. Importing memory from each harness (proposed)

Each harness's own memory can be brought into ACP's shared memory, so every
agent can use it:
- **Files ACP can read directly:** `CLAUDE.md` and Claude Code's auto-memory
  folder; `AGENTS.md` and Codex's `~/.codex/memories/`; OpenCode's
  `AGENTS.md`. Past chats (`~/.claude/projects/`, `~/.codex/sessions/`) can
  be summarised into checkpoints on request.
- **What Codex keeps (checked on the maintainer's machine 2026-11-11):**
  `~/.codex/memories/` is a Git-tracked folder with `memory_summary.md` (a
  short index: user profile, preferences, tips, then one section per project
  folder), `MEMORY.md` (detailed notes grouped by task, with "Reusable
  knowledge" and "Failures and how to do differently"), and
  `raw_memories.md`. Turned on by `[memories] generate_memories` and
  `use_memories` in `config.toml`. Chats are in `~/.codex/sessions/`.
  ACP can read the summary and the per-project sections directly.
- **Vendor-to-vendor import already exists one way:** ChatGPT/Codex's
  Settings › Import brings in Claude Code projects (it just points at the
  same folders), chat sessions, plugins and MCP servers. A session is
  copied from Claude Code's transcript file into a new Codex chat; the
  import log (`~/.codex/external_agent_session_imports.json`) records only
  the source file, a hash and the new chat id. Claude Code's own memory
  folder is not offered for import. ACP differs by being shared both ways
  and keeping one copy instead of duplicating chats into each app.
- **Chat apps (Claude.ai, ChatGPT):** no API for memory. The user exports or
  copies it (for example with Claude's import-memory prompt) and pastes it in.
- Every imported item is a proposal the user accepts, edits or rejects; it
  keeps its source (which harness, which file, when), is scanned for secrets
  first, and is sorted into a layer (user, project, path rule).

### 9i. Preview captures as evidence (decided 2026-11-11)

How captures work:
- The preview browser can take screenshots and screen recordings. The user
  can take them, and agents can through ACP's server
  (`preview_screenshot`, `preview_recording_start`, `preview_recording_stop`).
- An agent attaches them to its patch report as proof the change works.
  They count as evidence, separate from the agent's own claims (ADR-0004).
- The user can draw on the preview and dictate a note to show what is wrong;
  that goes back to the task as feedback.
- Captures are saved in `.acp/local/captures/` (not committed) and deleted
  after a number of days the user sets (default 14). A report whose capture
  was deleted says so instead of showing a broken link.

### 9j. Name

The project is **Agent Control Plane**, shortened to **ACP**. Repository:
`agent-control-plane`.

### 9k. Design skills are built in, not something you call (decided 2026-11-12)

Problem: AI front-end work is sloppy unless the user knows which skill to
call and how to prompt. Most users do not. So for a design task, ACP attaches
high-end front-end skills on its own.

- **Detecting a design task:** the task's scope touches front-end files
  (`*.css`, `*.html`, `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, Tailwind or theme
  config), or the request asks for a page, screen, component or visual
  design. The orchestrator may also mark a task as design work.
- **Attaching:** ACP places the skills in the task's own worktree, in the
  folders each agent already reads (`.claude/skills`, `.agents/skills`), and
  lists them in `.git/info/exclude` so they are never committed. The user's
  repository is not touched. Agents that do not read skill folders get the
  skill's short instructions in the task context instead.
- **Only when needed:** skills attach to design tasks only, so other tasks
  keep their context small (non-negotiable 2).
- **Checked afterwards:** the review step runs the design library's
  anti-pattern rules on the patch, so poor output is caught, not only
  discouraged.
- **User control:** on by default. A project can turn it off, pick which
  skills apply, or add its own. The design library's styles (ADR-0007) are
  the same mechanism with a style chosen.
- **We do not write our own pack.** ACP ships existing skills whose licence
  allows it, each pinned to a reviewed commit. A skill is instructions an
  agent follows with the user's permissions, so updates are reviewed like
  code and never pulled automatically.

Licences, read from each repository on 2026-11-12:

| Skill | Repository | Licence | Decision |
|---|---|---|---|
| Impeccable | `pbakaus/impeccable` | Apache-2.0 | Ship as the default. Keep its `LICENSE` and `NOTICE` |
| Huashu Design | `alchaincyf/huashu-design` | MIT (changed from a stricter licence in 2026) | Ship, for prototypes and motion. Pin the commit; re-check the licence on update |
| Awwwards | `juliobsz/skills` | MIT | Ship the skill files only. Its installer sends usage data, so ACP does not run it |
| Awwwards (other) | `tponscr-debug/claude-skill-awwwards` | No licence file | Cannot ship. Users may add it themselves |
| Be ambitious | `az9713/be-ambitious-skill` | MIT | Optional: it rewrites a prompt to aim higher. Small enough to review fully |
| 21st.dev Magic | `21st-dev/magic-mcp` | ISC | Not bundled. It is a hosted service that needs the user's own API key; offer it as a connector |
| Open Generative AI | `Anil-matcha/Open-Generative-AI` | MIT | Not a design skill. It is an image and video studio; a later option for generated media |
| "watch", "muse agent" | not identified | unknown | Need a link from the maintainer |

Anthropic's own `frontend-design` skill, which Impeccable builds on, has no
licence file at the top of `anthropics/skills`; check that skill's own folder
before shipping it separately.

### 9l. The mistake guard (proposed 2026-11-12)

ACP already saves review findings and agent failures as lessons, turns them
into candidate upgrades the user approves, and includes the approved index in
every task (v0.3.1). What is missing is choosing the lessons that matter for
*this* task. The guard adds that.

- **A rule is small and specific:** what went wrong (with the evidence), the
  fix, the paths it applies to, and the task it came from. Optionally a
  `check:` command or pattern that can detect the mistake.
- **Where rules live:** approved rules are path rules in `.acp/rules/`
  (§9g), so they are in Git, reviewed like code, and shared by every agent
  and teammate. Personal ones stay in the user layer.
- **Before a task (the guard):** ACP matches the task's files and words
  against the rules and gives the agent only the few that match, under
  "Past mistakes here", inside a 2 KB budget. Matching is by path and
  keyword, with no model call, so it is free and repeatable.
- **After a task:** rules with a `check:` run in review as deterministic
  evidence. A rule without one is advice to the agent, not enforcement, and
  the interface says so.
- **Writing a rule:** when a check fails or the user rejects a patch and a
  fix follows, ACP drafts the rule. Nothing becomes a rule until the user
  approves it.
- **Keeping the list short:** ACP counts how often each rule was shown and
  how often its check caught something. Rules that have not matched for a
  long time are proposed for removal.

### 9m. Clients: web app, desktop app and terminal on one server (decided 2026-11-12)

- One ACP server runs on the user's machine and owns the agents, worktrees,
  memory and Git. It is the only part that touches the project.
- **Web app:** the interface, opened in a browser at `127.0.0.1`. Built once.
- **Desktop app:** Electron, wrapping the same web app and starting the
  server for the user (§5).
- **Terminal:** the `acp` command, talking to the same server, so a thread
  started in one client continues in another.
- A hosted web address and a phone app need a relay and sign-in, so they come
  later with the optional account (§9a).
- ACP is built in this repository as its own codebase.

### 9n. Thread and safety features (decided 2026-11-12)

- **Permission modes** per thread: supervised, auto-accept edits, full
  access. Supervised is ACP's default, because the human gate is the point.
- **Fork a thread** and **side chat** (ask about a thread without adding to
  it).
- **Visual replies:** an agent may answer with a sandboxed HTML page shown in
  the thread.
- **Secret request card:** when an agent needs a credential, the user types
  it into a private card; it never enters the chat, memory, checkpoints or
  logs (non-negotiable 11).
- **A cheap model for small text:** thread titles, commit messages and pull
  request text.
- **Scenarios:** a real-app test that fails before a fix and passes after,
  kept as evidence.
- **Outside agents:** ACP's MCP server lets agents ACP did not start (for example
  Claude Code or Codex in a terminal) read and write ACP memory.
- Later: scheduled tasks, remote access, more Git hosts than GitHub.

### 10. Order of work

Done: CI, Docker, the public repository and the `dev` → `main` flow.

Build order from 2026-11-12. Each milestone is usable on its own.

1. **Memory core.** `.acp/` layered memory, path-rule matching, the mistake
   guard's matcher, the `AGENTS.md` block with hash and size budget, CLI
   commands, tests (§9g, §9l).
2. **ACP MCP server.** Memory read and search, checkpoint write, hand a task
   to another agent. Works from Claude Code and Codex straight away
   (§9e, §9n).
3. **Agent runtime.** Start Claude Code, Codex and OpenCode in worktrees;
   threads made of tasks; permission modes (§9b, §9n).
4. **Web app.** Rebuild the interface from the design canvas: thread, task
   rows, review, usage. Design skills attach on their own (§9k).
5. **Terminal.** The `acp` command with the same threads.
6. **Desktop app.** Electron around the web app; signing.
7. **Thread extras.** Forks, side chats, visual replies, preview captures,
   secret request card (§9i, §9n).
8. **Remote.** Optional account, hosted web address, phone.

## Consequences

- Contributors can propose anything, but nothing reaches `main` without
  passing checks and the maintainer's review.
- Signing the macOS app costs US$99 a year; without it, users see a
  Gatekeeper warning.
- Accepting reports from people without GitHub accounts needs a small
  hosted function and spam protection.

## Action items

1. [x] CI workflow: typecheck, build, test (`.github/workflows/ci.yml`).
2. [x] Pull request template in the patch report shape.
3. [x] Create the GitHub repository, push, add `CODEOWNERS` and the `main` ruleset (2026-11-11).
4. [ ] Docker: GHCR images. (Done: health check, `compose.yaml`, CI build and smoke test.)
5. [ ] Secret scanning, dependency audit, CodeQL.
6. [ ] Pull request size labels and context budget check.
7. [ ] Website previews on Cloudflare Pages; Docker image per pull request.
8. [ ] Issue forms, labels, website and app "Report a problem" form.
9. [ ] `SECURITY.md`. (Done: `README.md`, `CONTRIBUTING.md`, `LICENSE`.)
10. [ ] Electron desktop app; signing and notarisation.
11. [ ] Download page with operating-system detection and install commands.
12. [ ] Git host view in ACP.
13. [ ] Rebuild the website, desktop app and terminal designs.
14. [ ] Optional ACP account with Clerk (remote access, phone app), only when needed (§9a).
15. [ ] Layered memory: folder-level `AGENTS.md` blocks and `.claude/rules/` files; proposing hand edits back into `.acp/`. (Done: the four layers, path rules, root `AGENTS.md` block, `CLAUDE.md` import, secret scan, CI check; see `docs/guides/memory.md`.)
16. [ ] Mistake guard: run `check:` rules in review; draft rules from failed checks; count how often each rule matches. (Done: matching rules to a task before it starts.)
17. [ ] Built-in design skills: block approval on findings in the review screen; pick a style. (Done: the anti-pattern check after a design run and `design:check`; a project's own skills in `.acp/skills/`; the three licensed skills at pinned commits, instruction files only; detecting design tasks; attaching to a run's worktree; see `docs/guides/design-skills.md`.)
18. [ ] ACP MCP server: attach it automatically to agents ACP starts; hand-off, project activity and design-library tools. (Done: the server over stdio with memory read and search, rule proposals the user accepts, and checkpoints; see `docs/guides/mcp.md`.)
21. [ ] Agent runtime: threads of tasks, live progress, approvals, usage. (Done: find Claude Code, Codex and OpenCode, read their sign-in, run one request in a worktree with memory, sent privately on standard input, with a time limit; list and clean up runs; see `docs/guides/agents.md`.)
19. [ ] Web app, terminal and desktop clients on one server (§9m).
20. [ ] Permission modes, forks, side chats, visual replies, secret request card (§9n).

Design canvas (website Home, Download, Docs, Security, Report a problem;
desktop app; terminal), updated 2026-11-11:
https://claude.ai/artifact/UCtkA4QzDL5vdkdBD3stdS
