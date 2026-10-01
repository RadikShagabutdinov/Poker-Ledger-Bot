import { describe, expect, it } from 'vitest';

import { SHARED_PACKAGE, gameIdSchema } from './index';

describe('shared smoke', () => {
  it('exports the package marker', () => {
    expect(SHARED_PACKAGE).toBe('@pokerledger/shared');
  });

  it('validates with zod', () => {
    expect(gameIdSchema.safeParse('V1StGXR8_Z5j').success).toBe(true);
    expect(gameIdSchema.safeParse('short').success).toBe(false);
  });
});
