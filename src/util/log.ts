/**
 * Minimal ANSI output. Colour is disabled for non-TTY stdout, `NO_COLOR`, and `--no-color`
 * so piped output and CI logs stay clean.
 */

let colorEnabled = process.stdout.isTTY === true && !process.env['NO_COLOR'];

export function setColor(enabled: boolean): void {
  colorEnabled = enabled;
}

/** Escape written as a unicode sequence so the source file stays plain ASCII. */
const ESC = '';

function wrap(code: string, close: string) {
  return (s: string): string => (colorEnabled ? `${ESC}[${code}m${s}${ESC}[${close}m` : s);
}

export const style = {
  bold: wrap('1', '22'),
  dim: wrap('2', '22'),
  red: wrap('31', '39'),
  green: wrap('32', '39'),
  yellow: wrap('33', '39'),
  blue: wrap('34', '39'),
  cyan: wrap('36', '39'),
};

export function info(msg = ''): void {
  process.stdout.write(`${msg}\n`);
}

export function success(msg: string): void {
  process.stdout.write(`${style.green('+')} ${msg}\n`);
}

export function warn(msg: string): void {
  process.stderr.write(`${style.yellow('!')} ${msg}\n`);
}

export function error(msg: string): void {
  process.stderr.write(`${style.red('x')} ${msg}\n`);
}

export function step(msg: string): void {
  process.stdout.write(`${style.dim('-')} ${msg}\n`);
}
