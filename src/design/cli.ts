// The `skills:*` commands. They only read files, so like the memory commands
// they return text and an exit code and need no database or model key.

import { detectDesignTask } from './detect.js';
import { loadCatalog, loadDesignSetting, selectSkills } from './skills.js';

export const SKILLS_USAGE = `Design skill commands:
  skills:list                                 show the design skills ACP ships, their source and licence
  skills:check [--files a,b] "<request>"      say whether a request is design work and which skills it would get`;

export function runDesignCommand(command: string, args: string[], where: { root: string }): { output: string; exitCode: number } {
  if (command === 'skills:list') {
    const rows = loadCatalog().map(skill => [
      skill.name,
      skill.role === 'default' ? 'always' : 'when asked',
      skill.licence,
      // Twelve characters identify a commit and keep the line readable.
      `${skill.repository}@${skill.commit.slice(0, 12)}`,
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
    const skills = found.design ? selectSkills(loadCatalog(), request, loadDesignSetting(where.root)) : [];
    return {
      output: [
        `Design task: ${found.design ? `yes (${found.reasons.join('; ')})` : 'no'}`,
        `Skills: ${skills.map(skill => skill.name).join(', ') || 'none'}`,
      ].join('\n'),
      exitCode: 0,
    };
  }

  return { output: SKILLS_USAGE, exitCode: 1 };
}
