import { describe, expect, it } from 'vitest';
import routeTitle from './routeTitle';

describe('routeTitle', () => {
  it('resolves known route prefixes and falls back to the overview title', () => {
    const translate = (key: string) => key;

    expect(routeTitle('/students/123', translate)).toBe('students');
    expect(routeTitle('/communications', translate)).toBe('communications');
    expect(routeTitle('/', translate)).toBe('overview');
  });
});
