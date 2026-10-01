import { z } from 'zod';

// Shared zod schemas, API types and error codes are added in later stages (SPEC §9.3, §11).
export const SHARED_PACKAGE = '@pokerledger/shared';

/** Game ID: nanoid(12) (SPEC §10). */
export const gameIdSchema = z.string().regex(/^[A-Za-z0-9_-]{12}$/);
