# Design skills shipped with ACP

These folders are other people's work, copied here unchanged under their own
licences. ACP attaches them to design tasks on its own; see
[the guide](../../docs/guides/design-skills.md).

| Skill | From | Commit | Licence | Copied |
|---|---|---|---|---|
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable), folder `.claude/skills/impeccable` | `c4cd1924c389f68d37c687d9c2bbf13f12547c41` | Apache-2.0 | `SKILL.md`, `reference/`, plus the repository's `LICENSE` and `NOTICE.md` |
| `huashu-design` | [alchaincyf/huashu-design](https://github.com/alchaincyf/huashu-design) | `e8d1148a80d5a281d4247cffe320add3df017928` | MIT | `SKILL.md`, `references/`, `LICENSE` |
| `awwwards` | [juliobsz/skills](https://github.com/juliobsz/skills), folder `awwwards` | `add880bd6ec9f5592a1482846fc0dd282c9161bc` | MIT | `SKILL.md`, `references/`, plus the repository's `LICENSE` |

## What is left out, and why

Only instruction files are copied. Each skill's `scripts/` folder, programs,
installers, demos, images and audio are not.

- An agent runs a skill's scripts with the user's permissions. Shipping them
  would mean shipping code ACP has not read line by line.
- Impeccable's launcher downloads a program on first use. ACP never
  downloads anything on a user's behalf.
- Huashu Design's media is about 40 MB.

The files themselves are not edited, so they still mention those scripts.
ACP tells the agent they are absent and to skip those steps. Impeccable
documents what to do when its launcher is unavailable.

## Updating a skill

1. Read the changes between the pinned commit and the new one. A skill is
   instructions an agent will follow, so review it like code.
2. Re-check the licence.
3. Copy the same files again, update `commit` in `skills.json`, and replace
   `digest` with the new value the failing test in `tests/design.test.ts`
   reports.

Do not edit a skill's files by hand: the digest test fails, on purpose.
