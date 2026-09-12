# ACP v0.5 — Productized Local Control Plane

## Goal

Make ACP practical to operate across local repositories without weakening the v0.4 safety boundary: agents still work in task worktrees, patches still require validation and human approval, and secrets remain outside persisted project state.

## Scope

1. **Local repository onboarding and project profiles**
   - Register an existing Git repository by its local path.
   - Persist a project profile containing the display name, repository root, default branch, data/artifact locations and creation time.
   - Reject missing or non-Git paths. Do not clone, modify remotes, or upload repositories.

2. **Persistent provider and model settings**
   - Store non-secret profile preferences per project: enabled models, routing priorities, role preferences, timeouts and budgets.
   - Keep API keys in environment variables only. The settings UI and SQLite records must never contain API key values.
   - Validate a settings change before it becomes active and retain the previous valid configuration on failure.

3. **Artifact browser**
   - List task artifacts with type, source node, creation time and local path.
   - Preview safe text artifacts and patches; render generated images from their local artifact paths.
   - Do not expose arbitrary filesystem paths outside a registered project’s artifact directory.

4. **Visual task graph**
   - Render planned nodes and dependency edges in the local dashboard.
   - Show node state: pending, ready, running, completed, checkpointed, failed or blocked.
   - Keep graph actions separate from patch approval; viewing a graph never runs a task.

5. **Review and learning history**
   - Show deterministic, external and LLM review findings by task and time.
   - Show learning iterations and upgrade status with their human-approval state.
   - Preserve the existing rule that candidates cannot become approved or applied from the UI without a deliberate human action.

## Delivery order

### V0.5-1 — Project profile and onboarding

Add the project schema, SQLite persistence, CLI commands and local-path validation. Migrate the current ACP checkout into one profile without changing its existing `.data` records.

**Exit checks:** invalid paths are rejected; a valid local Git checkout is registered idempotently; no remote Git operation occurs; no secret appears in the profile database.

### V0.5-2 — Persistent non-secret settings

Add versioned project settings and validation for models, budgets and routing preferences. Runtime configuration resolves project settings over built-in defaults without changing `.env` secrets.

**Exit checks:** settings survive restart; invalid settings are rejected; API keys are absent from database and API responses; the previous valid settings remain usable.

### V0.5-3 — Artifact and history browser

Add read-only dashboard views and APIs for artifacts, findings, learning iterations and upgrades. Start with lists and safe previews before introducing rich media presentation.

**Exit checks:** entries are task-scoped; missing files are reported safely; patch preview remains read-only; approval state is visible.

### V0.5-4 — Visual graph and release hardening

Replace raw task-progress JSON with a graph view based on the validated task plan and checkpoint state. Add browser smoke tests and a v0.5 release checklist.

**Exit checks:** graph state matches CLI progress; no view can bypass patch validation or approval; typecheck, build, tests and local dashboard smoke test pass.

## Explicitly deferred

- GitHub OAuth, cloning, pull requests and remote pushes
- Hosted accounts, authentication, worker queues and billing
- Alternate object-storage backends
- NVIDIA video routing and generation
- Automatic patch approval or autonomous merging

These belong to later releases unless explicitly promoted into scope.
