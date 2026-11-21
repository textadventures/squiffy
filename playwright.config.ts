import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:8282",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      testIgnore: "editor/**",
      use: { ...devices["Desktop Chrome"] },
    },
    // The editor (app/), from its dev server: `npx playwright test --project=editor`
    {
      name: "editor",
      testDir: "./e2e/editor",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5188", viewport: { width: 1400, height: 850 } },
    },
    // Uncomment to test in Firefox (run: npx playwright install firefox)
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // Uncomment to test in WebKit/Safari (run: npx playwright install webkit)
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  webServer: [
    {
      command: "node e2e/test-server.js",
      url: "http://localhost:8282",
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run dev --workspace app",
      env: { PORT: "5188" },
      url: "http://localhost:5188",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
