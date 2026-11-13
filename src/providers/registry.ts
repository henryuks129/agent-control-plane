// What ACP knows about each coding agent it can start (ADR-0007 §4).
//
// ACP never signs anyone in and never reads a token. Each agent is its
// maker's own command-line tool, already signed in by the user. ACP only
// asks the tool "are you signed in?" and starts it with a request.
//
// Everything specific to one tool lives in this file, so supporting another
// agent means adding one entry here (AGENTS.md rule 10: provider choice is
// configuration, not logic spread through the code).

export type AgentId = 'claude' | 'codex' | 'opencode';

/**
 * How much the agent may do on one run.
 * - `ask`:  read and answer. It cannot change files.
 * - `edit`: it may change files, but only inside the run's own worktree.
 */
export type RunMode = 'ask' | 'edit';

export interface SignIn {
  signedIn: boolean;
  /** Safe to show: a plan or provider name. Never an email, organisation or key. */
  detail: string;
}

export interface AgentDefinition {
  id: AgentId;
  name: string;
  /** The program to start. Looked up on the user's PATH. */
  binary: string;
  /** Arguments that make the tool print its sign-in status and exit. */
  statusArgs: string[];
  /** What the user types to sign in. Shown, never run, by ACP. */
  signInCommand: string;
  installHint: string;
  parseStatus(output: string): SignIn;
  /**
   * Arguments for one non-interactive run in `cwd`.
   * `model` is optional: without it the tool uses its own default.
   */
  runArgs(mode: RunMode, prompt: string, cwd: string, model?: string): string[];
}

const stripColour = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

const claude: AgentDefinition = {
  id: 'claude',
  name: 'Claude Code',
  binary: 'claude',
  statusArgs: ['auth', 'status'],
  signInCommand: 'claude auth login',
  installHint: 'Install Claude Code from https://claude.com/product/claude-code',
  parseStatus(output) {
    try {
      const status = JSON.parse(output) as { loggedIn?: boolean; subscriptionType?: string; authMethod?: string };
      if (!status.loggedIn) return { signedIn: false, detail: 'Not signed in' };
      // The status also holds the account email and organisation. They are
      // deliberately not copied: ACP stores and shows the plan name only.
      const detail = status.subscriptionType ? `Claude ${capitalise(status.subscriptionType)} plan` : 'Signed in';
      return { signedIn: true, detail };
    } catch {
      // Older or newer versions may print plain text instead of JSON.
      const signedIn = /logged in/i.test(output) && !/not logged in/i.test(output);
      return { signedIn, detail: signedIn ? 'Signed in' : 'Not signed in' };
    }
  },
  runArgs(mode, prompt, _cwd, model) {
    // `plan` lets Claude read and reason but not edit. `acceptEdits` allows
    // file edits; shell commands still need an approval that a
    // non-interactive run cannot give, so they are refused.
    return ['-p', prompt, '--permission-mode', mode === 'edit' ? 'acceptEdits' : 'plan', ...(model ? ['--model', model] : [])];
  },
};

const codex: AgentDefinition = {
  id: 'codex',
  name: 'Codex',
  binary: 'codex',
  statusArgs: ['login', 'status'],
  signInCommand: 'codex login',
  installHint: 'Install Codex from https://developers.openai.com/codex/cli',
  parseStatus(output) {
    const using = /logged in using (.+)/i.exec(output);
    if (/not logged in/i.test(output) || !using) return { signedIn: false, detail: 'Not signed in' };
    return { signedIn: true, detail: `Signed in with ${using[1].trim()}` };
  },
  runArgs(mode, prompt, cwd, model) {
    // Codex enforces these with its own sandbox: `read-only` cannot write at
    // all, and `workspace-write` can write only inside the folder given by -C.
    return ['exec', '--sandbox', mode === 'edit' ? 'workspace-write' : 'read-only', '-C', cwd, ...(model ? ['--model', model] : []), prompt];
  },
};

const opencode: AgentDefinition = {
  id: 'opencode',
  name: 'OpenCode',
  binary: 'opencode',
  statusArgs: ['auth', 'list'],
  signInCommand: 'opencode auth login',
  installHint: 'Install OpenCode from https://opencode.ai',
  parseStatus(output) {
    // Each line is "<provider>   <kind>   stored". Only the name is kept.
    const providers = stripColour(output)
      .split('\n')
      .map(line => /^(.+?)\s{2,}.+?\s{2,}stored\s*$/.exec(line.trim())?.[1])
      .filter((name): name is string => Boolean(name));
    if (providers.length === 0) return { signedIn: false, detail: 'No providers set up' };
    return { signedIn: true, detail: `${providers.length} provider${providers.length === 1 ? '' : 's'}: ${providers.join(', ')}` };
  },
  runArgs(mode, prompt, _cwd, model) {
    // OpenCode's built-in `plan` agent reads without editing; `build` edits.
    // `--auto` approves the edits a non-interactive run could not confirm.
    const choice = model ? ['--model', model] : [];
    return mode === 'edit' ? ['run', '--agent', 'build', '--auto', ...choice, prompt] : ['run', '--agent', 'plan', ...choice, prompt];
  },
};

/** In the order they are shown to the user. */
export const AGENTS: AgentDefinition[] = [claude, codex, opencode];

export function agentById(id: string): AgentDefinition | undefined {
  return AGENTS.find(agent => agent.id === id);
}
