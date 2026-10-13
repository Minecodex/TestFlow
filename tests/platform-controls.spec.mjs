import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { testWorkspace, waitForPreview } from "./browser/fixtures.mjs";
import { ControlLedger, controlsUI } from "./browser/control-ledger.mjs";

test.describe.serial("desktop controls with actual outcomes", () => {
  test.skip(
    !process.env.TESTFLOW_E2E_NAMESPACE,
    "Provide a disposable Kubernetes acceptance namespace",
  );
  let context,
    env,
    tracing = false;
  test.beforeAll(async ({ browser }) => {
    const workspace = await testWorkspace(),
      suffix = randomUUID().slice(0, 8),
      prefix = "COVERAGE " + suffix;
    const directory = path.resolve(
      ".data/acceptance",
      workspace.namespace,
      "controls-" + suffix,
    );
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    context = await browser.newContext({
      baseURL: workspace.access.url,
      viewport: { width: 1440, height: 1000 },
    });
    await waitForPreview(context.request, workspace.access.url);
    const page = await context.newPage();
    await page.goto("/");
    await page
      .getByRole("textbox", { name: "密码*", exact: true })
      .fill(workspace.access.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page
      .getByRole("heading", { name: "测试工作台", exact: true })
      .waitFor({ state: "visible" });
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    });
    tracing = true;
    const files = {};
    for (const [key, file] of Object.entries({
      text: "input.txt",
      png: "input.png",
      audio: "playback.wav",
      invalid: "invalid.wav",
    })) {
      files[key] = "/tmp/testflow-ui-audit/" + suffix + "-" + file;
      await fs.copyFile("/tmp/testflow-ui-audit/" + file, files[key]);
    }
    env = {
      ...workspace,
      directory,
      files,
      prefix,
      state: {},
      context,
      names: {
        repo: prefix + " Repository",
        asset: prefix + " Text",
        dataset: prefix + " Dataset",
        case: prefix + " Case",
        profile: prefix + " Rules",
        pipeline: prefix + " Pipeline",
        task: prefix + " Task",
      },
      ui: controlsUI(page, workspace.access.url),
      ledger: new ControlLedger(directory, workspace.namespace, page),
    };
    env.finishTrace = async () => {
      if (!tracing) return;
      const raw = path.join(env.directory, "trace.private.zip");
      await context.tracing.stop({ path: raw });
      tracing = false;
      await fs.chmod(raw, 0o600);
      await promisify(execFile)("python3", [
        "scripts/sanitize-browser-trace.py",
        raw,
        path.join(env.directory, "trace.zip"),
      ]);
    };
  });
  for (const [title, file, fn] of [
    [
      "仓库登记、版本、冲突与真实同步",
      "global-repositories",
      "repositoriesControls",
    ],
    ["全局搜索、导览、隐藏恢复与焦点", "global-repositories", "globalControls"],
    ["素材导入、参考修订与播放失败", "assets-modules", "assetsControls"],
    ["测试集向导、案例、字段与不可变修订", "datasets", "datasetsControls"],
    ["评测配置、参数与字段绑定", "evaluation-tasks", "evaluationControls"],
    ["DAG 编辑、整组连线、草稿与快速运行", "pipelines", "pipelinesControls"],
    [
      "真实 ZIP、Pod 验证、组件失败与加入画布",
      "assets-modules",
      "modulesControls",
    ],
    ["显式任务配对、报告与实际取消", "evaluation-tasks", "tasksControls"],
    ["执行详情、Trace、历史、重跑与复评", "executions", "executionsControls"],
    ["真实会话失效、登录错误与恢复", "executions", "sessionControls"],
  ]) {
    test(title, async () => {
      const module = await import("./browser/" + file + ".mjs");
      await module[fn](env);
    });
  }
  test("every desktop non-recording control has normal and failure or boundary evidence", async () => {
    const report = await env.ledger.report();
    expect(report.missing).toEqual([]);
    expect(report.verified).toBe(84);
  });
  test.afterAll(async () => {
    if (!env) {
      if (context) await context.close();
      return;
    }
    const report = await env.ledger.report();
    await env.finishTrace();
    await fs.writeFile(
      path.resolve(".data/acceptance", env.namespace, "browser-controls.json"),
      JSON.stringify(
        {
          directory: env.directory,
          report,
          resources: Object.fromEntries(
            Object.entries(env.state)
              .filter(([, v]) => v && typeof v === "object" && v.id)
              .map(([k, v]) => [
                k,
                { id: v.id, name: v.name, version: v.version },
              ]),
          ),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    await context.close();
  });
});
