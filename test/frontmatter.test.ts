import { describe, expect, it } from 'vitest';
import {
  asBoolean,
  asString,
  asStringArray,
  parseFrontmatter,
  stringifyFrontmatter,
} from '../src/core/frontmatter.js';
import { WondevError } from '../src/util/errors.js';

describe('parseFrontmatter', () => {
  it('splits frontmatter from body', () => {
    const { data, body } = parseFrontmatter('---\nname: x\n---\n\nHello\n', 'f.md');
    expect(data).toEqual({ name: 'x' });
    expect(body).toBe('Hello');
  });

  it('treats a document with no frontmatter as all body', () => {
    const { data, body } = parseFrontmatter('# Title\n\ntext', 'f.md');
    expect(data).toEqual({});
    expect(body).toBe('# Title\n\ntext');
  });

  it('tolerates a leading BOM', () => {
    const bom = String.fromCharCode(0xfeff);
    const { data } = parseFrontmatter(`${bom}---\nname: x\n---\n\nbody`, 'f.md');
    expect(data).toEqual({ name: 'x' });
  });

  it('tolerates CRLF line endings', () => {
    const { data, body } = parseFrontmatter('---\r\nname: x\r\n---\r\n\r\nbody', 'f.md');
    expect(data).toEqual({ name: 'x' });
    expect(body).toBe('body');
  });

  it('treats an empty frontmatter block as no data', () => {
    const { data, body } = parseFrontmatter('---\n\n---\n\nbody', 'f.md');
    expect(data).toEqual({});
    expect(body).toBe('body');
  });

  it('reports the file when the YAML is invalid', () => {
    expect(() => parseFrontmatter('---\na: [1,\n---\n\nbody', 'bad.md')).toThrow(WondevError);
    expect(() => parseFrontmatter('---\na: [1,\n---\n\nbody', 'bad.md')).toThrow(/bad\.md/);
  });

  it('rejects frontmatter that is not a mapping', () => {
    expect(() => parseFrontmatter('---\n- a\n- b\n---\n\nbody', 'list.md')).toThrow(WondevError);
  });

  it('does not treat a horizontal rule mid-document as frontmatter', () => {
    const { data, body } = parseFrontmatter('intro\n\n---\n\nmore', 'f.md');
    expect(data).toEqual({});
    expect(body).toContain('intro');
  });
});

describe('stringifyFrontmatter', () => {
  it('round-trips through the parser', () => {
    const out = stringifyFrontmatter({ name: 'x', always: true }, 'Body text');
    const { data, body } = parseFrontmatter(out, 'f.md');
    expect(data).toEqual({ name: 'x', always: true });
    expect(body).toBe('Body text');
  });

  it('omits the block entirely when there is no data', () => {
    expect(stringifyFrontmatter({}, 'Body')).toBe('Body\n');
  });

  it('drops null and undefined keys', () => {
    const out = stringifyFrontmatter({ a: 1, b: undefined, c: null }, 'Body');
    expect(out).toContain('a: 1');
    expect(out).not.toContain('b:');
    expect(out).not.toContain('c:');
  });
});

describe('coercion helpers', () => {
  it('asString rejects blank strings', () => {
    expect(asString('  x ')).toBe('x');
    expect(asString('   ')).toBeUndefined();
    expect(asString(5)).toBeUndefined();
  });

  it('asBoolean only accepts real booleans', () => {
    expect(asBoolean(true)).toBe(true);
    expect(asBoolean('true')).toBeUndefined();
  });

  it('asStringArray accepts a bare string or a list', () => {
    expect(asStringArray('src/**')).toEqual(['src/**']);
    expect(asStringArray(['a', ' b '])).toEqual(['a', 'b']);
    expect(asStringArray([])).toBeUndefined();
    expect(asStringArray(7)).toBeUndefined();
  });
});
