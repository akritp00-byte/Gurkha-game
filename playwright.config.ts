import { defineConfig, devices } from '@playwright/test';

const CLIENT_URL = 'http://localhost:5173';
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: CLIENT_URL,
    trace: 'retain-on-failure',
    // Test machines have no GPU: opt in to software WebGL explicitly (Chrome is phasing out the
    // automatic fallback). Frame rates measured this way say nothing about real hardware.
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  // Exercise the real dev setup: `pnpm dev` starts the client and the game server together.
  webServer: {
    command: 'pnpm dev',
    url: CLIENT_URL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
