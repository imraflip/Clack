import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5174';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    headless: true,
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'npm run dev:local -- --host 127.0.0.1 --port 5174 --strictPort',
    url: `${baseURL}/splash.html`,
    stdout: 'pipe',
  },
});
