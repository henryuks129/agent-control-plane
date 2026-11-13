// Decides whether a task is design work (ADR-0008 §9k).
//
// Design skills are attached only to design tasks, so every other task keeps
// its context small (AGENTS.md rule 2). The decision uses file names and
// plain words, with no model call: it is instant, free, and the same every
// time, and the user can see exactly why a task was treated as design work.

const FRONT_END_FILE = /\.(css|scss|sass|less|html?|tsx|jsx|vue|svelte|astro)$|(^|\/)(tailwind\.config|theme)\.[cm]?[jt]s$/i;

// "design" on its own is left out on purpose: people also design schemas and
// APIs. Longer phrases come first so the reason names the most specific one.
const DESIGN_WORDS = /\b(landing page|home ?page|web ?page|hero section|visual design|slide deck|dark mode|colou?r scheme|front-?end|redesign|restyle|website|dashboard|prototype|mock-?up|wireframe|typography|palette|animations?|animate|motion|layout|responsive|tailwind|css|ui|ux|page|screen|component)\b/i;

export const isFrontEndFile = (file: string) => FRONT_END_FILE.test(file);

export interface DesignDetection {
  design: boolean;
  /** Why, in words that can be shown to the user. Empty when it is not design work. */
  reasons: string[];
}

export function detectDesignTask(input: { files: string[]; request: string }): DesignDetection {
  const reasons: string[] = [];
  const file = input.files.find(candidate => FRONT_END_FILE.test(candidate));
  if (file) reasons.push(`file ${file}`);
  const word = DESIGN_WORDS.exec(input.request);
  if (word) reasons.push(`request mentions "${word[0].toLowerCase()}"`);
  return { design: reasons.length > 0, reasons };
}
