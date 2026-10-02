/** Escapes a user string for Telegram HTML parse mode (SEC-08). */
export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** A Telegram user mention that notifies them (SPEC §13.4). */
export function mention(tgUserId: number, name: string): string {
  return `<a href="tg://user?id=${String(tgUserId)}">${escapeHtml(name)}</a>`;
}
