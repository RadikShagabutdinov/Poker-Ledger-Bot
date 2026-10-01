import { describe, expect, it } from 'vitest';

import { CORE_PACKAGE } from './index';

describe('core smoke', () => {
  it('exports the package marker', () => {
    expect(CORE_PACKAGE).toBe('@pokerledger/core');
  });

  it('runs with BigInt support', () => {
    expect(10n ** 20n / 3n).toBe(33333333333333333333n);
  });
});
