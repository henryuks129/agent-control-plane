# Contributing to Agent Control Plane (ACP)

Thanks for helping. This page tells you how to get a change accepted.

## What ACP is

A free, open-source workspace where the coding agents you already use share
one memory, work in parallel, and change nothing until a person approves it.
The [README](README.md) has the overview and the roadmap. The reasons behind
each decision are in [docs/decisions](docs/decisions).

## Set up

You need Node.js 22.5 or newer and Git. Docker is optional.

```bash
git clone https://github.com/henryuks129/agent-control-plane.git
cd agent-control-plane
npm install
npm run typecheck
npm run build
npm test
```

To run the dashboard: `node dist/src/cli/main.js ui`, then open
<http://127.0.0.1:4317>. To run it in Docker, follow
[docs/guides/docker.md](docs/guides/docker.md).

## How a change reaches users

```text
your branch → pull request → dev → pull request → main
```

1. Branch from `dev` (or fork the repository). Name the branch for what it
   does: `fix/…`, `feat/…`, `docs/…`, `chore/…`.
2. Open a pull request into `dev`. It is the default, so you do not have to
   choose it.
3. CI must pass and the maintainer must approve. Nobody pushes to `dev` or
   `main` directly.
4. Pull requests into `dev` are squashed into one commit.
5. When `dev` is known to be free of bugs, the maintainer opens a pull
   request from `dev` into `main`. `main` accepts changes from nowhere else,
   and the website is published from it.
6. Your branch is deleted automatically when its pull request is merged or
   closed. It can be restored from the pull request page.

## Pull requests

Fill in the template. It has four parts:

- **Problem:** what is wrong or missing, and who it affects.
- **Change:** what you changed, in a few lines.
- **Scope:** which files or areas change, and what you left out on purpose.
- **Verification:** the exact commands you ran and what they printed. For a
  bug fix, show a test that fails before your change and passes after.

Keep a pull request to one purpose. Small ones are reviewed sooner.

## Commit messages and pull request text

- Start with the kind of change: `feat:`, `fix:`, `docs:`, `ci:`, `chore:`,
  `test:`, `refactor:`. Then say what changed, in the present tense.
- Do not add dates or timestamps. Git records them.
- Do not add tool or AI attribution lines such as "Generated with…" or
  "Co-authored-by" for an assistant. The person who opens the pull request
  is responsible for it, whatever tools they used.
- Describe ACP on its own terms. Do not name or compare other products.

## Code

- TypeScript, Node built-ins first. Ask before adding a dependency.
- Comment the *why*: the reason for a decision, a limit, or a trap. Leave
  out comments that repeat what the code already says.
- Add or update tests for behaviour you change. Tests live in `tests/` and
  run with `npm test`.
- Never commit secrets. `.env` files are ignored; keep it that way. Secrets
  must not appear in task state, checkpoints, logs, prompts or Git.

## Rules that do not bend

These come from [AGENTS.md](AGENTS.md) and apply to people and agents alike:

1. An agent gets only the context its task needs, never the whole repository
   by default.
2. Git is the source of truth for code.
3. Agents work in their own Git worktrees.
4. Every meaningful change passes deterministic checks before it merges.
5. Review findings keep evidence apart from model opinion.
6. Reuse the design library before inventing a component. Changes to the
   canonical library need approval.
7. Which provider or model is used is configuration, not logic in the code.

## Using AI agents to contribute

You are welcome to. The same rules apply: one purpose per pull request, real
verification output, and you have read and understood what you submit.

## Reporting a problem

Open an issue and say what happened, what you expected, and how to make it
happen again. Leave out keys and passwords. For a security problem, do not
open a public issue; use GitHub's private vulnerability reporting on the
repository's Security tab.

## Licence

ACP is [MIT licensed](LICENSE). By contributing, you agree your contribution
is released under the same licence.
