import { WondevError } from '../util/errors.js';
import { isInsideRoot } from '../util/paths.js';

/** Small, portable glob grammar: *, **, ?, and brace alternatives. */
export function matchesGlob(file: string, pattern: string): boolean {
  if (!pattern || !isInsideRoot(pattern) || /[\\\[\]]/.test(pattern)) {
    throw new WondevError(`Unsupported project glob: ${pattern}`, 'Use repository-relative paths with /, *, **, ?, or {a,b}.');
  }
  const brace = /\{([^{}]+)\}/.exec(pattern);
  if (brace) {
    return brace[1]!.split(',').some((choice) => matchesGlob(file, pattern.slice(0, brace.index) + choice + pattern.slice(brace.index + brace[0].length)));
  }
  let expression = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { expression += '(?:.*/)?'; i++; }
      else expression += '.*';
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${expression}$`).test(file.replace(/\\/g, '/').replace(/^\.\//, ''));
}

export function matchesPatterns(file: string, patterns: string[]): boolean {
  const positive = patterns.filter((p) => !p.startsWith('!'));
  return positive.some((p) => matchesGlob(file, p)) && !patterns.filter((p) => p.startsWith('!')).some((p) => matchesGlob(file, p.slice(1)));
}
