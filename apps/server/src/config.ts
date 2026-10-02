import { z } from 'zod';

// Empty values in `.env` mean "not set".
const optional = <S extends z.ZodType>(schema: S) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    BOT_TOKEN: z.string().min(1),
    BOT_USERNAME: z.string().regex(/^[A-Za-z0-9_]{5,32}$/),
    MINIAPP_SHORT_NAME: z.string().regex(/^[A-Za-z0-9_]{3,30}$/),
    /** Mini App URL for `web_app` buttons in private chats; optional. */
    MINIAPP_URL: optional(z.url({ protocol: /^https$/ })),
    /** Origin of the Mini App allowed by CORS; required in production. */
    MINIAPP_ORIGIN: optional(
      z.url({ protocol: /^https?$/ }).transform((url) => new URL(url).origin),
    ),
    DATABASE_PATH: z.string().min(1).default('./data/poker.db'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Dev only: accept unsigned initData. */
    DEV_SKIP_INIT_DATA_CHECK: optional(z.enum(['true', 'false'])).transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') {
      return;
    }
    if (env.DEV_SKIP_INIT_DATA_CHECK) {
      ctx.addIssue({ code: 'custom', path: ['DEV_SKIP_INIT_DATA_CHECK'], message: 'not allowed' });
    }
    if (env.MINIAPP_ORIGIN === undefined) {
      ctx.addIssue({ code: 'custom', path: ['MINIAPP_ORIGIN'], message: 'required' });
    }
  });

export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];

/** Server configuration from environment variables. */
export interface Config {
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly botToken: string;
  readonly botUsername: string;
  readonly miniAppShortName: string;
  readonly miniAppUrl: string | undefined;
  readonly miniAppOrigin: string | undefined;
  readonly databasePath: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  /** Never `true` in production: `loadConfig` rejects it. */
  readonly devSkipInitDataCheck: boolean;
}

/** Validates the environment; throws listing the invalid variables (never their values). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => i.path.join('.')))];
    throw new Error(`Invalid environment variables: ${names.join(', ')}`);
  }
  const e = result.data;
  return {
    nodeEnv: e.NODE_ENV,
    botToken: e.BOT_TOKEN,
    botUsername: e.BOT_USERNAME,
    miniAppShortName: e.MINIAPP_SHORT_NAME,
    miniAppUrl: e.MINIAPP_URL,
    miniAppOrigin: e.MINIAPP_ORIGIN,
    databasePath: e.DATABASE_PATH,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    devSkipInitDataCheck: e.DEV_SKIP_INIT_DATA_CHECK,
  };
}
