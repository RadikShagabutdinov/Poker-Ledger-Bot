import { nanoid } from 'nanoid';

/** Game ID: nanoid(12), unpredictable. */
export function newGameId(): string {
  return nanoid(12);
}

/** IDs of chats and chat players. */
export function newId(): string {
  return nanoid();
}
