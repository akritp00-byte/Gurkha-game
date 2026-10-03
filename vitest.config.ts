import { defineConfig } from 'vitest/config';

// Unit tests live next to the code they cover as `*.test.ts`. Browser tests live in e2e/ (Playwright).
export default defineConfig({
  test: {
    projects: ['shared', 'server', 'client'].map((name) => ({
      test: { name, root: `./${name}`, environment: 'node' },
    })),
  },
});
