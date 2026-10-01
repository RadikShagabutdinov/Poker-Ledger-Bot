import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('miniapp smoke', () => {
  it('renders the empty page', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Poker Ledger');
    expect(html).toContain('@pokerledger/core');
  });
});
