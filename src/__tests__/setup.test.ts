import { describe, it, expect } from 'vitest';

describe('Vitest setup', () => {
  it('should run a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('should have access to jsdom environment', () => {
    expect(typeof document).toBe('object');
    expect(typeof window).toBe('object');
  });
});
