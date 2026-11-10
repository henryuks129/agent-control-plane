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

- Contributors fork the repository or work on a branch and open a pull
  request. Nobody pushes to `main` directly.
- A GitHub ruleset on `main` requires: a pull request, all required checks
  passing, one approval from a code owner (`.github/CODEOWNERS` names the
  maintainer), a linear history, and no force pushes or deletions.
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
  the web interface. T3 Code makes the same choice.
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
  triage sets the final one. Triage can be done by an ACP agent, following
  the "automated issue flow" T3 Code uses, with the maintainer confirming
  any `priority:p0`.

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

### 10. Order of work

1. CI and Docker setup, step by step (`docs/guides/ci-setup.md`).
2. A detailed `README.md` and `CONTRIBUTING.md`.
3. Rebuild the website, desktop app and terminal designs from ADR-0007 and
   this ADR.

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
3. [ ] Create the GitHub repository, push, add `CODEOWNERS` and the `main` ruleset.
4. [ ] Docker: health check, `compose.yaml`, CI build and smoke test, GHCR images.
5. [ ] Secret scanning, dependency audit, CodeQL.
6. [ ] Pull request size labels and context budget check.
7. [ ] Website previews on Cloudflare Pages; Docker image per pull request.
8. [ ] Issue forms, labels, website and app "Report a problem" form.
9. [ ] `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`.
10. [ ] Electron desktop app; signing and notarisation.
11. [ ] Download page with operating-system detection and install commands.
12. [ ] Git host view in ACP.
13. [ ] Rebuild the website, desktop app and terminal designs.
