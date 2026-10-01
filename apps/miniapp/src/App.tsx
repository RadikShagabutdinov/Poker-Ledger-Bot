import { CORE_PACKAGE } from '@pokerledger/core';

// Screens (SPEC §12) and @tma.js init are added in stage 5.
export function App() {
  return (
    <main>
      <h1>Poker Ledger</h1>
      <p hidden>{CORE_PACKAGE}</p>
    </main>
  );
}
