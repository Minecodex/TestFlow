import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

test("nine prototype pages preserve the strict 0.5 percent visual gate", async ({
  browser,
}, info) => {
  await promisify(execFile)("node", ["tests/visual-fixtures.cjs"]);
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const server = spawn(
    "python3",
    ["tests/visual-server.py", "--port", String(port)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let diagnostics = "";
  server.stderr.on("data", (buffer) => {
    diagnostics += String(buffer);
  });
  const origin = "http://127.0.0.1:" + port;
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const settle = async () => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() =>
      [...document.images].every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };
  const fixtures = JSON.parse(
    await fs.readFile(".data/visual-fixtures/responses.json", "utf8"),
  );
  const screens = [
    ["overview", "", null, 0],
    [
      "repositories",
      "repositories",
      ".testflow-table-wrap tbody tr",
      fixtures["/repositories"].items.length,
    ],
    [
      "modules",
      "modules",
      ".testflow-module-card",
      fixtures["/modules"].items.length,
    ],
    [
      "assets",
      "assets",
      ".testflow-table-wrap tbody tr",
      fixtures["/assets"].items.length,
    ],
    [
      "datasets",
      "datasets",
      ".testflow-card",
      fixtures["/datasets"].items.length,
    ],
    [
      "pipelines",
      "pipelines",
      ".testflow-card",
      fixtures["/pipelines"].items.length,
    ],
    [
      "evaluation",
      "evaluation-profiles",
      ".testflow-card",
      fixtures["/evaluation-profiles"].items.length,
    ],
    [
      "tasks",
      "test-tasks",
      ".testflow-table-wrap tbody tr",
      fixtures["/tasks"].items.length,
    ],
    [
      "executions",
      "executions",
      ".testflow-table-wrap tbody tr",
      fixtures["/executions"].items.length,
    ],
  ];
  const manifest = {
    environment: {
      browser: browser.version(),
      platform: process.platform,
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      font: '"Segoe UI", "Microsoft YaHei UI", "PingFang SC", sans-serif',
    },
    fixture:
      "Read-only data derived from the unmodified demo; no real execution claims",
    screens: [],
  };
  await fs.mkdir(info.outputDir, { recursive: true, mode: 0o700 });
  try {
    await expect
      .poll(async () => {
        try {
          return (
            await context.request.get(origin + "/api/v1/auth/session", {
              timeout: 1000,
            })
          ).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    for (const [name, route, selector, count] of screens) {
      await test.step("Formal " + name, async () => {
        await page.goto("/" + route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (selector) await expect(page.locator(selector)).toHaveCount(count);
        else
          await expect(
            page.getByRole("button", {
              name: fixtures["/tasks"].items[0].name,
              exact: true,
            }),
          ).toBeVisible();
        await settle();
        const actual = "formal-" + name + ".png";
        await page.screenshot({ path: info.outputPath(actual), type: "png" });
        manifest.screens.push({
          id: name,
          actual,
          baseline: "demo-" + name + ".png",
          masks: [],
        });
      });
    }
    for (const [name] of screens) {
      await test.step("Prototype " + name, async () => {
        await page.goto("/prototype.html#" + name);
        await expect(page.locator("#content h1")).toBeVisible();
        if (name === "pipelines")
          await page
            .getByRole("button", { name: "流程集", exact: true })
            .click();
        await settle();
        await page.screenshot({
          path: info.outputPath("demo-" + name + ".png"),
          type: "png",
        });
      });
    }
    const file = info.outputPath("screens.json");
    await fs.writeFile(file, JSON.stringify(manifest, null, 2) + "\n");
    await promisify(execFile)("uv", [
      "run",
      "--project",
      "server",
      "python",
      "tests/visual-compare.py",
      "--directory",
      info.outputDir,
      "--manifest",
      file,
      "--output",
      info.outputPath("result.json"),
    ]);
    const result = JSON.parse(
      await fs.readFile(info.outputPath("result.json"), "utf8"),
    );
    expect(result.screens).toHaveLength(9);
    expect(result.passed).toBe(true);
    await fs.copyFile(
      ".data/visual-fixtures/source.json",
      info.outputPath("source.json"),
    );
  } finally {
    if (diagnostics)
      await fs.writeFile(info.outputPath("fixture-server.log"), diagnostics);
    await context.close();
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once("exit", resolve);
    });
  }
});
