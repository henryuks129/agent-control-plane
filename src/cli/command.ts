// Turns what the user typed into the command name the rest of ACP uses.
//
// The everyday commands are one word, so they are easy to remember. In a
// terminal they follow `acp` (`acp memory`); in the app's message box the
// same word follows a slash (`/memory`), and the box lists them as you type.
// The internal names (`memory:show`) are never shown to the user, so the
// words can change without touching the code that carries each one out.

export interface Word {
  /** What the user types: `acp <word>` or `/<word>`. */
  word: string;
  /** The internal command it runs. */
  name: string;
  /** The arguments it takes, for help. */
  hint: string;
  /** One short line for help and for the slash menu. */
  about: string;
}

export const WORDS: readonly Word[] = [
  { word: 'run', name: 'agents:run', hint: '<agent> [--edit] [--files a,b] [--model name] [--timeout minutes] "<request>"', about: 'Run a request with one agent in its own worktree' },
  { word: 'agents', name: 'agents:list', hint: '', about: 'Agents on this computer and whether each is signed in' },
  { word: 'runs', name: 'runs:list', hint: '', about: 'Agent runs still on this computer and what each holds' },
  { word: 'clean', name: 'runs:clean', hint: '', about: 'Remove runs that changed nothing' },
  { word: 'remove', name: 'runs:remove', hint: '<run> [--force]', about: 'Remove one run (--force when it holds work)' },
  { word: 'memory', name: 'memory:show', hint: '[--request "<text>"] <files...>', about: 'What an agent working on these files would be told' },
  { word: 'init', name: 'memory:init', hint: '', about: 'Start project memory in .acp/' },
  { word: 'sync', name: 'memory:sync', hint: '[--check]', about: 'Copy the memory summary into AGENTS.md and CLAUDE.md' },
  { word: 'proposals', name: 'memory:proposals', hint: '', about: 'Rules agents have proposed, waiting for you' },
  { word: 'accept', name: 'memory:accept', hint: '<name>', about: 'Accept a proposed rule' },
  { word: 'skills', name: 'skills:list', hint: '["<request>"]', about: 'Design skills, or which ones a request would get' },
  { word: 'check', name: 'design:check', hint: '<files...>', about: 'Look for design mistakes in these files' },
  { word: 'start', name: 'ui', hint: '', about: 'Start ACP and open it in the browser' },
  { word: 'mcp', name: 'mcp', hint: '', about: 'Run ACP as an MCP server for another agent' },
  { word: 'doctor', name: 'doctor', hint: '', about: 'Show ACP settings and what is configured' },
  { word: 'help', name: 'help', hint: '', about: 'List the commands' },
];

// The older task engine. Its commands stay reachable as two words
// (`acp task show <id>`) but are kept out of the everyday list.
const ENGINE: ReadonlyArray<readonly [name: string, hint: string]> = [
  ['deployment:oci:check', ''],
  ['project:onboard', '<local-repository-path>'], ['project:list', ''], ['project:show', '<PROJECT-ID>'],
  ['project:settings', '<PROJECT-ID>'], ['project:settings:set', '<PROJECT-ID> <settings.json>'],
  ['task:create', '<file.json>'], ['task:show', '<TASK-ID>'], ['task:plan', '<TASK-ID>'], ['task:run', '<TASK-ID>'],
  ['task:progress', '<TASK-ID>'], ['task:graph', '<TASK-ID>'], ['task:resume', '<TASK-ID>'],
  ['checkpoint:create', '<TASK-ID> <checkpoint.json>'], ['context:build', '<TASK-ID>'],
  ['model:list', ''], ['model:smoke', '[role]'],
  ['media:models', ''], ['media:image', '<prompt> [profile-id]'], ['media:show', '<JOB-ID>'],
  ['patch:list', '<TASK-ID>'], ['patch:show', '<TASK-ID> [artifact-id]'], ['patch:validate', '<TASK-ID> [artifact-id]'],
  ['patch:approve', '<TASK-ID> <artifact-id>'], ['patch:apply', '<TASK-ID> <artifact-id>'],
  ['worktree:create', '<TASK-ID>'], ['worktree:prepare', '<TASK-ID>'],
  ['review:deterministic', '<TASK-ID>'], ['review:llm', '<TASK-ID>'], ['review:external', '<TASK-ID>'],
  ['learning:show', '<TASK-ID>'], ['learning:approve', '<TASK-ID> <iteration>'], ['learning:propose-upgrade', '<TASK-ID> <max-iterations>'],
  ['upgrade:list', '[status]'], ['upgrade:approve', '<upgrade-id>'], ['upgrade:validate', '<upgrade-id>'],
  ['upgrade:apply', '<upgrade-id>'], ['upgrade:reject', '<upgrade-id>'], ['upgrade:rollback', '<upgrade-id>'],
  ['artifacts:show', '<TASK-ID>'], ['history:show', '<TASK-ID>'], ['artifact:preview', '<TASK-ID> <ARTIFACT-ID>'],
  ['design:candidate', '<name> <file.md>'],
];

const byWord = new Map(WORDS.map(entry => [entry.word, entry]));
const byName = new Map(WORDS.map(entry => [entry.name, entry]));
const engineNames = new Set(ENGINE.map(([name]) => name));
const engineGroups = new Set(ENGINE.map(([name]) => name.split(':')[0]));

/** A command as it is typed in a terminal, for help and messages: `acp accept`. */
export function shown(name: string): string {
  return `acp ${byName.get(name)?.word ?? name.replaceAll(':', ' ')}`;
}

/** The entries the app's message box lists when the user types `/`. */
export function slashMenu(): Array<{ label: string; about: string }> {
  return WORDS.filter(entry => entry.word !== 'mcp').map(entry => ({ label: `/${entry.word}`, about: entry.about }));
}

/** The list printed by `acp help`. */
export function usage(version: string): string {
  const width = Math.max(...WORDS.map(entry => entry.word.length));
  const lines = WORDS.map(entry => `  acp ${entry.word.padEnd(width)}  ${entry.about}${entry.hint ? `\n  ${' '.repeat(width + 6)}${entry.word} ${entry.hint}` : ''}`);
  return `ACP v${version}\n\nCommands (in the app, type / and the same word):\n${lines.join('\n')}\n\nThe older task engine takes two words, such as acp task show <TASK-ID>.
Its groups: task, project, patch, review, upgrade, learning, model, media, worktree.\n`;
}

export function resolveCommand(argv: string[]): { command: string; args: string[] } {
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h') return { command: 'help', args: [] };
  // In a terminal the word follows `acp`; a slash copied from the app is ignored.
  const word = first.startsWith('/') ? first.slice(1) : first;

  // One word asks two things: with a request it says which skills that request would get.
  if (word === 'skills' && rest.length > 0) return { command: 'skills:check', args: rest };
  const entry = byWord.get(word);
  if (entry) return { command: entry.name, args: rest };

  // Internal names still work, so scripts written for them keep running.
  if (byName.has(word) || engineNames.has(word)) return { command: word, args: rest };

  if (engineGroups.has(word)) {
    // The longest name wins, so `acp project settings set` is not read as
    // `acp project settings` with "set" as the project.
    for (const length of [2, 1]) {
      const name = [word, ...rest.slice(0, length)].join(':');
      if (rest.length >= length && engineNames.has(name)) return { command: name, args: rest.slice(length) };
    }
    return { command: 'help', args: [] };
  }
  return { command: word, args: rest };
}
