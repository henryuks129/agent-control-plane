# ACP landing page

Mode: Persuade. Audience: developers who use more than one coding agent.
Job: say what ACP is in one screen, show it working, lead to the Docker quick start.
Stack: one HTML file with inline CSS, `landing.js`, `favicon.svg`. No build, no dependencies.

## Direction

Idea: independent agents, one shared thread, a person at the gate.
World: a graphite engineering work surface with copper signal lines.
Motion verb: **connect**. Things arrive along a line, left to right, and stop at a gate.

## Palette

Ground `#171916`, raised `#1e211c`, surface `#262a23`, lines `#3d4237` / `#5b6451`.
Ink `#f0f0e7`, muted `#b5b9ac`. Accent copper `#edab82` (hover `#f7c6a6`).
Sage `#bacda2` means done or working now. Copper means in motion or waiting on you.
Light bands: paper `#e5e8dc`, ink `#232920`, muted `#4f584a`.

## Type

Display: Bricolage Grotesque 500, tracking -0.04em, fluid 46–96px for the h1.
Reading: Instrument Sans 400/500/600, 17px/1.6 (16px on phones).
Monospace (system stack) only for commands, paths and terminal output.
Both web fonts use `display=swap` and fall back to system sans.

## Layout

Max width 1336px, gutters 48 / 32 / 16px.
Hero: the headline runs the full width on one line; below it the quick start
(left) and the thread (right). On one column the thread moves up, directly under
the sentence that explains it.
Sections alternate dark ground and paper bands. Content is set in ruled rows and
5/7 splits, not cards.

## Motion rules

1. **Nothing is hidden by default.** The markup is the final state. Only classes
   added by `landing.js` (`motion`, `pre`, `is-live`, `is-typing`) describe earlier
   states. `tests/landing.test.ts` enforces this.
2. **Signature moment: the hand-off.** In the hero thread a request is split into
   three tasks, three agents work in parallel lanes, one stops, and a copper
   checkpoint mark drops from its lane to the next agent's lane and becomes the
   head of the resumed task. The patch then waits at the approval gate, and it
   waits longest: nothing moves until the visitor approves or the loop restarts.
3. **The thread is an illustration** and says so twice (tag and caption). The
   terminal is real output and says so.
4. **Idle:** the thread loop is the only thing that moves at rest. It has a Pause
   button, and stops off screen and when the tab is hidden.
5. **Terminal:** types three real commands once when scrolled into view, lights
   the matching point beside it, then offers Replay. Show all skips the typing.
6. **Scroll reveals** apply only to elements that start below the fold. Three
   variants: body copy rises, headings travel further and slower, ruled rows draw
   their rule before the words arrive.
7. **Hover, one voice:** text links draw a copper line left to right; buttons fill
   from the left and the arrow moves on. Press scales to 0.98.
8. **Ease:** `cubic-bezier(.16,1,.3,1)` for arrivals; `cubic-bezier(.7,0,.2,1)`
   for the checkpoint drop. Feedback 0.2–0.5s, reveals 0.9–1.2s.
9. **Reduced motion:** no `motion` class, no loops, no typing; the thread shows
   its last frame and the terminal its full transcript. Colour transitions stay.
   The Approve button and the copy buttons still work.
10. Animate transform, opacity and clip-path. No clip-path on an element an
    IntersectionObserver watches: a clipped element reports no area.

## Honesty

No footage, stock imagery, metrics, logos or quotes. Status follows the README:
works now / being built / planned. The quick start and terminal output are real.
