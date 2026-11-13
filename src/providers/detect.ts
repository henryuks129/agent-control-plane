// Finds which agents are on this computer and whether each is signed in.

import { spawn } from 'node:child_process';
import { AGENTS, type AgentId } from './registry.js';

export interface CommandResult {
  /** The exit code, or null if the program never started or was stopped. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** True when the program is not installed (not found on PATH). */
  missing: boolean;
  /** True when ACP stopped the program because it ran past its time limit. */
  timedOut?: boolean;
}

/**
 * Starts a program and waits for it. Passed in wherever a tool is run, so
 * tests can stand in for the real tools without an account or a network.
 */
export type CommandRunner = (
  binary: string,
  args: string[],
  options?: { cwd?: string; stream?: boolean; timeoutMs?: number; input?: string },
) => Promise<CommandResult>;

export interface AgentStatus {
  id: AgentId;
  name: string;
  installed: boolean;
  version?: string;
  signedIn: boolean;
  detail: string;
  /** What the user should do next, when something is missing. */
  next?: string;
}

/** The real runner. */
export const runCommand: CommandRunner = (binary, args, options = {}) =>
  new Promise(resolve => {
    // No shell: the arguments go to the program exactly as given. A request
    // such as `fix it; rm -rf ~` is therefore just text, never a command.
    // Standard input is opened only when there is something to send. A tool
    // left with an open, empty input can wait on it forever.
    const child = spawn(binary, args, { cwd: options.cwd, stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: CommandResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ timedOut: false, ...result }); } };

    // A tool waiting for input would otherwise hang ACP forever.
    const limit = options.timeoutMs ?? 30_000;
    const timer = setTimeout(() => { child.kill(); finish({ code: null, stdout, stderr: `${stderr}\nStopped after ${limit} ms.`, missing: false, timedOut: true }); }, limit);

    if (child.stdin) {
      // A tool that exits before reading must not crash ACP with a broken pipe.
      child.stdin.on('error', () => {});
      child.stdin.end(options.input);
    }

    child.stdout!.on('data', chunk => { stdout += chunk; if (options.stream) process.stdout.write(chunk); });
    child.stderr!.on('data', chunk => { stderr += chunk; if (options.stream) process.stderr.write(chunk); });
    child.on('error', error => finish({ code: null, stdout, stderr: String(error), missing: (error as NodeJS.ErrnoException).code === 'ENOENT' }));
    child.on('close', code => finish({ code, stdout, stderr, missing: false }));
  });

export async function listAgents(run: CommandRunner): Promise<AgentStatus[]> {
  // The tools are independent, so ask them all at once.
  return Promise.all(AGENTS.map(async agent => {
    const version = await run(agent.binary, ['--version']);
    if (version.missing) {
      return { id: agent.id, name: agent.name, installed: false, signedIn: false, detail: 'Not installed', next: agent.installHint };
    }

    const status = await run(agent.binary, agent.statusArgs);
    // Some tools print their status on the error stream, so read both.
    const signIn = agent.parseStatus(`${status.stdout}\n${status.stderr}`.trim());

    const result: AgentStatus = {
      id: agent.id,
      name: agent.name,
      installed: true,
      version: /\d+\.\d+\.\d+/.exec(version.stdout + version.stderr)?.[0],
      signedIn: signIn.signedIn,
      detail: signIn.detail,
    };
    // ACP shows the command instead of running it: signing in opens a browser
    // and belongs to the user, in the maker's own tool.
    if (!signIn.signedIn) result.next = `Run: ${agent.signInCommand}`;
    return result;
  }));
}
