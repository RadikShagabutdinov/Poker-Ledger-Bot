/** Mini App screens reachable by `start_param` (SPEC §12.1). */
export type StartTarget = 'game' | 'chat' | 'settings';

const PREFIX: Record<StartTarget, string> = { game: 'g', chat: 'c', settings: 's' };

export interface LinkConfig {
  readonly botUsername: string;
  readonly miniAppShortName: string;
}

/** Builds Mini App direct links; in groups they are URL buttons (V1-MSG-05). */
export interface MiniAppLinks {
  /** `https://t.me/<bot>/<app>` without a start parameter. */
  readonly app: string;
  to(target: StartTarget, id: string): string;
}

export function miniAppLinks(config: LinkConfig): MiniAppLinks {
  const app = `https://t.me/${config.botUsername}/${config.miniAppShortName}`;
  return {
    app,
    to: (target, id) => `${app}?startapp=${PREFIX[target]}_${id}`,
  };
}
