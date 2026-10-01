import { pathToFileURL } from 'node:url';

import { CORE_PACKAGE } from '@pokerledger/core';
import { SHARED_PACKAGE } from '@pokerledger/shared';

// Bot (grammY) and HTTP API (Hono) are wired here in stages 3–4.
export function describeServer(): string {
  return `poker-ledger server (${CORE_PACKAGE}, ${SHARED_PACKAGE})`;
}

export function main(): void {
  console.log(`${describeServer()} started`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
