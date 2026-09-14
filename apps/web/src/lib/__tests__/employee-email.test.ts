import { describe, expect, it } from 'vitest';
import { deriveCompanyEmail } from '../employee-onboarding';

describe('deriveCompanyEmail', () => {
  it('uses the full first syllable and initials for the remaining name', () => {
    expect(deriveCompanyEmail('王小明')).toBe('wangxm@example.com');
    expect(deriveCompanyEmail('李佳佳')).toBe('lijj@example.com');
  });

  it('returns null when a name cannot be converted reliably', () => {
    expect(deriveCompanyEmail(null)).toBeNull();
    expect(deriveCompanyEmail('A')).toBeNull();
    expect(deriveCompanyEmail('toby')).toBeNull();
  });
});
