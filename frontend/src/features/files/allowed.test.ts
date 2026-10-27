import {describe, expect, it} from 'vitest';
import {allowedAt} from './FilesView';
import type {Project} from '../../lib/types';

const home: Project = {id: 'home', name: 'Home', path: 'C:\\Users\\me', permission: 'read-only'};
const code: Project = {id: 'code', name: 'Code', path: 'C:\\Users\\me\\code', permission: 'full'};

describe('allowedAt', () => {
  it('uses the strictest project a path is in, like the backend', () => {
    expect(allowedAt([home, code], 'C:\\Users\\me\\code\\app', 'write')).toBe(false);
    expect(allowedAt([code], 'C:\\Users\\me\\code\\app', 'write')).toBe(true);
    expect(allowedAt([code], 'D:\\elsewhere', 'read')).toBe(false);
  });

  it('checks projects inside a folder for changes to the whole folder', () => {
    const docs: Project = {id: 'docs', name: 'Docs', path: 'C:\\Users\\me\\code\\docs', permission: 'read-only'};
    expect(allowedAt([code, docs], 'C:\\Users\\me\\code', 'delete', true)).toBe(false);
    expect(allowedAt([code, docs], 'C:\\Users\\me\\code\\src', 'delete', true)).toBe(true);
  });

  it('follows Custom permissions capability by capability', () => {
    const custom = (allow: Project['allow']): Project => ({id: 'c', name: 'C', path: 'C:\\c', permission: 'custom', allow});
    expect(allowedAt([custom(['delete'])], 'C:\\c\\x', 'delete')).toBe(true);
    expect(allowedAt([custom(['delete'])], 'C:\\c\\x', 'write')).toBe(false);
    expect(allowedAt([custom(['write'])], 'C:\\c\\x', 'delete')).toBe(false);
    expect(allowedAt([{...code, permission: 'read-write'}], 'C:\\Users\\me\\code\\x', 'delete')).toBe(true);
  });
});
