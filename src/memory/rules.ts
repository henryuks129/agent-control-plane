// A rule is one Markdown file in `.acp/rules/` (ADR-0008 §9g, §9l).
//
//   ---
//   paths: [src/api/account/**]
//   keywords: [password, signup]
//   check: npm test -- account
//   learned-from: TASK-0042
//   ---
//   Hash passwords with the existing helper before saving.
//
// Plain files, so a person can read, edit and review a rule in a pull request
// exactly like code, with no ACP running.

export interface Rule {
  /** File name without ".md". Used to refer to the rule everywhere else. */
  name: string;
  /** Where the rule applies. Empty means it never matches by path. */
  paths: string[];
  /** Words that make the rule relevant to a request, for the mistake guard. */
  keywords: string[];
  /** A command that can detect the mistake. Without it the rule is advice only. */
  check?: string;
  /** The task this rule was learned from, so its origin can be traced. */
  learnedFrom?: string;
  /** The rule itself, as written. */
  body: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

/**
 * Reads the header between the two `---` lines.
 *
 * This is a deliberately small subset of YAML: `key: value`, `key: [a, b]`
 * and a `key:` followed by `- item` lines. A full YAML parser would be a new
 * dependency and would accept shapes we would then have to reject.
 */
function parseHeader(lines: string[]): Record<string, string | string[]> {
  const header: Record<string, string | string[]> = {};
  let listKey: string | undefined;
  for (const line of lines) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (header[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, raw] = pair;
    const value = raw.trim();
    if (value === '') {
      header[key] = [];
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      header[key] = value.slice(1, -1).split(',').map(unquote).filter(Boolean);
      listKey = undefined;
    } else {
      header[key] = unquote(value);
      listKey = undefined;
    }
  }
  return header;
}

function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asText(value: string | string[] | undefined): string | undefined {
  if (value === undefined || Array.isArray(value)) return undefined;
  return value || undefined;
}

export function parseRule(fileName: string, text: string): Rule {
  const name = fileName.replace(/\.md$/i, '');
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  let header: Record<string, string | string[]> = {};
  let bodyLines = lines;
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1);
    // No closing line: treat the whole file as the body instead of guessing
    // where a broken header stops.
    if (end > 0) {
      header = parseHeader(lines.slice(1, end));
      bodyLines = lines.slice(end + 1);
    }
  }

  return {
    name,
    paths: asList(header.paths),
    keywords: asList(header.keywords).map(word => word.toLowerCase()),
    check: asText(header.check),
    learnedFrom: asText(header['learned-from']),
    body: bodyLines.join('\n').trim(),
  };
}
