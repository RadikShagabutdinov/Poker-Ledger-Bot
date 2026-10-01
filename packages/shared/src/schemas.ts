import { z } from 'zod';

/** Game ID: nanoid(12) (V1-GAME-05). */
export const gameIdSchema = z.string().regex(/^[A-Za-z0-9_-]{12}$/);

export const languageSchema = z.enum(['ru', 'en']);
export type Language = z.infer<typeof languageSchema>;

const supportedCurrencies = new Set(Intl.supportedValuesOf('currency'));

/** ISO 4217 currency code (V1-SET-02). */
export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((code) => supportedCurrencies.has(code));

const positiveInt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Chip count entered by a user: integer ≥ 0. */
export const chipsSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Chips bought: integer > 0 (V1-PLAY-01). */
export const buyChipsSchema = positiveInt;

/** Stack value: `chips` chips cost `amount` money units, both integers > 0 (V1-SET-01). */
export const stackSchema = z.object({ chips: positiveInt, amount: positiveInt });

/** Quick buy-in sizes in fractions of a stack, 1–4 values (V1-SET-05). */
export const quickBuyinsSchema = z.array(z.number().positive().max(100)).min(1).max(4);

export const guestNameSchema = z.string().trim().min(1).max(40);
export const displayNameSchema = guestNameSchema;
export const gameNameSchema = z.string().trim().min(1).max(100);
export const gameNameTemplateSchema = z.string().trim().min(1).max(100);

export const payPhoneSchema = z.string().trim().min(1).max(32);
export const payBankSchema = z.string().trim().min(1).max(100);
export const payNoteSchema = z.string().trim().min(1).max(200);

/** Mismatch adjustment (V1-FIN-04). */
export const mismatchModeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('proportional') }),
  z.object({ mode: z.literal('single_player'), playerId: z.string().min(1) }),
]);

/** `PATCH /chats/:chatId/settings`. */
export const chatSettingsPatchSchema = z
  .object({
    language: languageSchema,
    currency: currencySchema,
    stack: stackSchema,
    gameNameTemplate: gameNameTemplateSchema,
    quickBuyins: quickBuyinsSchema,
  })
  .partial();
export type ChatSettingsPatch = z.infer<typeof chatSettingsPatchSchema>;

/** `PATCH /me`. `null` clears a field (V1-PROF-03). */
export const profilePatchSchema = z
  .object({
    language: languageSchema.nullable(),
    payPhone: payPhoneSchema.nullable(),
    payBank: payBankSchema.nullable(),
    payNote: payNoteSchema.nullable(),
  })
  .partial();
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

/** A transfer of a manual settlement (V1-SETL-03). */
export const transferSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  amount: z.number().int(),
});
