import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e/integrated',
  testMatch: '*.integrated.e2e.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: process.env.LIVIO_QA_OUTPUT
    ? `${process.env.LIVIO_QA_OUTPUT}/integrated-test-results`
    : 'integrated-test-results',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.LIVIO_PLAYWRIGHT_REPORT_RAW ??
          (process.env.LIVIO_QA_OUTPUT
            ? `${process.env.LIVIO_QA_OUTPUT}/integrated-playwright-report.json`
            : 'integrated-playwright-report.json'),
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3010',
    browserName: 'chromium',
    headless: true,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
});
