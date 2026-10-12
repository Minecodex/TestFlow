import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { testWorkspace, waitForPreview } from "./browser/fixtures.mjs";
import { controlsUI } from "./browser/control-ledger.mjs";

test("detail, canvas, dialog and drawer desktop state matrix", async ({
  browser,
}, info) => {
  test.skip(
    !process.env.TESTFLOW_E2E_NAMESPACE,
    "Provide an owned disposable acceptance namespace",
  );
  const workspace = await testWorkspace();
  const controls = JSON.parse(
    await fs.readFile(
      path.resolve(
        ".data/acceptance",
        workspace.namespace,
        "browser-controls.json",
      ),
      "utf8",
    ),
  );
  expect(
    controls.report.passed,
    "The visual matrix follows completed functional controls",
  ).toBe(true);
  const context = await browser.newContext({
    baseURL: workspace.access.url,
    viewport: { width: 1440, height: 1000 },
  });
  await waitForPreview(context.request, workspace.access.url);
  const page = await context.newPage(),
    ui = controlsUI(page, workspace.access.url),
    checks = [];
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "密码*", exact: true })
    .fill(workspace.access.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "测试工作台", exact: true }),
  ).toBeVisible();
  const resources = controls.resources;
  const go = async (route) => {
    await page.goto(workspace.access.url + route);
    await expect(page.locator("main")).toBeVisible();
    if (!route.includes("00000000-0000-4000-8000-000000000000"))
      await expect(page.locator("main h1")).toBeVisible();
  };
  const open = async (action, scope = page) => {
    await scope
      .locator('[data-a="' + action + '"]')
      .first()
      .click();
    await expect(page.getByRole("dialog").last()).toBeVisible();
  };
  const card = (name) =>
    page.locator(".testflow-card").filter({ hasText: name });
  const row = (name) => page.getByRole("row").filter({ hasText: name });
  const text = {
    "zh-CN": {
      language: "切换语言",
      theme: "切换配色",
      edit: "编辑",
      close: "关闭",
      schema: "编辑流程字段组",
      info: "流程信息",
      quick: "快速运行",
      retry: "刷新",
    },
    "en-US": {
      language: "Change language",
      theme: "Change theme",
      edit: "Edit",
      close: "Close",
      schema: "Edit pipeline groups",
      info: "Pipeline information",
      quick: "Quick run",
      retry: "Refresh",
    },
  };
  const states = [
    [
      "repository-register",
      async () => {
        await go("/repositories");
        await open("new-repo");
      },
    ],
    [
      "repository-edit",
      async () => {
        await go("/repositories");
        await ui
          .button(text[currentLocale].edit, row(resources.repo.name))
          .click();
      },
    ],
    [
      "repository-versions",
      async () => {
        await go("/repositories");
        await open("repo-versions", row(resources.repo.name));
      },
    ],
    [
      "module-import",
      async () => {
        await go("/modules");
        await open("import-module");
      },
    ],
    [
      "module-specification",
      async () => {
        await go("/modules");
        await open("module-spec");
      },
    ],
    [
      "module-contract",
      async () => {
        await go("/modules/" + resources.fault.id);
        await expect(page.getByRole("dialog")).toBeVisible();
      },
    ],
    [
      "module-component-error",
      async () => {
        await go("/modules");
        const target = page
          .locator(".testflow-module-card")
          .filter({ hasText: "TEST UI component failure" });
        await open("module-detail", target);
      },
    ],
    [
      "asset-text-editor",
      async () => {
        await go("/assets");
        await open("new-text-asset");
      },
    ],
    [
      "asset-import",
      async () => {
        await go("/assets");
        await open("import-asset");
      },
    ],
    [
      "asset-details",
      async () => {
        await go("/assets");
        await open("asset-detail", row(resources.asset.name));
      },
    ],
    [
      "dataset-details",
      async () => {
        await go("/datasets/" + resources.dataset.id);
      },
    ],
    [
      "dataset-wizard",
      async () => {
        await go("/datasets");
        await open("new-dataset");
      },
    ],
    [
      "dataset-case-editor",
      async () => {
        await go("/datasets/" + resources.dataset.id);
        await open("add-case");
      },
    ],
    [
      "canvas-overview",
      async () => {
        await go("/pipelines/" + resources.pipeline.id);
        await expect(page.locator(".react-flow__node")).toHaveCount(3);
      },
    ],
    [
      "canvas-inspector",
      async () => {
        await go("/pipelines/" + resources.pipeline.id + "?node=start");
        await expect(page.locator(".testflow-inspector input")).not.toHaveCount(
          0,
        );
      },
    ],
    [
      "canvas-schema-editor",
      async () => {
        await go("/pipelines/" + resources.pipeline.id);
        await ui.button(text[currentLocale].schema).click();
      },
    ],
    [
      "canvas-information",
      async () => {
        await go("/pipelines/" + resources.pipeline.id);
        await ui.button(text[currentLocale].info).click();
      },
    ],
    [
      "canvas-quick-run",
      async () => {
        await go("/pipelines/" + resources.pipeline.id);
        await ui.button(text[currentLocale].quick).click();
      },
    ],
    [
      "profile-editor",
      async () => {
        await go("/evaluation-profiles?view=" + resources.profile.id);
        await ui.button(text[currentLocale].edit).click();
      },
    ],
    [
      "task-pairing",
      async () => {
        await go("/test-tasks");
        await open("new-task");
      },
    ],
    [
      "task-current-report",
      async () => {
        await go("/test-tasks/" + resources.task.id);
      },
    ],
    [
      "task-canceled-report",
      async () => {
        await go("/test-tasks/" + resources.canceledTask.id);
      },
    ],
    ...[
      ["trace", "trace"],
      ["io", "inputs-outputs"],
      ["scoring", "scoring"],
      ["snapshot", "snapshot"],
      ["events", "events"],
      ["history", "attempt-history"],
    ].map(([tab, name]) => [
      "execution-" + name,
      async () => {
        await go("/executions/" + resources.rerun.id + "?tab=" + tab);
        await expect(page.getByRole("tabpanel")).toBeVisible();
        await page.getByRole("tabpanel").scrollIntoViewIfNeeded();
      },
    ]),
    [
      "execution-internal-trace",
      async () => {
        await go("/executions/" + workspace.acceptance.executions[0].id);
        await page.locator('[data-a="trace-span"]').first().click();
      },
    ],
    [
      "execution-reevaluation",
      async () => {
        await go("/executions/" + resources.rerun.id);
        await open("reevaluate-execution");
      },
    ],
    [
      "execution-error",
      async () => {
        await go("/executions/00000000-0000-4000-8000-000000000000");
        await expect(page.getByRole("alert")).toBeVisible();
      },
    ],
    [
      "global-search-empty",
      async () => {
        await go("/");
        await open("search");
        await page
          .getByRole("dialog")
          .getByRole("textbox")
          .fill("no-match-layout-evidence");
      },
    ],
    [
      "global-about",
      async () => {
        await go("/");
        await open("about");
      },
    ],
    [
      "global-hidden",
      async () => {
        await go("/");
        await open("hidden-resources");
      },
    ],
  ];
  let currentLocale = "zh-CN";
  await fs.mkdir(info.outputDir, { recursive: true, mode: 0o700 });
  try {
    for (const width of [1200, 1440, 1920])
      for (const locale of ["zh-CN", "en-US"])
        for (const theme of ["light", "dark"]) {
          console.info("State matrix: " + width + " " + locale + " " + theme);
          await page.setViewportSize({ width, height: 1000 });
          await go("/");
          const oldLocale = await page.locator("html").getAttribute("lang");
          if (oldLocale !== locale)
            await ui.button(text[oldLocale].language).click();
          currentLocale = locale;
          const isDark = (
            (await page.locator("html").getAttribute("class")) || ""
          ).includes("dark");
          if (isDark !== (theme === "dark"))
            await ui.button(text[locale].theme).click();
          for (const [name, prepare] of states) {
            await test.step(
              name + " " + width + " " + locale + " " + theme,
              async () => {
                await prepare();
                // Headers and portals can be visible before their data and entrance
                // transitions have settled. Capture the completed UI state.
                await page.waitForLoadState("networkidle");
                await page.evaluate(() => document.fonts.ready);
                await page.evaluate(async () => {
                  await Promise.all(
                    document
                      .getAnimations()
                      .filter((animation) =>
                        Number.isFinite(
                          animation.effect?.getComputedTiming().endTime,
                        ),
                      )
                      .map((animation) => animation.finished.catch(() => {})),
                  );
                  await new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                  );
                });
                const geometry = await page.evaluate(() => {
                  const root = document.documentElement;
                  const scrollable = (element) => {
                    for (
                      let item = element.parentElement;
                      item;
                      item = item.parentElement
                    ) {
                      const css = getComputedStyle(item);
                      if (
                        ["auto", "scroll"].includes(css.overflowX) &&
                        item.scrollWidth > item.clientWidth
                      )
                        return true;
                    }
                    return false;
                  };
                  const controls = [
                    ...document.querySelectorAll(
                      'button,input,textarea,[role="tab"],h1,h2',
                    ),
                  ].flatMap((element) => {
                    const r = element.getBoundingClientRect(),
                      css = getComputedStyle(element);
                    if (
                      !r.width ||
                      !r.height ||
                      css.visibility === "hidden" ||
                      css.display === "none" ||
                      r.bottom <= 0 ||
                      r.top >= root.clientHeight
                    )
                      return [];
                    if (
                      element.matches(
                        'input[type="checkbox"],input[type="file"]',
                      )
                    )
                      return [];
                    return [
                      {
                        name:
                          element.getAttribute("aria-label") ||
                          element.textContent?.trim().slice(0, 80) ||
                          element.getAttribute("name"),
                        x: r.x,
                        width: r.width,
                        height: r.height,
                        font: parseFloat(css.fontSize),
                        scrollable: scrollable(element),
                      },
                    ];
                  });
                  return {
                    width: root.clientWidth,
                    height: root.clientHeight,
                    scroll: root.scrollWidth,
                    locale: root.lang,
                    dark: root.className.includes("dark"),
                    controls,
                    paletteLabels: [
                      ...document.querySelectorAll(".testflow-palette-name"),
                    ].map((element) => ({
                      name: element.textContent,
                      width: element.clientWidth,
                      scroll: element.scrollWidth,
                    })),
                    dialogs: [
                      ...document.querySelectorAll(".testflow-dialog"),
                    ].map((element) => {
                      const header = element.querySelector(
                          ".testflow-dialog-header",
                        ),
                        title = header?.querySelector("h2"),
                        close = header?.querySelector("button");
                      const a = title?.getBoundingClientRect(),
                        b = close?.getBoundingClientRect();
                      return {
                        slot: element.getAttribute("data-slot"),
                        direction:
                          header && getComputedStyle(header).flexDirection,
                        centerDifference:
                          a && b
                            ? Math.abs(a.y + a.height / 2 - b.y - b.height / 2)
                            : null,
                      };
                    }),
                    checkboxLabels: [
                      ...document.querySelectorAll(
                        '.testflow-checkbox [data-slot="checkbox-content"]',
                      ),
                    ].map((element) => ({
                      name: element.textContent,
                      width: element.closest(".testflow-checkbox").clientWidth,
                      scroll: element.scrollWidth,
                    })),
                  };
                });
                expect(
                  geometry.scroll,
                  name + " root horizontal overflow",
                ).toBeLessThanOrEqual(width);
                expect(geometry.locale).toBe(locale);
                expect(geometry.dark).toBe(theme === "dark");
                expect(
                  geometry.checkboxLabels.filter(
                    (label) => label.scroll > label.width + 1,
                  ),
                  name + " checkbox labels must not overlap adjacent controls",
                ).toEqual([]);
                for (const dialog of geometry.dialogs) {
                  expect(
                    dialog.slot,
                    "Only the actual dialog owns the panel surface",
                  ).toBe("modal-dialog");
                  expect(
                    dialog.direction,
                    "Dialog header follows the horizontal prototype layout",
                  ).toBe("row");
                  expect(
                    dialog.centerDifference,
                    "Dialog title and close control stay aligned",
                  ).toBeLessThanOrEqual(1);
                }
                expect(
                  geometry.paletteLabels.filter(
                    (label) => label.scroll > label.width + 1,
                  ),
                  name + " palette labels must be fully readable",
                ).toEqual([]);
                const clipped = geometry.controls.filter(
                  (control) =>
                    !control.scrollable &&
                    (control.x < -1 || control.x + control.width > width + 1),
                );
                expect(
                  clipped,
                  name +
                    " controls must be visible or in an accessible scroll container",
                ).toEqual([]);
                expect(
                  geometry.controls.filter((control) => control.font < 10),
                  name + " readable type size",
                ).toEqual([]);
                const file =
                  name + "-" + width + "-" + locale + "-" + theme + ".jpg";
                await page.screenshot({
                  path: info.outputPath(file),
                  fullPage: true,
                  type: "jpeg",
                  quality: 90,
                });
                checks.push({
                  state: name,
                  width,
                  locale,
                  theme,
                  geometry,
                  screenshot: file,
                  passed: true,
                });
              },
            );
          }
        }
  } finally {
    await fs.writeFile(
      info.outputPath("state-matrix.json"),
      JSON.stringify(
        {
          namespace: workspace.namespace,
          scope:
            "Actual Kubernetes UI states; geometry and readable type checks, with screenshots for visual review. Pixel comparison is recorded separately.",
          states: states.map(([name]) => name),
          checks,
          passed: checks.length === states.length * 12,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    await context.close();
  }
  expect(checks).toHaveLength(states.length * 12);
});
