// The `/skills` and `/design check` commands. They only read files, so like the memory commands
// they return text and an exit code and need no database or model key.

import { detectDesignTask } from './detect.js';
import { checkFiles, renderFindings } from './check.js';
import { availableSkills, loadDesignSetting, selectSkills } from './skills.js';

export const SKILLS_USAGE = `Design skill commands:
  acp /skills list                                 show the design skills ACP ships, their source and licence
  acp /skills check [--files a,b] "<request>"      say whether a request is design work and which skills it would get
  acp /design check <files...>                     look for known design anti-patterns in these files
A folder in .acp/skills/ with a SKILL.md is this project's own skill.`;

export function runDesignCommand(command: string, args: string[], where: { root: string }): { output: string; exitCode: number } {
  if (command === 'skills:list') {
    const rows = availableSkills(where.root).map(skill => [
      skill.name,
      skill.role === 'default' ? 'always' : 'when asked',
      skill.licence,
      // Twelve characters identify a commit and keep the line readable.
      skill.commit ? `${skill.repository}@${skill.commit.slice(0, 12)}` : skill.repository,
    ]);
    const widths = [0, 1, 2].map(column => Math.max(...rows.map(row => row[column].length)));
    return { output: rows.map(row => row.map((cell, column) => (column < 3 ? cell.padEnd(widths[column] + 2) : cell)).join('')).join('\n'), exitCode: 0 };
  }

  if (command === 'skills:check') {
    let files: string[] = [];
    const words: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--files') files = (args[++i] ?? '').split(',').map(file => file.trim()).filter(Boolean);
      else words.push(args[i]);
    }
    const request = words.join(' ').trim();
    if (!request) return { output: SKILLS_USAGE, exitCode: 1 };

    const found = detectDesignTask({ files, request });
    const skills = found.design ? selectSkills(availableSkills(where.root), request, loadDesignSetting(where.root)) : [];
    return {
      output: [
        `Design task: ${found.design ? `yes (${found.reasons.join('; ')})` : 'no'}`,
        `Skills: ${skills.map(skill => skill.name).join(', ') || 'none'}`,
      ].join('\n'),
      exitCode: 0,
    };
  }

  if (command === 'design:check') {
    if (args.length === 0) return { output: SKILLS_USAGE, exitCode: 1 };
    const findings = checkFiles(where.root, args);
    if (findings.length === 0) return { output: `Design check: no findings in ${args.length} file${args.length === 1 ? '' : 's'}.`, exitCode: 0 };
    // A non-zero exit lets a script or CI stop on findings.
    return { output: renderFindings(findings).join('\n'), exitCode: 1 };
  }

  return { output: SKILLS_USAGE, exitCode: 1 };
}
