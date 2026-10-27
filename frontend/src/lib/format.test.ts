import {describe, expect, it} from 'vitest';
import {between, firstTime, formatDateTime, relativeTime, validTime} from './format';

describe('times from Go', () => {
  const zero = '0001-01-01T00:00:00Z';
  it('treats the zero time as unset', () => {
    expect(validTime(zero)).toBe(false);
    expect(validTime('2026-10-26T09:00:00Z')).toBe(true);
    expect(formatDateTime(zero)).toBe('');
    expect(relativeTime(zero)).toBe('');
    expect(between(zero, '2026-10-26T09:00:00Z')).toBeUndefined();
    expect(firstTime(zero, '2026-10-26T09:00:00Z')).toBe('2026-10-26T09:00:00Z');
  });
});
