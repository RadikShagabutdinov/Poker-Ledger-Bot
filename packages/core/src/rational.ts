import { CoreError, assertSafeInt } from './errors';

/** Exact fraction `num / den` with `den > 0` and `gcd(|num|, den) = 1`. */
export interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

/** Builds a normalized fraction. Throws `CoreError` on a zero denominator. */
export function rat(num: bigint, den = 1n): Rational {
  if (den === 0n) {
    throw new CoreError('Rational denominator must not be zero');
  }
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return g > 1n ? { num: num / g, den: den / g } : { num, den };
}

/** Fraction from a safe integer `number`. */
export function fromInt(value: number): Rational {
  assertSafeInt(value, 'value');
  return { num: BigInt(value), den: 1n };
}

export const ZERO: Rational = { num: 0n, den: 1n };

export function add(a: Rational, b: Rational): Rational {
  return rat(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function sub(a: Rational, b: Rational): Rational {
  return rat(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function mul(a: Rational, b: Rational): Rational {
  return rat(a.num * b.num, a.den * b.den);
}

export function div(a: Rational, b: Rational): Rational {
  if (b.num === 0n) {
    throw new CoreError('Division by zero');
  }
  return rat(a.num * b.den, a.den * b.num);
}

/** Returns -1, 0 or 1. */
export function cmp(a: Rational, b: Rational): -1 | 0 | 1 {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

export function isZero(a: Rational): boolean {
  return a.num === 0n;
}

/** Largest integer `≤ a` (rounds toward −∞, also for negative values). */
export function floor(a: Rational): bigint {
  const q = a.num / a.den;
  return a.num < 0n && q * a.den !== a.num ? q - 1n : q;
}

/** Converts a bigint to a safe integer `number`, throwing `CoreError` on overflow. */
export function toSafeInt(value: bigint, what = 'value'): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new CoreError(`${what} is out of the safe integer range`);
  }
  return Number(value);
}
