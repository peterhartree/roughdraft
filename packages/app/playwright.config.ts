import { defineConfig, devices } from "@playwright/test";

const appPort = Number(process.env.PLAYWRIGHT_APP_PORT ?? 4318);
const apiPort = Number(process.env.API_PORT ?? 4317);
const appUrl = `http://127.0.0.1:${appPort}`;
// Reusing a server already on these ports can silently test another
// checkout's or agent's code, so a busy port fails the run unless reuse is
// asked for. Parallel runs should set PLAYWRIGHT_APP_PORT and API_PORT.
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1";
// Electron specs pass this environment on, so their windows open behind
// whatever the person at the machine is doing instead of taking focus.
process.env.ROUGHDRAFT_DESKTOP_BACKGROUND ??= "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 7_500,
  },
  // Open intents target one renderer by design, so parallel browser pages can
  // steal each other's navigation requests and create false failures.
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: appUrl,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `API_PORT=${apiPort} pnpm exec tsx e2e/start-api.ts`,
      port: apiPort,
      reuseExistingServer,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `API_PORT=${apiPort} pnpm dev --host 127.0.0.1 --port ${appPort}`,
      url: appUrl,
      reuseExistingServer,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
