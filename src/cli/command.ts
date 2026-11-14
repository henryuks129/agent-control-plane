// Turns what the user typed into the command name the rest of ACP uses.
//
// A command is typed as a slash, a group and an action: `acp /memory show`.
// Inside ACP the same command is called `memory:show`; that name is never
// shown to the user. Keeping the two apart means the typed form can change
// without touching the code that carries each command out.

/** Every command: its internal name and the arguments it takes. */
export const COMMANDS: ReadonlyArray<readonly [name: string, hint: string]> = [
  ['skills:list', ''],
  ['skills:check', '[--files a,b] "<request>"'],
  ['agents:list', ''],
  ['agents:run', '<agent> [--edit] [--files a,b] [--model name] [--timeout minutes] "<request>"'],
  ['runs:list', ''],
  ['runs:clean', ''],
  ['runs:remove', '<run> [--force]'],
  ['design:check', '<files...>'],
  ['memory:init', ''],
  ['memory:show', '[--request "<text>"] <files...>'],
  ['memory:sync', '[--check]'],
  ['memory:proposals', ''],
  ['memory:accept', '<name>'],
  ['mcp', ''],
  ['doctor', ''],
  ['ui', ''],
  ['deployment:oci:check', ''],
  ['project:onboard', '<local-repository-path>'],
  ['project:list', ''],
  ['project:show', '<PROJECT-ID>'],
  ['project:settings', '<PROJECT-ID>'],
  ['project:settings:set', '<PROJECT-ID> <settings.json>'],
  ['task:create', '<file.json>'],
  ['task:show', '<TASK-ID>'],
  ['task:plan', '<TASK-ID>'],
  ['task:run', '<TASK-ID>'],
  ['task:progress', '<TASK-ID>'],
  ['task:graph', '<TASK-ID>'],
  ['task:resume', '<TASK-ID>'],
  ['checkpoint:create', '<TASK-ID> <checkpoint.json>'],
  ['context:build', '<TASK-ID>'],
  ['model:list', ''],
  ['model:smoke', '[role]'],
  ['media:models', ''],
  ['media:image', '<prompt> [profile-id]'],
  ['media:show', '<JOB-ID>'],
  ['patch:list', '<TASK-ID>'],
  ['patch:show', '<TASK-ID> [artifact-id]'],
  ['patch:validate', '<TASK-ID> [artifact-id]'],
  ['patch:approve', '<TASK-ID> <artifact-id>'],
  ['patch:apply', '<TASK-ID> <artifact-id>'],
  ['worktree:create', '<TASK-ID>'],
  ['worktree:prepare', '<TASK-ID>'],
  ['review:deterministic', '<TASK-ID>'],
  ['review:llm', '<TASK-ID>'],
  ['review:external', '<TASK-ID>'],
  ['learning:show', '<TASK-ID>'],
  ['learning:approve', '<TASK-ID> <iteration>'],
  ['learning:propose-upgrade', '<TASK-ID> <max-iterations>'],
  ['upgrade:list', '[status]'],
  ['upgrade:approve', '<upgrade-id>'],
  ['upgrade:validate', '<upgrade-id>'],
  ['upgrade:apply', '<upgrade-id>'],
  ['upgrade:reject', '<upgrade-id>'],
  ['upgrade:rollback', '<upgrade-id>'],
  ['artifacts:show', '<TASK-ID>'],
  ['history:show', '<TASK-ID>'],
  ['artifact:preview', '<TASK-ID> <ARTIFACT-ID>'],
  ['design:candidate', '<name> <file.md>'],
];

const hints = new Map(COMMANDS);
const groups = new Set(COMMANDS.filter(([name]) => name.includes(':')).map(([name]) => name.split(':')[0]));

// Running an agent is the most typed command, so it gets a name of its own.
const SHORT: Record<string, string> = { run: 'agents:run' };
const shortFor = new Map(Object.entries(SHORT).map(([short, name]) => [name, short]));

/** A command as the user types it, for help and messages: `acp /memory accept`. */
export function shown(name: string): string {
  return `acp /${shortFor.get(name) ?? name.replaceAll(':', ' ')}`;
}

/** The list printed by `acp /help`. */
export function usage(version: string): string {
  const lines = COMMANDS.map(([name, hint]) => `  ${shown(name)}${hint ? ` ${hint}` : ''}`);
  return `ACP v${version}\n\nCommands:\n${lines.join('\n')}\n`;
}

// Git Bash on Windows rewrites an argument that starts with a slash into a
// path under its own install folder, so `/agents` arrives as
// `C:/Program Files/Git/agents`. The last part is still what was typed.
const REWRITTEN = /^[A-Za-z]:[\\/]/;

export function resolveCommand(argv: string[]): { command: string; args: string[] } {
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h') return { command: 'help', args: [] };

  let word = first;
  if (REWRITTEN.test(word)) word = word.split(/[\\/]/).at(-1) ?? '';
  else if (word.startsWith('/')) word = word.slice(1);

  // The earlier colon form, kept so existing scripts and CI lines keep working.
  if (hints.has(word)) return { command: word, args: rest };
  if (SHORT[word]) return { command: SHORT[word], args: rest };

  if (groups.has(word)) {
    // The longest name wins, so `/project settings set` is not read as
    // `/project settings` with "set" as the project.
    for (const length of [2, 1]) {
      const name = [word, ...rest.slice(0, length)].join(':');
      if (rest.length >= length && hints.has(name)) return { command: name, args: rest.slice(length) };
    }
    // A group on its own lists, when listing needs nothing more from the user.
    if (rest.length === 0 && hints.get(`${word}:list`) === '') return { command: `${word}:list`, args: [] };
    // Anything else goes to the group, which answers with its own help.
    return { command: `${word}:${rest[0] ?? 'help'}`, args: rest.slice(1) };
  }
  return { command: word, args: rest };
}
