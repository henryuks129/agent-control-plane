# ACP v0.6 — Remote Control Plane

## Goal

Evolve ACP from a trusted single-developer local control plane into a remotely
operable, multi-user service without weakening its safety model. Remote execution
must remain bounded, tenant-isolated, observable, and subject to the same human
patch approval requirements established in v0.4 and v0.5.

## Scope

1. **Remote deployment profile**
   - Provide a repeatable Oracle Cloud Infrastructure (OCI) deployment profile
     for the API, dashboard, worker, database, object store and observability
     dependencies.
   - Keep local mode as the default development and recovery profile. A remote
     deployment is an additional runtime target, not a replacement for local
     ownership of a project.
   - Load credentials from deployment-managed secrets only. Never copy API keys
     or repository credentials from a local `.env` into project settings,
     artifacts, logs, jobs or browser responses.

2. **Storage and state adapters**
   - Extract the existing SQLite and local-artifact implementations behind
     explicit state-store and artifact-store interfaces.
   - Retain SQLite plus the local filesystem as the development adapter.
   - Add a production metadata-store adapter and an OCI object-storage adapter.
     The object store holds artifacts only; durable task, tenancy, approval and
     accounting records remain queryable metadata.
   - Every artifact is addressed by tenant and project before it is addressed by
     task or object key. A request can never use a raw path or object key to
     cross that boundary.

3. **Durable worker queue**
   - Move remote task-node execution to a durable queue with explicit job
     states, leases, heartbeats, cancellation, retry limits and a dead-letter
     outcome.
   - Preserve the validated DAG as the authority for eligibility. A queue
     message may execute only a ready node for its own task, tenant and project.
   - Workers receive narrowly scoped, short-lived credentials and use isolated
     worktrees. They may create a patch artifact, but cannot approve, apply,
     merge, push, or modify another tenant's repository.

4. **Authentication and multi-user tenancy**
   - Use standards-based OIDC authentication with a pluggable identity-provider
     adapter. ACP stores the minimal identity and membership data required for
     authorization; it does not store user passwords.
   - Add organization, project and membership boundaries, with roles for
     viewer, operator and administrator. Patch approval requires an authorized
     human operator and is recorded as an immutable audit event.
   - Apply tenant and project authorization to every API, queue job, artifact,
     review finding, learning candidate, usage record and observability query.

5. **Observability and usage accounting**
   - Emit structured logs, metrics and traces with request, task, node, worker,
     tenant and project correlation identifiers. Secret values and raw prompts
     are excluded by default.
   - Record model/provider requests, token estimates or reported usage,
     duration, retries, queue time, worker time, artifact bytes and external
     review calls. Usage is an auditable record first, not billing automation.
   - Provide operator views for queue health, failed jobs, model/provider health,
     per-project limits and usage summaries.

## Decisions required before implementation

These are deliberately design gates, not hidden assumptions:

| Decision | Default direction | Why it must be confirmed |
| --- | --- | --- |
| OCI runtime | Containerized API and worker services with managed secrets | Determines network, identity and deploy automation boundaries. |
| Production metadata store | Managed PostgreSQL-compatible relational database | Multi-user task state, locks, audit records and accounting need stronger shared-runtime guarantees than local SQLite. |
| Queue provider | Durable managed queue behind ACP's own queue interface | The provider affects delivery semantics, leases and dead-letter operations. |
| Identity provider | OIDC adapter, provider selected during deployment setup | Avoids implementing password storage and keeps enterprise identity portable. |
| Repository access | Explicit per-project credential integration, read-only until separately approved | Remote cloning, push and pull-request workflows remain outside v0.6 unless promoted deliberately. |
| Data retention | Configurable tenant retention for artifacts, logs and usage records | Needed before remote data is collected. |

## Delivery order

### V0.6-1 — Domain contracts and tenancy model

Define organization, membership, project, actor, audit event, queue job and
usage-record contracts. Extract state-store, artifact-store, queue and identity
interfaces without changing the local adapter behavior.

**Exit checks:** existing local tasks and artifacts continue to work; every
remote-facing record carries tenant and project ownership; secret scanning shows
no credentials in persisted settings, API responses or logs.

### V0.6-2 — OCI deployment and durable stores

Add a documented OCI profile, production metadata migrations, object storage,
managed secrets and environment validation. Run the dashboard/API in a
non-production remote environment before enabling workers.

**Exit checks:** deployment is reproducible; database and object-store access is
tenant-scoped; local mode remains usable with no cloud account; restoring a
deployment does not lose task, approval or audit state.

### V0.6-3 — Worker queue and isolation

Add queue submission, lease/heartbeat handling, cancellation, bounded retry and
dead-letter outcomes. Workers execute only validated ready nodes in per-job
isolated worktrees.

**Exit checks:** duplicate delivery is idempotent; expired workers are recovered
without replaying completed nodes; concurrency and per-model budgets remain
enforced; a worker cannot approve or apply a patch.

### V0.6-4 — OIDC, authorization and audit trail

Add authentication, organization/project membership, role checks and immutable
audit events. Add tenant-scoped APIs and dashboard sessions.

**Exit checks:** cross-tenant requests are denied; viewers cannot run, approve
or apply work; operators cannot administer unrelated projects; every approval
identifies its actor, time and patch artifact.

### V0.6-5 — Observability, limits and usage records

Add operational telemetry, dashboards, alerts, usage records and project-level
limits. Validate that telemetry remains useful while excluding secrets and raw
task context by default.

**Exit checks:** an operator can trace one task across API, queue and worker;
usage totals reconcile to recorded executions; provider failures are visible;
limits fail safely before work starts.

### V0.6-6 — Remote release hardening

Run recovery, authorization, tenant-isolation, queue-failure and patch-safety
scenarios in the remote profile. Publish a release checklist and rollback plan.

**Exit checks:** automated tests pass; a remote smoke run reaches a human-gated
patch decision; no release path permits automatic patch approval, application,
merge or remote Git push.

## Explicitly deferred

- Installable project bootstrap and broader provider/model adapters
- Autonomous upgrade execution beyond the existing human-governed candidate flow
- IDE integration
- Billing, invoicing and payment collection
- Automatic patch approval, patch application, merges, pull requests or remote
  Git pushes
- Password-based authentication

These are v1.0 or later concerns unless deliberately promoted through a new
product decision.
