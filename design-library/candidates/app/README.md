# App page designs (candidates)

Clickable prototypes of every page of the Agent Control Plane app. They are
design candidates: the app is not built yet, and every name, number and
message in them is sample content. Nothing here is canonical until the
maintainer approves it.

Plain HTML, one stylesheet (`app.css`) and one small script (`app.js`). No
framework, no build step, no dependencies. The only outside request is the
font link; the fallback fonts are set to look right without it.

## Look at them

```bash
python3 -m http.server 4400 --bind 127.0.0.1 --directory design-library/candidates/app
```

Open `http://127.0.0.1:4400/index.html`. The dashed bar at the top of a page
belongs to the prototype, not the app: it moves between that page's states.
A link such as `review.html#state-failed` opens a page in one state. Switch
theme from the sidebar; narrow the window to 390 for the small layout.

`tests/app-designs.test.ts` checks the pages (links, one `h1`, the footer
line, no inline styles or scripts, the settings sections, the thread
header). `acp /design check design-library/candidates/app/*.html design-library/candidates/app/app.css`
runs the design check on them.

## Pages

| Page | File | States |
|---|---|---|
| Map of everything | `index.html` | One line for every page and state |
| First run | `onboarding.html` | Agents (ready, signed out with the command, planned) · checking · no agent found · project · not a Git folder · memory found · no memory yet (`acp /memory init`) · ready |
| Thread (the home) | `thread.html` | Tasks working · empty · just sent · task opened (checkpoint timeline, `handoff.md`, Stop this task) · ready to review · stopped (Resume) · hand-off · question answered · secret request · loading · sign-in refused · long content. The message box has the agent or orchestrator choice, the permission mode and a Commands menu |
| Review | `review.html` | Queue · one patch (Problem / Change / Scope / Verification, diff, evidence and opinion) · design-check findings · failed check · applied · empty · loading |
| Agents | `agents.html` | All ready · needs sign-in · none found · checking |
| Memory | `memory.html` | Tabs: layers, knowledge, rules, proposed, what a file receives, import, `AGENTS.md` sync (in sync, out of date, block edited by hand) · no memory yet · loading |
| Runs | `runs.html` | Runs · after clean-up · empty · loading · could not list |
| Design library and skills | `design-library.html` | Tabs: skills, check rules, library · turned off · loading |
| Usage | `usage.html` | Tabs: by agent, by thread · limit reached · one agent silent · nothing used · loading |
| Git activity | `git.html` | Tabs: commits, pull requests, CI, issues · write needs approval · not signed in to host · no remote · loading · host unreachable |
| Settings | `settings.html` | Eleven sections with a section nav: General, Agents & models, Permissions, Memory, Design skills, Connections, Notifications, Keyboard shortcuts, Privacy & data, Advanced, About · a value refused · loading · could not read |
| Report a problem | `report.html` | Form · missing details · log preview · sending · sent · could not send |
| Error and offline | `error.html` | ACP stopped · reconnecting · offline · not found · something broke |

## Commands shown

Every command in the pages is written `acp /group action`, for example
`acp /agents list`, `acp /runs clean`, `acp /memory sync`,
`acp /design check <files>`. To add ACP's MCP server to an agent you start
yourself: `claude mcp add acp -- acp /mcp`. In the thread's message box the
same commands are typed without `acp`: `/run codex Build a page`, `/memory`,
`/runs clean`.

## Tokens

All in `app.css` under `:root`; the light theme changes values only.

| Group | Tokens |
|---|---|
| Surfaces | `--ground` `#000`, `--panel` `#0B0B0D`, `--raised` |
| Lines | `--line` `#1E1E22`, `--line-2` `#26262B`, `--line-3` |
| Text | `--text` `#EDEDEF`, `--soft` `#C9C9CF`, `--muted` `#A1A1AA`, `--dim` `#6B6B74` (decoration and disabled only: under 4.5:1) |
| State | `--ok` `#4ADE80`, `--warn` `#FBBF24`, `--err`, `--focus` `#8AA4FF`, each with a `-tint` surface |
| Type | `--font-ui` (Inter), `--font-mono` (JetBrains Mono), sizes `--t-xs` to `--t-2xl` |
| Space | `--s1` (4px) to `--s7` (48px) |
| Shape | `--r-sm` 4, `--r-md` 6, `--r-lg` 8, `--r-pill` |
| Layout and motion | `--side-w`, `--col`, `--ease` |

Rules the stylesheet keeps: no gradients, no glass, no hard offset shadows,
no thick side stripes, a visible `:focus-visible` ring, and every animation
and transition is turned off under `prefers-reduced-motion: reduce`.

## Components

| Component | Class | Used for |
|---|---|---|
| Task row | `.task`, `.task-row`, `.task-open`, `.task-detail` | A task with its status, agent, branch, checkpoints and the one action that fits its status |
| Status pill | `.pill` with `is-working`, `is-ready`, `is-ok`, `is-failed`, `is-stopped`, `is-planned` | Status, always with a word, never colour alone |
| Tag | `.tag`, `tag-evidence`, `tag-opinion` (dashed), `tag-estimate` (dashed), `tag-warn`, `tag-err` | Evidence apart from opinion; measured apart from estimated |
| Patch report | `.report` | Problem / Change / Scope / Verification |
| Checks and findings | `.checks`, `.finding`, `.loc` | Tool results with file and line |
| Diff | `.diff`, `.diff-lines` | One file's change |
| Checkpoint timeline | `.timeline`, and `.track` on the closed row | A task's checkpoints, hand-offs and stops |
| Layer table | `.table` with `tr.is-winner` | Memory layers and which one wins |
| Usage meter | `.meter`, `is-high`, `is-estimate` (dashed) | Plan windows; estimates look different from readings |
| Settings row | `.setting`, `.setting-control`, `.switch`, `.seg`, `.choice` | One setting with its explanation and control |
| Section nav | `.settings`, `.section-nav`, `.settings-section` | Settings sections on one page |
| Secret card | `.secret-card` | The only place a credential is typed |
| Confirm dialog | `dialog.dialog`, `.loss` | Names what will be lost; the safe choice has focus |
| Command line | `.cmd` with a Copy button, `.block` | A command to run in the maker's own tool |
| Notice, empty, loading | `.notice`, `.empty`, `.sk` | Error, empty and loading states |
| Message box | `.composer`, `.slash-menu` | The request, who handles it, the mode, the commands |
| Map | `.map-page`, `.map-states` | The index |
| Prototype state bar | `.proto` | Not part of the app |

`app.js` only moves between states already in the page: tabs, opening a
task row, show and hide, dialogs, copy, theme, the narrow-layout menu and
the two-star limit for orchestrators. It loads and sends nothing.

## Open questions for the maintainer

1. **Slash commands in the message box.** The pages show a Commands button
   that opens a short list above the box. Should the list instead appear
   as the person types `/`, filtered by what they type, and which commands
   belong in it? A bare `/memory` is shown as "what a task on these files
   would receive"; confirm what it should do with no action word.
2. **Commands not in the agreed list.** The pages use
   `acp /review deterministic` (as a rule's check), `acp /model smoke` (in
   the secret request example) and `acp /ui` (to start ACP again on the
   error page), written in the new style by analogy. Confirm the names.
3. **Data folder.** Settings shows `~/.acp` and a `settings.json` in it.
   The documentation does not fix either name.
4. **The near-limit line.** Usage and Settings show 90% as the point where
   an agent stops getting new tasks. ADR-0007 says windows drive routing
   but gives no number.
5. **Splitting a plan window between threads.** An agent reports one
   number for its window; the per-thread shares are ACP's own count and
   are described as such. Is that acceptable, or should per-thread usage
   show tasks and requests only?
6. **Permission modes.** The table of what each mode allows is the most
   conservative reading of ADR-0008 §9n: no mode lets an agent leave its
   worktree, push, or change memory. Confirm, especially network use.
7. **Automatic sync of `AGENTS.md`.** Shown as a setting that is off by
   default. Should it exist at all, given the pull request check?
8. **Other MCP servers.** ADR-0008 §9e says ACP lists and toggles them.
   The page assumes a toggle affects only agents ACP starts. The three
   server names are samples.
9. **Git activity writes.** Opening a pull request is shown as one
   approval that also pushes the branch. Should the push be approved
   separately?
10. **Report a problem.** The optional contact field is public in the
    issue. Keep it, or leave contact out entirely? The spam check is
    mentioned in one line and not drawn.
11. **Keyboard shortcuts** are proposals; none is decided anywhere.
12. **Antigravity** is shown as planned and cannot be starred.
13. **Fork a thread, side chat, visual replies and scenarios** (ADR-0008
    §9n) are not drawn. They need their own decisions first.
14. **Onboarding with no agent.** The pages let a person continue and look
    around. Should setup stop there instead?
