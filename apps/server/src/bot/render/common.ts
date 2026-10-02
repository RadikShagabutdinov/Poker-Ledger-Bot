import { add, chipsToMoney, floor, fromInt, rat, toSafeInt } from '@pokerledger/core';
import type { InlineKeyboardMarkup } from 'grammy/types';

/** A chat message in HTML parse mode; without `keyboard` buttons are removed. */
export interface RenderedMessage {
  readonly text: string;
  readonly keyboard?: InlineKeyboardMarkup;
}

/** Money equivalent of chips, rounded half up, for display only. */
export function approxMoney(chips: number, stack: { chips: number; amount: number }): number {
  return toSafeInt(floor(add(chipsToMoney(fromInt(chips), stack), rat(1n, 2n))), 'money');
}

export function urlButton(
  text: string,
  url: string,
): InlineKeyboardMarkup['inline_keyboard'][0][0] {
  return { text, url };
}
