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
node dist/src/cli/main.js skills:check --files web/main.css "Build a landing page"
```

```text
Design task: yes (file web/main.css; request mentions "landing page")
Skills: impeccable, awwwards
```

## The skills

```bash
node dist/src/cli/main.js skills:list
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
4. `agents:run` prints which skills were attached.

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

## Not built yet

- Checking the result against the design library's anti-pattern rules in
  review.
- Adding your own skills to the list.
- Choosing a design-library style for a task.
