import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  outputDir: './test-results-webkit',
  workers: 1,
  projects: [
    {
      name: 'webkit-mobile',
      testMatch: /access-mobile\.spec\.ts/,
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
  ],
});
