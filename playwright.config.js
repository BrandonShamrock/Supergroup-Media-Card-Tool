import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:5175', launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {} },
  webServer: [{
    command: 'npm run dev -- --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'https://auth.example.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture_only',
    },
  }, {
    command: 'npm run dev -- --port 5176 --strictPort',
    url: 'http://localhost:5176',
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
  }],
});
