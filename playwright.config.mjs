import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "platform.spec.mjs",
  timeout: 900000,
  workers: 1,
  outputDir:
    ".data/browser-results/" +
    (process.env.TESTFLOW_BROWSER_RUN_ID || Date.now().toString()),
  expect: { timeout: 10000 },
  projects: [
    { name: "workflow", testMatch: "platform.spec.mjs" },
    {
      name: "controls",
      testMatch: "platform-controls.spec.mjs",
      dependencies: ["workflow"],
    },
    {
      name: "states",
      testMatch: "platform-states.spec.mjs",
      dependencies: ["controls"],
    },
    { name: "visual", testMatch: "platform-visual.spec.mjs" },
  ],
  use: {
    baseURL: process.env.TESTFLOW_E2E_URL,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "off",
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
});
