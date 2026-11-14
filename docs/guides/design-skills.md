# Built-in design skills

When a request is design work, ACP gives the agent high-end design skills
without you calling them. Other requests get none, so their context stays
small. The reasons are in ADR-0008 §9k.

## What counts as design work

Either of these:

- A file the request is about is a front-end file: `.css`, `.scss`, `.html`,
  `.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro`, a Tailwind config or a theme
  file.
- The request asks for a page, screen, component, layout, website,
  dashboard, prototype, animation or similar.

The word "design" alone does not count, because people also design database
schemas and APIs. No model is asked; the check is file names and words.

To see what a request would get, without running an agent:

```bash
acp /skills check --files web/main.css "Build a landing page"
```

```text
Design task: yes (file web/main.css; request mentions "landing page")
Skills: impeccable, awwwards
```

## The skills

```bash
acp /skills list
```

| Skill | Attached | For |
|---|---|---|
| `impeccable` | every design task | The quality bar for interface work: layout, type, colour, motion, polish, review |
| `huashu-design` | when the request mentions a prototype, mock-up, slides, animation, motion or video | HTML prototypes, slide decks, motion graphics. Written in Chinese; agents read it without trouble |
| `awwwards` | when the request mentions a website, landing page, home page or portfolio | Whole websites built to an award-level bar |

Each is another author's work under its own licence, pinned to one reviewed
commit. Sources and licences are in
[design-library/skills](../../design-library/skills/README.md).

## What happens on a run

1. ACP copies the chosen skills into the run's worktree, under
   `.claude/skills` and `.agents/skills`, where Claude Code, Codex and
   OpenCode already look.
2. It lists those folders in Git's local ignore file, so they never appear
   in a commit or a pull request. Your project folder is not touched.
3. It tells the agent to read and follow them before changing anything.
4. `/run` prints which skills were attached.

If your project already has a skill with the same name, yours is kept and
ACP's copy is not added.

## Limits

- Only the instructions are shipped. The skills' helper scripts (screenshot
  tools, font and photo fetchers, video export, Impeccable's detector) are
  not, so steps that need them are skipped.
- `huashu-design` expects to show three directions and let you choose. A
  run cannot ask you questions yet, so it picks one itself.

## Turn it off or choose

In `.acp/settings.json` in your project:

```json
{ "designSkills": false }
```

or name exactly the skills to use on every design task:

```json
{ "designSkills": ["impeccable"] }
```

## Add your own skills

Put a folder with a `SKILL.md` in `.acp/skills/` in your project and commit
it:

```text
.acp/skills/house-style/SKILL.md
```

```markdown
---
description: Our tokens, components and tone of voice.
keywords: [email, newsletter]
---
Use the tokens in web/tokens.css. ...
```

- Without `keywords`, the skill is attached to every design task. With
  them, only when the request mentions one.
- A skill of yours with the same name as a shipped one replaces it.
- `/skills list` shows yours as "this project".

## The result is checked

After a design run, ACP looks through the changed front-end files for known
anti-patterns and prints what it finds with the file and line:

```text
Design check: 1 finding (pattern matches in the files, not opinions)
  site/index.html:42  dead-link. Point the link somewhere, or make it a button that does something.
```

| Rule | Looks for |
|---|---|
| `placeholder-text` | "lorem ipsum" |
| `dead-link` | `href="#"`, an empty link, or `javascript:` |
| `image-without-alt` | an `<img>` with no `alt` |
| `gradient-text` | `background-clip: text` |
| `hard-offset-shadow` | a shadow with an offset and no blur |
| `side-stripe-border` | a left or right border of 2px or more |
| `focus-outline-removed` | `outline: none` in a file with no `:focus-visible` |
| `motion-without-reduced-motion` | animation in a file that never mentions `prefers-reduced-motion` |

These are pattern matches, so each can be confirmed by reading the line.
They do not judge taste. To check files yourself:

```bash
acp /design check site/index.html
```

## Not built yet

- Blocking approval of a patch on these findings in the review screen.
- Choosing a design-library style for a task.
