import { describe, expect, it } from 'vitest';

import { CoreError, assertSafeInt } from './errors';
import { add, cmp, div, floor, fromInt, isZero, mul, rat, sub, toSafeInt, ZERO } from './rational';

describe('rational', () => {
  it('normalizes sign and common factors', () => {
    expect(rat(6n, -4n)).toEqual({ num: -3n, den: 2n });
    expect(rat(0n, 5n)).toEqual(ZERO);
    expect(rat(7n)).toEqual({ num: 7n, den: 1n });
  });

  it('does arithmetic exactly', () => {
    const third = rat(1n, 3n);
    expect(add(third, rat(1n, 6n))).toEqual(rat(1n, 2n));
    expect(sub(third, third)).toEqual(ZERO);
    expect(mul(rat(2n, 3n), rat(9n, 4n))).toEqual(rat(3n, 2n));
    expect(div(rat(1n, 2n), rat(-1n, 4n))).toEqual(rat(-2n));
  });

  it('floors toward −∞', () => {
    expect(floor(rat(7n, 2n))).toBe(3n);
    expect(floor(rat(-7n, 2n))).toBe(-4n);
    expect(floor(rat(-4n, 2n))).toBe(-2n);
    expect(floor(ZERO)).toBe(0n);
  });

  it('compares', () => {
    expect(cmp(rat(1n, 3n), rat(1n, 2n))).toBe(-1);
    expect(cmp(rat(2n, 4n), rat(1n, 2n))).toBe(0);
    expect(cmp(rat(-1n, 3n), rat(-1n, 2n))).toBe(1);
    expect(isZero(rat(0n, 3n))).toBe(true);
    expect(isZero(rat(1n, 3n))).toBe(false);
  });

  it('rejects zero denominators and division by zero', () => {
    expect(() => rat(1n, 0n)).toThrow(CoreError);
    expect(() => div(rat(1n), ZERO)).toThrow(CoreError);
  });

  it('converts at the module boundary', () => {
    expect(fromInt(-5)).toEqual(rat(-5n));
    expect(() => fromInt(0.5)).toThrow(CoreError);
    expect(toSafeInt(42n)).toBe(42);
    expect(() => toSafeInt(2n ** 53n)).toThrow(CoreError);
    expect(() => toSafeInt(-(2n ** 53n))).toThrow(CoreError);
    expect(() => assertSafeInt(Number.NaN, 'x')).toThrow('x must be a safe integer');
  });
});
