// The `memory:*` commands. They return text and an exit code instead of
// printing and exiting, so tests can call them directly and the web app and
// MCP server can reuse them later.

import { syncProject } from './agents-file.js';
import { acceptProposal, listProposals } from './local.js';
import { renderBundle, resolveMemory } from './resolve.js';
import { initProjectMemory, loadProjectMemory, loadUserMemory } from './store.js';

export interface MemoryCommandResult {
  output: string;
  /** 0 for success. 1 tells a script or CI that something needs attention. */
  exitCode: number;
}

export const MEMORY_USAGE = `Memory commands:
  memory:init                               create .acp/ in this project
  memory:show [--request "<text>"] <files>  show what a task on these files would receive
  memory:sync [--check]                     write the summary into AGENTS.md and CLAUDE.md
                                            (--check changes nothing and fails if they are out of date)
  memory:proposals                          list the rules agents have proposed
  memory:accept <name>                      make a proposed rule apply, by moving it into .acp/rules/`;

export function runMemoryCommand(command: string, args: string[], where: { root: string; dataDir: string }): MemoryCommandResult {
  if (command === 'memory:init') {
    const created = initProjectMemory(where.root);
    return {
      output: created.length ? `Created: ${created.join(', ')}` : 'Memory is already set up. Nothing changed.',
      exitCode: 0,
    };
  }

  if (command === 'memory:show') {
    const files: string[] = [];
    let request = '';
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--request') request = args[++i] ?? '';
      else files.push(args[i]);
    }
    const text = renderBundle(resolveMemory({
      project: loadProjectMemory(where.root),
      user: loadUserMemory(where.dataDir),
      files,
      request,
    }));
    return { output: text || 'No memory applies to these files yet. Run memory:init to start.', exitCode: 0 };
  }

  if (command === 'memory:sync') {
    const check = args.includes('--check');
    const report = syncProject(where.root, { check });
    const lines = [`AGENTS.md: ${report.agents}`, `CLAUDE.md: ${report.claude}`];
    if (report.truncated) lines.push('Note: .acp/knowledge.md is longer than the summary budget, so the summary was cut.');
    lines.push(...report.problems);

    // In check mode "would change" is a failure: the committed files do not
    // match `.acp/`, and CI should say so before the pull request merges.
    const outOfDate = check && (report.agents !== 'unchanged' || report.claude !== 'unchanged');
    if (outOfDate) lines.push('Out of date. Run memory:sync and commit the result.');
    return { output: lines.join('\n'), exitCode: report.problems.length > 0 || outOfDate ? 1 : 0 };
  }

  if (command === 'memory:proposals') {
    const proposals = listProposals(where.root);
    if (proposals.length === 0) return { output: 'No proposed rules.', exitCode: 0 };
    const width = Math.max(...proposals.map(proposal => proposal.name.length));
    return {
      output: proposals.map(proposal => `${proposal.name.padEnd(width + 2)}${proposal.paths.join(', ')}\n  ${proposal.body.split('\n')[0]}`).join('\n'),
      exitCode: 0,
    };
  }

  if (command === 'memory:accept') {
    if (!args[0]) return { output: MEMORY_USAGE, exitCode: 1 };
    try {
      acceptProposal(where.root, args[0]);
      return { output: `Accepted. The rule is now in .acp/rules/ and applies to matching files. Run memory:sync to update AGENTS.md.`, exitCode: 0 };
    } catch (error) {
      return { output: error instanceof Error ? error.message : String(error), exitCode: 1 };
    }
  }

  return { output: MEMORY_USAGE, exitCode: 1 };
}
