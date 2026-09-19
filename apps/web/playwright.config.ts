import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // Mobile-viewport specs run in the touch projects below.
      testIgnore: /mobile\.spec\.ts/,
      // Pinned so the WebGL hero gate (which refuses under reduced motion) is
      // deterministic regardless of the host's animation settings.
      use: { ...devices['Desktop Chrome'], reducedMotion: 'no-preference' },
    },
    {
      name: 'mobile-pixel5',
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['Pixel 5'], reducedMotion: 'no-preference' },
    },
    {
      name: 'mobile-320',
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 320, height: 568 },
        reducedMotion: 'no-preference',
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
