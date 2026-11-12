# ADR-0007 — Shared memory, Agent Exchange and orchestrator mode

**Status:** Proposed (revised 2026-11-10)
**Date:** 2026-11-09
**Deciders:** henryuks (product owner)

## Context

ACP users already pay for coding agents (Claude Code, Codex, Antigravity,
OpenCode) and have access to free API models (NVIDIA Nemotron, DeepSeek,
MiniMax) and local models (Llama and others through Ollama). Each tool keeps
its own conversation memory, so:

1. **Moving work between tools is manual.** The user copies chat history from
   Codex to Claude, or from OpenCode to Claude.
2. **Long sessions burn tokens.** Model APIs are stateless: every turn re-sends
   the conversation as input. When the window fills, the tool *compacts* — a
   model reads the whole history and writes a summary — which costs a large
   call and loses detail.
3. **Closed sessions lose work.** Closing a temporary chat discards anything
   not written somewhere durable.
4. **Hand-over is fragile.** When one model stops (budget, error, rate limit)
   the next one has to rediscover direction and scope, and can drift.
5. **Expensive models do cheap work**, and tools such as browser or computer
   use are locked to the vendor that ships them.

ACP already has the right primitives: compact checkpoints
(`docs/protocols/checkpoint.md`), task-scoped context packs (ADR-0002), model
routing with health (ADR-0006), worktree isolation and human-gated patches.

### Product direction (decided 2026-11-10)

- **Free.** ACP charges nothing. Users bring their own subscriptions, API keys
  and local models, used from one interface (desktop app and terminal).
- **Plain ACP account.** No GitHub sign-in and no organizations in this phase.
- **A front end over existing agent CLIs.** What ACP adds is shared memory,
  orchestration and governed hand-over.

### Forces

- Token cost and latency dominate; anything we add must *reduce* tokens per turn.
- The system must feel fast: no extra model call on the hot path unless it saves more than it costs.
- Paid agents are driven through their official CLIs/SDKs under the user's own sign-in, within each vendor's terms.
- Secrets must never enter memory (AGENTS.md rule 11).
- User data is the user's; no training use without explicit, revocable opt-in.

## Decision

Make ACP the **system of record for agent memory**, stored wherever the user
chooses and exposed to every connected agent. Add an optional **orchestrator
mode** in which one or two paid agents plan and delegate to other models by
capability, and an **Agent Exchange** that moves a task between models through
a deterministic `handoff.md`.

### 1. Connected agents and models

| Kind | Examples | How ACP reaches it | Can orchestrate |
|---|---|---|---|
| Subscription agents | Claude Code, Codex, Antigravity, OpenCode | The vendor's own runtime on the user's machine, signed in by the user (see below) | Yes |
| API models | Nemotron, DeepSeek, MiniMax, any OpenAI-compatible API | User's API key in `.env` / OS keychain | No (worker) |
| Local models | Llama, Qwen via Ollama or llama.cpp | Local HTTP endpoint | No (worker) |

Every entry in the model registry carries **capabilities** (reasoning,
thinking, code, vision, image generation, video, long context, local/private)
and health (ADR-0006). Orchestrators see this registry, so they can choose the
right model for each task.

**How subscriptions are connected.** ACP never reads,
stores or forwards a subscription token. It launches the vendor's own runtime
and the vendor handles sign-in:

| Agent | Runtime ACP launches | Sign-in |
|---|---|---|
| Claude Code | The user's installed `claude` CLI / Agent SDK | `claude auth login`, kept by Claude Code |
| Codex | Codex app-server / `codex` CLI | "Sign in with ChatGPT" (official plan sharing) or `codex login` |
| Antigravity | Google's official Antigravity agent from the Agent Client Protocol registry — not the Antigravity IDE login | The agent's own Google sign-in, or a Gemini API key |
| OpenCode | The user's installed `opencode` | Whatever providers the user configured |

Each vendor can change what it allows; the provider settings screen links to
the vendor's terms and offers an API-key fallback for every agent.

### 2. Orchestrator mode (optional)

- The user selects **zero, one or two** orchestrators from their subscription agents.
- **Zero:** the user talks to one agent directly (or `@agent` to pick). No delegation.
- **One** is a full mode, not a fallback: one paid agent plans and delegates to
  free and local models on its own. Two adds a second opinion during planning.
- **One or two:** on each prompt the orchestrator(s) discuss, agree on goals and
  tasks (a validated DAG, as today), and assign each task to a model from the
  registry by capability — frontend to a vision-capable model, small edits to a
  fast model, hard logic to a reasoning model, tests to a local model.
- **Quality gate:** if a task fails its tests or review, an orchestrator takes
  it over through Agent Exchange (below) and finishes it.
- `@agent` mentions pin a task to a specific agent; they never bypass scope,
  budget or the human patch approval.
- **Parallel work:** independent DAG nodes run at the same time, each in its
  own worktree. The default limit is 4 running tasks, and users can raise it.
  Free tiers' rate limits and the machine's CPU and memory set the real ceiling.
  Each patch goes through the same gates as one agent's patch: deterministic
  checks (typecheck, build, tests, Fallow), the patch scope guard, the
  optional CodeRabbit review, the LLM reviewer (evidence separate from
  judgment), and human approval. Secret, dependency and security scanners are
  added in §8a. Approved patches merge **one at a time** through a merge queue,
  with checks re-run on the merged result. A failed or conflicting patch goes
  back to its agent or to an orchestrator; it never blocks the others.

- **Plan limits drive routing.** ACP shows each connected plan's usage
  windows (for example 5-hour and weekly) as the vendor reports them, and the
  orchestrator routes away from a plan near its limit before it runs out,
  instead of failing mid-task. Readings come from the vendor's own runtime or
  usage endpoint for the user's sign-in; each vendor can meter different
  account types in different places (Google, for example, meters personal and
  business Antigravity accounts on different hosts), so each adapter needs
  tests with real readings.

### 3. Agent Exchange and `handoff.md` (replaces compaction)

When a model runs out of budget, fails, or is swapped, ACP writes or updates
the task's `handoff.md` **deterministically** from structured state — task
ledger, checkpoints and Git — with no LLM summary of the transcript:

```text
# handoff.md · v3
from DeepSeek Flash → to Codex · 820 tokens
goal      Account API
scope     src/api/account/**
done      schema, routes (commit a1b2c3)
failing   tests/account.test.ts:41
next      hash the password before saving
don't     add dependencies; rename routes
decisions ADR-0003, ADR-0007
```

Detail is pulled on demand (`memory.search`, `git show`), never pre-loaded.

**Readback guard:** before its first write, the incoming model restates goal,
scope and next action. ACP checks it against `handoff.md` (paths ⊆ scope, next
action matches). Mismatch → re-prompt once, then escalate to an orchestrator.

### 4. Memory: the user's data point

The user chooses where shared memory lives:

| Option | Storage | Notes |
|---|---|---|
| **ACP storage** (default) | Local SQLite + artifact folder on the user's machine | Zero setup; free to operate |
| **A folder the user picks** | Markdown + SQLite in that folder | Open, sync and back up with the user's own tools |
| **The user's own database** | PostgreSQL or SQLite connection | ACP reads/writes through the `contracts.ts` interfaces |

Memory contents:

| Layer | What it holds | Loaded |
|---|---|---|
| Project brief | Mission, stack, conventions, non-negotiables (< 1.5k tokens) | Every session start |
| Decisions | ADR-style decisions | When the task touches one |
| `handoff.md` | One per task | On Agent Exchange / resume |
| Checkpoints | Per-node progress | On resume |
| History | Append-only log of prompts, tool calls, results, diffs (secrets redacted) | Searched, never sent whole |

History is what keeps work from closed chats. It only covers sessions that
run through ACP.

### 5. Tools and `knowledge.md`

- **Inside ACP:** tools are offered to every model by **native function
  calling** and **skills** (Markdown instructions plus optional scripts,
  loaded on demand). Command-line tools and code execution are allowed in the
  task worktree.
- **Who brings the tools and sub-agents** depends on how the model is run:

  | Run as | Tools and sub-agents come from | ACP provides |
  |---|---|---|
  | A vendor agent (Claude Code, Codex, Antigravity agent) | The vendor: its sub-agents, skills, MCP servers, shell, web tools | Task, `handoff.md`, memory tools, design skills |
  | A free model **inside OpenCode** (OpenCode Zen free models, NVIDIA, DeepSeek, Ollama) | OpenCode's agent loop: file edits, shell, its sub-agents | Same as above |
  | A bare API model (no harness) | Nothing — an API model only returns text | The whole loop: file read/edit, shell (sandboxed, §9), browser and computer use |

  Running free models through OpenCode is the recommended path: ACP gets a
  working agent loop without building one. The bare-API path stays for
  reviewers, planners and small, text-only tasks.
- **Shared tools:** ACP ships its own browser, computer-use and terminal tools
  for bare API models. Vendor-built features stay with their vendor; ACP
  provides equivalents rather than re-exporting them.
- **Outward:** one `acp mcp` server (≤10 tools: `memory.brief`,
  `memory.handoff`, `memory.search`, `memory.record`, `checkpoint.save`,
  `task.next`, `ask`) for clients that connect over MCP. ACP does not install
  third-party MCP servers or plugins automatically.
- **`knowledge.md`:** generated from the registry; lists models and their
  capabilities, skills, shared tools, MCP servers and plugins. `acp knowledge
  export` writes it (and `AGENTS.md` / `CLAUDE.md` pointers) into a project.

### 6. Design library as skills

- Import a reference: image, video, motion file, Figma file or link.
- ACP extracts a spec: colors, type, spacing, radius, motion and a component list
  (key frames and timing for video/motion; computed styles for links).
- ACP suggests a style category (minimal, brutalist, futuristic, floral, motion,
  …); the user confirms. A reference may have several tags.
- Each accepted reference — and each category — becomes a **skill**. Selecting
  it in the composer attaches the skill automatically.
- Governance stays as ADR-0005: imports are candidates until accepted; the
  style is extracted, other sites are not copied wholesale.

### 7. Caching

- **Primary:** provider prompt caching. Requests are ordered stable-first
  (brief → `knowledge.md` → decisions → `handoff.md` → volatile), so repeated
  prefixes are cheap and fast.
- **Answer cache:** not a headline feature. Optional, off by default, exact-match
  only, read-only questions only, keyed to commit and context, never for code.

### 8. Observability and evals

- Every prompt gets a trace ID; each model call, tool call, route decision and
  Agent Exchange is a span (OpenTelemetry GenAI conventions), stored in the
  user's memory store and shown in the app and terminal.
- A golden-task eval suite runs before any change to prompts, routing rules,
  context building or the model registry is promoted (`upgrade:*` lifecycle).
  Track pass rate, tokens per task, latency p50/p95, exchange rate.

### 8a. Review and safety checks

What exists today (v0.5):

| Check | Where | Catches |
|---|---|---|
| Typecheck, build, tests | `src/reviews/engine.ts` | Broken code |
| Fallow audit | `src/reviews/engine.ts` | Unused code, duplicates, complexity |
| Patch scope guard | `src/git/worktrees.ts` | Edits outside the task's paths, `..` and absolute paths |
| LLM reviewer | `src/reviews/llm.ts` | Bugs, duplicates, dead code, architecture, design, security, performance — as findings that keep evidence and judgment apart |
| CodeRabbit (optional) | `src/reviews/engine.ts` | External review |
| Encrypted credentials | `src/security/secrets.ts` | Keys stored at rest (AES-256-GCM) |
| Human patch approval | dashboard and CLI | Nothing merges unseen |

To add:

- **Secret scanning** of every patch (for example gitleaks) — blocks merge.
- **Dependency audit** (`npm audit` or OSV-Scanner) when a patch changes a lockfile.
- **Static security analysis** (for example Semgrep rules) on changed files.
- **AI-slop checks**, mostly deterministic: new dependencies not asked for,
  new files or components when the registry already has one, comments and
  docs that repeat the code, deleted or skipped tests, unusually large diffs
  for the task size. Fallow and the design registry cover part of this.

Vendor reviewers (judgment, not evidence):

- When the orchestrator is a paid agent, ACP also asks that agent's own
  reviewer to check each patch: Claude Code's code review and security review,
  Codex's review. Their output is stored as findings marked
  `source: vendor-review`, next to the deterministic evidence, never in place
  of it. A vendor review can block a merge only through a finding the user
  accepts.

Repository rules that catch AI slop:

- **Project lint rules** run as a deterministic check: no low-value comments
  (comments that repeat the code, divider lines, commented-out code), every
  lint or type suppression needs a reason, no skipped tests or raised test
  timeouts without a reason, no polling or real-time waits in tests.
- **Context budget check:** CI measures how many tokens the agent
  instructions, `knowledge.md` and tool descriptions cost, and fails when a
  change grows them without an explicit label.
- **Patch size label** (XS–XL) on every patch, so large patches for small
  tasks stand out.
- **Prompt evals:** any change to prompts, tool descriptions or `handoff.md`
  format runs a small eval suite (real model, real cases from past failures,
  plus control cases) before it is promoted.

- **Patch report.** Every patch carries a short report in a fixed shape:
  Problem, Change, Scope, Verification. Verification lists the commands that
  ran and their results, including a run on the old code that fails where
  the new code passes. This is the evidence half of review; the model's
  explanation is the judgment half.

Review views:

- **Diff view** per task and per turn, plus the merged result of the queue.
- **Pull-request review** inside the app for projects that use a Git host,
  optional, since sign-in does not require GitHub.
- **Review guides:** a model writes a short, ordered walk-through of a large
  change (what to read first, why each part changed, where the risk is),
  linking each stop to the evidence. Reviewers comment line by line along the
  way.

### 8b. Guard rails, loops and recursion

What exists today (v0.5):

| Guard | Where |
|---|---|
| Per-task budget: max tokens, max requests, max minutes | `resolveBudget` in `src/agents/runtime.ts` |
| At most 2 model attempts per task node | `src/agents/runtime.ts` |
| Task graph must have no cycles | `src/core/planner.ts` |
| Queue jobs have a max attempt count | `src/storage/db.ts` |
| Request timeouts; unhealthy models marked degraded | `src/models/nvidia.ts`, `src/agents/orchestrator.ts` |
| Concurrency limit | `ConcurrencyManager` |
| Patch lifecycle: validated → approved → applied; nothing commits or pushes on its own | `src/agents/orchestrator.ts` |

To add for orchestration:

- **Depth limit 1.** Only orchestrators delegate. Workers cannot create new
  ACP tasks; a vendor agent may use its own sub-agents inside its task, under
  that task's budget.
- **Exchange limit.** A task can change hands at most twice (worker → worker
  → orchestrator). After that it stops and asks the user.
- **Loop detection.** Stop a task when the same test fails with the same error
  twice in a row, the same diff is produced twice, or the same tool call
  repeats 3 times with the same arguments.
- **Run budget.** A cap on total tokens, requests and minutes for the whole
  prompt, on top of per-task budgets; free-tier rate limits count toward it.
- **Replanning limit.** Orchestrators may replan a prompt at most twice.
- **Tool-call limit** per task for bare API models (default 40).
- **Stop button** in the app and `Ctrl-C` in the terminal cancel every running
  task and keep their checkpoints.

### 9. Command sandbox (later phase)

Worktrees isolate **files**, not **processes**: a command run in a worktree can
still read the user's home folder, use the network and install packages. For
commands written by API or local models, ACP will run them in a container:

- Docker or Podman where installed; Apple's `container` tool on macOS 26+.
- The task worktree is the only mounted folder; no home folder, keychain or SSH keys.
- Network off by default, or allow-listed to package registries.
- CPU, memory and time limits; the container is thrown away after the task.
- Secrets are never passed in (AGENTS.md rule 11).

Subscription agents keep using their vendor's own sandbox and permission modes.
Worktrees stay the unit of isolation for code; the sandbox is added around them.

### 10. Data use

User data is never used for training by default. Any future training or
distillation use requires explicit, revocable opt-in and must respect each
upstream model provider's terms. Improving lower models starts with better
context (tight `handoff.md`, retrieved examples of successful tasks), not
fine-tuning.

## Options considered

### Option A — `handoff.md` file only, maintained by the agents
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | Very low |
| Scalability | Poor — one LLM-written file, conflicts between parallel agents |
| Team familiarity | High |

**Pros:** works with every tool today; human-readable.
**Cons:** model-written so it drifts and bloats (the same flaw as compaction);
no search, history or scope enforcement.

### Option B — ACP memory with user-chosen storage, deterministic `handoff.md`, orchestrator mode (**chosen**)
| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | Free to operate (local by default) |
| Scalability | Good per user; storage adapters allow the user's own database |
| Team familiarity | Medium — builds on Store, checkpoints and router |

**Pros:** one memory for every agent; cheap, verifiable hand-over; reuses
existing checkpoint, routing and patch-gate code; user owns the data.
**Cons:** must build CLI/SDK adapters per subscription agent; history only
covers sessions routed through ACP.

### Option C — Hosted memory / vector database as the core
| Dimension | Assessment |
|---|---|
| Complexity | Medium–High |
| Cost | Ongoing hosting cost per user — conflicts with a free product |
| Scalability | High |
| Team familiarity | Low |

**Pros:** semantic search out of the box; works across devices.
**Cons:** conflicts with local-first (ADR-0001) and the free model; similarity
search alone does not give the structured scope/next-step state that prevents
drift.

## Trade-off analysis

The core problem is "send fewer, better tokens", not "store more memory".
Option A trusts a model-written summary, which is what compaction already does.
Option C costs money per user and still lacks structure. Option B keeps
structured state as the spine, lets users choose where it lives, and adds
search only for recall — free to run and consistent with ADR-0001.

## Consequences

- **Easier:** switching tools mid-task; resuming without compaction; using free
  and local models safely under paid orchestrators; reusing design references.
- **Harder:** maintaining adapters for each subscription agent's CLI as they
  change; keeping the MCP tool surface small; reliable secret redaction in history.
- **Revisit:** whether a hosted sync option is wanted later; vendor terms for
  automated use of subscriptions; answer-cache value after eval data.

## Relationship to other documents

- **Supersedes for now:** the organization, membership and tenancy scope in
  `docs/product/acp-v0.6.md`, and GitHub OAuth from the HNG launch MVP (its
  notes are no longer in the repository). The existing `src/auth/github.ts` and tenancy types are deferred, not part of
  this phase.
- **Builds on:** ADR-0001 (local-first), ADR-0002 (context on demand),
  ADR-0003 (provider-agnostic), ADR-0005 (design-library governance),
  ADR-0006 (model registry, health and routing).

## Action items

1. [ ] Model registry: add capability tags and a `kind` (subscription / api / local); add an OpenAI-compatible client and an Ollama client.
2. [ ] Subscription adapters for Claude Code and Codex via their official headless modes; then Antigravity and OpenCode.
3. [ ] Deterministic `HandoffWriter` producing `handoff.md` from task ledger + checkpoints + Git; replace transcript-style context in `AgentRuntime`.
4. [ ] Agent Exchange: readback guard, failure/budget triggers, orchestrator take-over.
5. [ ] Orchestrator mode: 0–2 orchestrators, discussion step, capability-based assignment, `@agent` mentions.
6. [ ] Memory storage adapters: ACP storage (default), user folder, user PostgreSQL/SQLite.
7. [ ] Shared tools (browser, computer use, terminal) via function calling; `acp mcp` server; `acp knowledge export`.
8. [ ] Design library import pipeline → spec → style tags → skills.
9. [ ] Tracing spans and trace views in app and terminal; golden-task eval suite wired into `upgrade:validate`.
10. [ ] Update `docs/product/acp-v0.6.md` to mark the deferred scope.
11. [ ] Antigravity and other agents through the Agent Client Protocol registry (Google's official agent), with API-key fallback.
12. [ ] Container sandbox for commands from API and local models (section 9).
13. [x] Name: keep **ACP — Agent Control Plane** for now. Always write it out in full in docs and on the site, because "ACP" alone also means the Agent Client Protocol. Options are kept in `docs/product/naming.md`.
14. [ ] Run free models through OpenCode by default; keep the bare-API path for review and planning.
15. [ ] Parallel runner with a concurrency limit and a serial merge queue that re-runs checks after each merge.
16. [ ] Publish and maintain `docs/guides/free-models.md`; show it in onboarding.
17. [ ] Add a LICENSE file; the project is open source but the repository has none yet.
18. [ ] Secret scanning, dependency audit, static security analysis and AI-slop checks as merge gates (§8a).
19. [ ] Diff view, in-app pull-request review and model-written review guides (§8a).
20. [ ] Vendor reviewers as a finding source; project lint rules for AI slop; context budget check; patch size labels; prompt evals (§8a).
21. [ ] Depth, exchange, loop, run-budget, replanning and tool-call limits, plus a stop button (§8b).
22. [ ] Plan usage windows per connected agent, used by routing (§2).
23. [ ] Patch report in the Problem / Change / Scope / Verification shape (§8a).
