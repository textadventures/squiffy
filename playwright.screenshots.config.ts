import { defineConfig, devices } from "@playwright/test";

// The docs' screenshots (e2e/screenshots/), taken from the editor and from VS Code for the web:
// `npm run screenshots`, or `npm run screenshots -- editor` for the files matching "editor". They
// aren't tests, and don't run in CI. See .claude/skills/docs-screenshots/SKILL.md.
export default defineConfig({
    testDir: "./e2e/screenshots",
    testMatch: "*.capture.ts",
    // One at a time, as they share the editor's browser storage and VS Code's server
    workers: 1,
    reporter: "list",
    timeout: 120_000,
    use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:5188",
        // Twice the pixels, so text stays sharp when the docs scale a picture down
        deviceScaleFactor: 2,
        viewport: { width: 1440, height: 810 },
        colorScheme: "light",
        reducedMotion: "reduce",
        locale: "en-GB",
        timezoneId: "Europe/London",
    },
    webServer: [
        {
            command: "npm run dev --workspace app",
            // The links "A link" makes go to the real player, not a local one
            env: { PORT: "5188", VITE_PLAYER_URL: "https://squiffystories.com" },
            url: "http://localhost:5188",
            reuseExistingServer: true,
            timeout: 60_000,
        },
        {
            // The player, which e2e/screenshots/lib.ts serves in place of squiffystories.com, for
            // Play in a new tab
            command: "npm run dev --workspace player",
            url: "http://localhost:5181/v7/",
            reuseExistingServer: true,
            timeout: 60_000,
        },
        {
            // VS Code for the web, with the extension as it's built in vscode/dist, on the game show.
            // It downloads VS Code the first time.
            command: "npx vscode-test-web --browser none --quality stable --port 3123 --extensionDevelopmentPath=vscode"
                + " --testRunnerDataDir=node_modules/.cache/vscode-test-web examples/gameshow",
            url: "http://localhost:3123",
            reuseExistingServer: true,
            timeout: 120_000,
        },
    ],
});
