// Path matching for memory rules (ADR-0008 §9g).
//
// A rule says which files it applies to with patterns such as `src/api/**`.
// We match them ourselves instead of adding a glob library: the project uses
// Node built-ins only, and rules need just three wildcards.

/** Makes Windows paths and a leading "./" look like plain repository paths. */
function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

const cache = new Map<string, RegExp>();

function toRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;

  let glob = normalize(pattern);
  // "src/api" with no wildcard means the folder and everything inside it.
  // People write rules for a folder far more often than for a single file,
  // and a single file still matches through the `(/.*)?` tail below.
  const isPlainPath = !/[*?]/.test(glob);

  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      // "**/" may match nothing, so "**/*.css" also matches "site.css".
      if (glob[i + 2] === '/') { source += '(?:.*/)?'; i += 2; }
      else { source += '.*'; i += 1; }
    } else if (char === '*') {
      source += '[^/]*'; // one folder level only
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const compiled = new RegExp(`^${source}${isPlainPath ? '(?:/.*)?' : ''}$`);
  cache.set(pattern, compiled);
  return compiled;
}

/** True when `file` (a path relative to the repository root) fits `pattern`. */
export function matchesPath(pattern: string, file: string): boolean {
  return toRegExp(pattern).test(normalize(file));
}

/**
 * How narrow a pattern is. "Narrower wins" (ADR-0008 §9g) needs an order, and
 * the number of fixed folder names before the first wildcard is a measure
 * people can predict: `src/api/account/**` (3) beats `src/**` (1).
 */
export function specificity(pattern: string): number {
  let fixed = 0;
  for (const segment of normalize(pattern).split('/')) {
    if (/[*?]/.test(segment)) break;
    fixed += 1;
  }
  return fixed;
}
