import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const configuredChrome = process.env.NEXUSIMAGE_CHROME
  ?? (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
const chromiumUse = configuredChrome && existsSync(configuredChrome)
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
