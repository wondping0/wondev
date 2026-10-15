import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileAtomic } from '../src/util/fs.js';
import { cleanup, read, tmpRoot, write } from './helpers.js';

let root: string;
beforeEach(async () => { root = await tmpRoot(); });
afterEach(async () => { vi.restoreAllMocks(); await cleanup(root); });

describe('atomic replacement with file contention', () => {
  it('retries transient replacement failures without losing the destination', async () => {
    await write(root, 'note.md', 'original');
    const rename = vi.spyOn(fs, 'rename')
      .mockRejectedValueOnce(Object.assign(new Error('reader holds file'), { code: 'EPERM' }))
      .mockRejectedValueOnce(Object.assign(new Error('reader still holds file'), { code: 'EBUSY' }));
    await writeFileAtomic(path.join(root, 'note.md'), 'updated');
    expect(rename).toHaveBeenCalledTimes(3);
    expect(await read(root, 'note.md')).toBe('updated');
    expect(await fs.readdir(root)).toEqual(['note.md']);
  });

  it('bounds retries, preserves the original, and removes the temporary file on failure', async () => {
    await write(root, 'note.md', 'original');
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const rename = vi.spyOn(fs, 'rename').mockRejectedValue(denied);
    await expect(writeFileAtomic(path.join(root, 'note.md'), 'updated')).rejects.toBe(denied);
    expect(rename).toHaveBeenCalledTimes(6);
    expect(await read(root, 'note.md')).toBe('original');
    expect(await fs.readdir(root)).toEqual(['note.md']);
  });

  it('does not retry unrelated filesystem errors', async () => {
    await write(root, 'note.md', 'original');
    const invalid = Object.assign(new Error('invalid replacement'), { code: 'EINVAL' });
    const rename = vi.spyOn(fs, 'rename').mockRejectedValue(invalid);
    await expect(writeFileAtomic(path.join(root, 'note.md'), 'updated')).rejects.toBe(invalid);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(await read(root, 'note.md')).toBe('original');
    expect(await fs.readdir(root)).toEqual(['note.md']);
  });
});
