import { defineConfig, devices } from '@playwright/test';

const configuredChrome = process.env.NEXUSIMAGE_CHROME;
const chromiumUse = configuredChrome
  ? { ...devices['Desktop Chrome'], launchOptions: { executablePath: configuredChrome } }
  : { ...devices['Desktop Chrome'] };

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.browser.spec.ts',
  timeout: 45_000,
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['line']] : [['list']],
  use: {
    baseURL: 'about:blank',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: chromiumUse },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
