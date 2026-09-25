import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  projects: [
    { name: 'fixtures', testMatch: 'flow.spec.ts' },
    {
      name: 'live-setup',
      testMatch: ['live-setup.spec.ts', 'microphone-setup.spec.ts'],
      use: { baseURL: 'http://localhost:5175' },
    },
  ],
  use: {
    baseURL: 'http://localhost:5174',
    channel: 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5174/api/health',
      reuseExistingServer: false,
      env: {
        PORT: '5174',
        PHIER_DB_PATH: ':memory:',
        PHIER_PROVIDER: 'mock',
        PHIER_ENABLE_DEMO: 'true',
      },
      timeout: 30_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5175/api/health',
      reuseExistingServer: false,
      env: {
        PORT: '5175',
        PHIER_DB_PATH: ':memory:',
        PHIER_PROVIDER: 'openai',
        PHIER_ENABLE_DEMO: 'false',
        OPENAI_API_KEY: '',
      },
      timeout: 30_000,
    },
  ],
});
