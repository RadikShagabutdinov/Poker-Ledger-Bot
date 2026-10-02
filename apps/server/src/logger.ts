import { pino, type Logger } from 'pino';

import type { LogLevel } from './config';

export type { Logger };

/**
 * JSON logs (SEC-09). Payment details and initData must never be logged; the
 * redaction is a safety net, not a licence to pass them in.
 */
export function createLogger(level: LogLevel): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'initData',
        '*.initData',
        'authorization',
        '*.authorization',
        '*.headers.authorization',
        'payPhone',
        'payBank',
        'payNote',
        '*.payPhone',
        '*.payBank',
        '*.payNote',
      ],
      censor: '[redacted]',
    },
  });
}
