import { describe, expect, it } from 'vitest';

import { describeServer } from './main';

describe('server smoke', () => {
  it('imports workspace packages', () => {
    expect(describeServer()).toContain('@pokerledger/core');
    expect(describeServer()).toContain('@pokerledger/shared');
  });
});
