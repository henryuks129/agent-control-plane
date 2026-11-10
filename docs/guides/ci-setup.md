# CI and container setup, step by step

This guide sets up the checks that guard ACP (Agent Control Plane)'s `main`
branch. Each step says what it does, why we need it, and how to check it
worked. Decisions behind it are in ADR-0008.

**CI** (continuous integration) means a fresh machine on GitHub runs our
checks every time someone opens or updates a pull request. A change can
merge only if every check passes. It catches mistakes a reviewer would
miss, and it runs the same way for everyone, human or agent.

## Step 1 — The check workflow ✅

File: `.github/workflows/ci.yml`

| Part | What it does | Why |
|---|---|---|
| `on: pull_request` and `push: main` | Runs on every pull request, and again after each merge | Pull requests are checked before merging; `main` is checked after, in case two merges conflict |
| `permissions: contents: read` | The job can read code, nothing else | If a step is compromised, it cannot push code or change settings |
| `concurrency` | A new push cancels the older run | Saves time; only the latest code matters |
| `runs-on: ubuntu-latest` | A fresh Linux machine from GitHub | Free for public repositories, and nothing left over from a previous run |
| `timeout-minutes: 15` | Stops a stuck run | A hung test should fail, not run for 6 hours |
| `actions/checkout` | Downloads the code | |
| `actions/setup-node` with `cache: npm` | Installs Node 22 and reuses downloaded packages | Matches `engines` in `package.json`; the cache makes runs faster |
| `npm ci` | Installs exactly what `package-lock.json` lists | Everyone gets the same versions |
| `npm run typecheck` | Checks types | Fastest check, so it fails first |
| `npm run build` | Compiles to `dist/` | The tests run the compiled code |
| `npm test` | Runs the tests | Proves behaviour still works |

Check it locally, the same way CI does:

```bash
npm ci
```

```bash
npm run typecheck && npm run build && npm test
```

While setting this up, two tests failed. One expected old landing page text,
which we updated. The other found a real bug: the dashboard's Validate and
Apply buttons returned an empty result, because the server didn't wait
(`await`) for the answer. That is fixed in `src/cli/ui.ts`. Now all 31 tests
pass.

## Step 2 — Pull request template ✅

File: `.github/pull_request_template.md`

Every pull request opens with four headings: **Problem, Change, Scope,
Verification**. Verification lists the exact commands run and their output.
For a bug fix, it also shows the new test failing on `main` and passing on
the branch. This keeps evidence apart from opinion, and ACP's own agents
write their patch reports in the same shape.

## Step 3 — GitHub repository and `main` rules (next)

Needs the maintainer: create the repository, push, then protect `main`.

1. Create the repository and push this branch.
2. Add `.github/CODEOWNERS` with `* @<maintainer>`, so every change needs
   the maintainer's review.
3. Add a ruleset on `main`: require a pull request, require the **CI**
   check, require code-owner approval, block force pushes and deletion.
4. Add a `LICENSE` (the project is open source but has none yet).

## Step 4 — Docker

A container packages ACP and everything it needs, so it runs the same on any
machine. We already have a `Dockerfile`. Next: a health check, a
`compose.yaml` to run it with one command, and a CI job that builds the
image and checks that `/healthz` answers.

## Step 5 — Security checks

Secret scanning (gitleaks), dependency audit (`npm audit`) and static
analysis (CodeQL).

## Step 6 — Review size checks

Size labels on pull requests, and a check on the size of agent instruction
files.

## Step 7 — Previews

A website preview link and a Docker image for every pull request.

## Step 8 — Issue forms and labels

Bug and feature forms, the label set, and the "Report a problem" form for
people without GitHub accounts.
