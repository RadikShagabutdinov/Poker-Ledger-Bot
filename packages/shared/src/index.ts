// Shared zod schemas, API types and error codes (SPEC §9.3, §11).
export const SHARED_PACKAGE = '@pokerledger/shared';

export { ERROR_CODES, type ApiError, type ErrorCode } from './errors';
export {
  buyChipsSchema,
  chatSettingsPatchSchema,
  chipsSchema,
  currencySchema,
  displayNameSchema,
  gameIdSchema,
  gameNameSchema,
  gameNameTemplateSchema,
  guestNameSchema,
  languageSchema,
  mismatchModeSchema,
  payBankSchema,
  payNoteSchema,
  payPhoneSchema,
  profilePatchSchema,
  quickBuyinsSchema,
  stackSchema,
  transferSchema,
  type ChatSettingsPatch,
  type Language,
  type ProfilePatch,
} from './schemas';
