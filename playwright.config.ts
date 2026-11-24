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
      testIgnore: ["editor/**", "player/**", "site/**"],
      use: { ...devices["Desktop Chrome"] },
    },
    // The editor (app/), from its dev server: `npx playwright test --project=editor`
    {
      name: "editor",
      testDir: "./e2e/editor",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5188", viewport: { width: 1400, height: 850 } },
    },
    // The player (player/), from its dev server: `npx playwright test --project=player`
    {
      name: "player",
      testDir: "./e2e/player",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:5181" },
    },
    // The docs site (site/), from its dev server, as the beta site: `npx playwright test --project=site`
    {
      name: "site",
      testDir: "./e2e/site",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4329" },
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
    {
      command: "npm run dev --workspace player",
      url: "http://localhost:5181/v7/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run dev --workspace site -- --port 4329",
      env: { PUBLIC_BETA_SITE: "true" },
      url: "http://localhost:4329",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
