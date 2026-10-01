import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@pokerledger/core',
    environment: 'node',
  },
});
