/**
 * Just enough semver to answer "is this version newer than that one".
 *
 * A dependency would be overkill for one comparison, and wondev's near-zero-dependency
 * stance is a deliberate part of its `npx` cold-start time.
 */

interface Parsed {
  parts: [number, number, number];
  prerelease: string | undefined;
}

function parse(version: string): Parsed | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4],
  };
}

/** Negative when a < b, zero when equal, positive when a > b. Unparseable sorts lowest. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  for (let i = 0; i < 3; i += 1) {
    const diff = (pa.parts[i] ?? 0) - (pb.parts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }

  // 1.0.0-rc.1 precedes 1.0.0. Prereleases are compared as plain strings, which is enough
  // for ordering wondev's own releases.
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === undefined) return 1;
  if (pb.prerelease === undefined) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

export function isNewerThan(a: string, b: string): boolean {
  return compareVersions(a, b) > 0;
}
