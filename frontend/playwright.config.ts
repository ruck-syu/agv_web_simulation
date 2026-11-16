import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', timeout: 90000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', headless: true, viewport: { width: 1440, height: 1000 },
    channel: 'chrome', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:3000', reuseExistingServer: true },
  reporter: [['list'], ['json', { outputFile: process.env.AGV_BROWSER_REPORT ?? '../test_logs/browser_results.json' }]],
});
