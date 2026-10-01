import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@pokerledger/shared',
    environment: 'node',
  },
});
