import { describe, expect, it } from 'vitest';
import { normalizeEmployeeLookupName } from '../employee-lookup-name';

describe('normalizeEmployeeLookupName', () => {
  it('normalizes width, surrounding whitespace, internal whitespace, and case', () => {
    expect(normalizeEmployeeLookupName('  Ａlice\t ZHANG  ')).toBe('alice zhang');
  });

  it('preserves Chinese names while normalizing compatibility characters', () => {
    expect(normalizeEmployeeLookupName('  张　婷  ')).toBe('张 婷');
  });
});
