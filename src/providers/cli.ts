// The `/agents` and `/run` commands. Like the memory commands, they return text and an
// exit code so tests, the web app and the MCP server can all call them.

import { listAgents, type CommandRunner } from './detect.js';
import { renderFindings } from '../design/check.js';
import { runAgent } from './run.js';

export const AGENTS_USAGE = `Agent commands:
  acp /agents list                                      show the agents on this computer and whether each is signed in
  acp /run <agent> [--edit] [--files a,b] "<request>"   run one request in its own worktree
                                                        (without --edit the agent can read and answer but not change files)
                                                        add --model <name> to use a specific model
                                                        add --timeout <minutes> to give a run longer (15 for a question, 30 for an edit)`;

export async function runAgentsCommand(
  command: string,
  args: string[],
  where: { root: string; worktreeDir: string; dataDir: string },
  deps: { run: CommandRunner },
): Promise<{ output: string; exitCode: number }> {
  if (command === 'agents:list') {
    const agents = await listAgents(deps.run);
    const rows = agents.map(agent => [
      agent.id,
      agent.name,
      agent.version ?? '-',
      !agent.installed ? 'not installed' : agent.signedIn ? 'ready' : 'signed out',
      // When something is missing, the fix is more useful than the status.
      agent.next ?? agent.detail,
    ]);
    const widths = [0, 1, 2, 3].map(column => Math.max(...rows.map(row => row[column].length)));
    const lines = rows.map(row => row.map((cell, column) => (column < 4 ? cell.padEnd(widths[column] + 2) : cell)).join('').trimEnd());
    return { output: lines.join('\n'), exitCode: 0 };
  }

  if (command === 'agents:run') {
    const agentId = args[0];
    let mode: 'ask' | 'edit' = 'ask'; // the safe choice unless the user asks for edits
    let files: string[] = [];
    let model: string | undefined;
    let timeoutMinutes: number | undefined;
    const words: string[] = [];
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--edit') mode = 'edit';
      else if (args[i] === '--model') model = args[++i];
      else if (args[i] === '--timeout') {
        timeoutMinutes = Number(args[++i]);
        if (!(timeoutMinutes > 0)) return { output: '--timeout needs a number of minutes, for example --timeout 45', exitCode: 1 };
      }
      else if (args[i] === '--files') files = (args[++i] ?? '').split(',').map(file => file.trim()).filter(Boolean);
      else words.push(args[i]);
    }
    const request = words.join(' ').trim();
    if (!agentId || !request) return { output: AGENTS_USAGE, exitCode: 1 };

    try {
      // Time-based, so two runs never share a worktree or a branch.
      const runId = `run-${Date.now().toString(36)}`;
      const result = await runAgent({ ...where, agentId, request, mode, files, runId, model, timeoutMinutes }, deps);
      const changed = result.changed.length ? `Changed files:\n${result.changed.map(file => `  ${file}`).join('\n')}` : 'Changed files: none';
      return {
        output: [
          result.stoppedAfterMinutes
            ? `${result.agent} was stopped after ${result.stoppedAfterMinutes} minutes, before it finished.`
            : `${result.agent} finished (exit ${result.exitCode ?? 'none: it was stopped'}).`,
          `Worktree: ${result.worktree}`,
          `Branch:   ${result.branch}`,
          changed,
          ...(result.skills.length ? [`Design skills: ${result.skills.join(', ')}`] : []),
          ...renderFindings(result.designFindings),
          `Nothing has been merged. Review with: git -C ${result.worktree} diff`,
          ...(result.hint ? [result.hint] : []),
        ].join('\n'),
        exitCode: result.exitCode === 0 ? 0 : 1,
      };
    } catch (error) {
      return { output: error instanceof Error ? error.message : String(error), exitCode: 1 };
    }
  }

  return { output: AGENTS_USAGE, exitCode: 1 };
}
