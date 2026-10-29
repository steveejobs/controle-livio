import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3010';

export default defineConfig({
  testDir: './apps/web/e2e',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : 'list',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? 'test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: process.env.PLAYWRIGHT_CHROME_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
      : undefined,
  },
  webServer: {
    command: 'npm run start -w @livio/web -- -p 3010',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
