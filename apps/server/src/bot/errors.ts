import { GrammyError } from 'grammy';

import { ServiceError } from '../services';

/**
 * Callback notification key for an error of a button action (V1-MSG-03/06), or
 * `undefined` for an unexpected error (shown as a generic one and logged).
 */
export function notificationKey(error: unknown): string | undefined {
  if (!(error instanceof ServiceError)) {
    return undefined;
  }
  switch (error.code) {
    case 'INVALID_EVENT_SEQUENCE': {
      const reason = error.details?.reason;
      if (reason === 'ALREADY_SEATED') {
        return 'notify.alreadySeated';
      }
      if (reason === 'NOT_SEATED') {
        return 'notify.notSeated';
      }
      return error.details?.blockingEventId === undefined ? 'notify.error' : 'notify.blocked';
    }
    case 'NOTHING_TO_UNDO':
      return 'notify.nothingToUndo';
    case 'NOT_CHAT_MEMBER':
      return 'notify.notMember';
    case 'NOT_FOUND':
      return 'notify.notFound';
    case 'INVALID_GAME_STATUS':
      return 'notify.notActive';
    default:
      return 'notify.error';
  }
}

/** Telegram error about a message that no longer exists. */
export function isMessageGone(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    /message to edit not found|message_id_invalid|message not found/i.test(error.description)
  );
}

export function isNotModified(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    error.description.includes('message is not modified')
  );
}

/** The bot can no longer write to the chat (removed, kicked, chat deleted). */
export function isBotRemoved(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    (error.error_code === 403 || /chat not found/i.test(error.description))
  );
}
