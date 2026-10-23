// A player's chip events split into sessions at the table: buy-in, rebuys, cash-out.
import type { LogEntry } from '../game/events';

export type ChipEntry = LogEntry & { readonly chips: number; readonly playerId: string };

export interface Session {
  readonly buyIn: ChipEntry;
  readonly rebuys: readonly ChipEntry[];
  /** `null` only while the player is seated, which a finished game does not have. */
  readonly cashOut: ChipEntry | null;
}

function isLiveChipEntry(entry: LogEntry): entry is ChipEntry {
  return (
    entry.cancelled === null &&
    entry.chips !== null &&
    entry.playerId !== null &&
    (entry.type === 'buy_in' || entry.type === 'rebuy' || entry.type === 'cash_out')
  );
}

/** Sessions of `playerId` from the log (oldest first), ignoring cancelled events. */
export function playerSessions(entries: readonly LogEntry[], playerId: string): Session[] {
  const sessions: { buyIn: ChipEntry; rebuys: ChipEntry[]; cashOut: ChipEntry | null }[] = [];
  for (const entry of entries) {
    if (!isLiveChipEntry(entry) || entry.playerId !== playerId) continue;
    const current = sessions.at(-1);
    if (entry.type === 'buy_in') {
      sessions.push({ buyIn: entry, rebuys: [], cashOut: null });
    } else if (current && current.cashOut === null) {
      if (entry.type === 'rebuy') current.rebuys.push(entry);
      else current.cashOut = entry;
    }
  }
  return sessions;
}

/** All event ids of a session, for cancelling it as a whole. */
export function sessionEventIds(session: Session): number[] {
  return [
    session.buyIn.id,
    ...session.rebuys.map((e) => e.id),
    ...(session.cashOut ? [session.cashOut.id] : []),
  ];
}
