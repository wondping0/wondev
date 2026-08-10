import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | undefined;

/**
 * The running wondev version, read from the package manifest.
 *
 * Stamped into generated projects so a later release can tell what produced them. Resolves
 * two levels up, which is the package root both from `dist/util/` and from `src/util/`.
 */
export function wondevVersion(): string {
  if (cached !== undefined) return cached;
  const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { version?: string };
    cached = parsed.version ?? '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}
