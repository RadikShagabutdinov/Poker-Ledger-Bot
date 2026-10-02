import { describe, expect, it } from 'vitest';

import { startParamToPath } from './startParam';

describe('startParamToPath', () => {
  it('maps the prefixes of SPEC §12.1', () => {
    expect(startParamToPath('g_q7Xh2kLm9PaZ')).toBe('/games/q7Xh2kLm9PaZ');
    expect(startParamToPath('c_c9d8-x_1')).toBe('/chats/c9d8-x_1');
    expect(startParamToPath('s_c9d8')).toBe('/chats/c9d8/settings');
  });

  it('opens «My chats» without a parameter', () => {
    expect(startParamToPath(undefined)).toBe('/');
    expect(startParamToPath('')).toBe('/');
  });

  it('ignores unknown prefixes and malformed ids', () => {
    expect(startParamToPath('x_abc')).toBe('/');
    expect(startParamToPath('g_')).toBe('/');
    expect(startParamToPath('g_../etc')).toBe('/');
    expect(startParamToPath('gabc')).toBe('/');
    expect(startParamToPath(`c_${'a'.repeat(65)}`)).toBe('/');
  });
});
