import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

export async function evaluationControls(env) {
  const { ui, ledger, names, state } = env,
    { page, button, dialog, api, resource } = ui;
  await page.goto(ui.origin + "/evaluation-profiles");
  await ledger.verify(
    ["new-profile"],
    "negative",
    "An unnamed profile cannot save and all removed dimensions block submission",
    async () => {
      await button("新建评测配置").click();
      await expect(button("保存", dialog())).toBeDisabled();
      await dialog()
        .getByRole("textbox", { name: "名称", exact: true })
        .fill(names.profile);
      await button("删除", dialog()).click();
      await expect(button("保存", dialog())).toBeDisabled();
      await button("取消", dialog()).click();
      return { empty_name_blocked: true, no_dimensions_blocked: true };
    },
  );
  await ledger.verify(
    ["new-profile"],
    "normal",
    "Create a persisted profile with an explicit completion target",
    async () => {
      await button("新建评测配置").click();
      await button("新增维度", dialog()).click();
      await dialog()
        .getByRole("textbox", { name: "维度名称", exact: true })
        .fill("完成状态");
      await ui.select("评测方式", "完成状态");
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      state.profile = await resource("evaluation-profiles", names.profile);
      expect(state.profile.data.dimensions[0].actual).toMatchObject({
        source: "execution",
        field: "state",
      });
      return { id: state.profile.id, explicit_target: "execution.state" };
    },
  );
  const card = page
    .locator(".testflow-card")
    .filter({ hasText: names.profile });
  await ledger.verify(
    ["select-profile"],
    "normal",
    "Selecting a profile pins the detail panel and URL to its identity",
    async () => {
      await card.getByRole("link").click();
      expect(new URL(page.url()).pathname).toBe("/evaluation-profiles/" + state.profile.id);
      await expect(
        page.getByRole("row").filter({ hasText: "完成状态" }),
      ).toBeVisible();
      return { selected: state.profile.id };
    },
  );
  await ledger.verify(
    ["select-profile"],
    "negative",
    "A profile-list read failure displays an error and preserves the selected profile through retry",
    async () => {
      const failure = await ui.failReads("**/api/v1/evaluation-profiles/" + state.profile.id);
      await page.reload();
      await expect(page.getByRole("alert")).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/evaluation-profiles/" + state.profile.id);
      await failure.restore();
      await button("重试").click();
      await expect(dialog().getByRole("row").filter({hasText:"完成状态"})).toBeVisible();
      await dialog().press("Escape");
      return { selected_profile_retained: true, retry_succeeded: true };
    },
  );
  await ledger.verify(
    ["edit-profile"],
    "negative",
    "A CER threshold below zero is rejected while the entered value and explicit binding remain",
    async () => {
      await button("编辑", card).click();
      await button("新增维度", dialog()).click();
      await dialog()
        .getByRole("textbox", { name: "维度名称", exact: true })
        .last()
        .fill("可选字符准确性");
      const dim = dialog()
        .locator(".testflow-outline.testflow-stack")
        .filter({
          has: page.getByRole("textbox", { name: "维度名称", exact: true }),
        })
        .last();
      await ui.select("评测方式", "字符错误率（CER）", dim);
      await ui.setChecked(
        dim.getByRole("checkbox", { name: "必需", exact: true }),
        false,
      );
      await dim
        .getByRole("textbox", { name: "字段", exact: true })
        .first()
        .fill("text");
      await dim
        .getByRole("textbox", { name: "字段", exact: true })
        .last()
        .fill("text");
      await dim.getByLabel("最大字符错误率（0–1）", { exact: true }).fill("-1");
      await button("保存", dialog()).click();
      await expect(dialog().getByRole("alert")).toBeVisible();
      await expect(
        dim.getByLabel("最大字符错误率（0–1）", { exact: true }),
      ).toHaveValue("-1");
      return {
        invalid_threshold_rejected: true,
        target_retained: "output.text",
      };
    },
  );
  await ledger.verify(
    ["edit-profile"],
    "normal",
    "Correcting CER saves a new profile revision with separate actual and reference bindings",
    async () => {
      await dialog()
        .getByLabel("最大字符错误率（0–1）", { exact: true })
        .fill("0.1");
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      state.profile = await api(
        "get",
        "/evaluation-profiles/" + state.profile.id,
      );
      const cer = state.profile.data.dimensions.find((d) => d.method === "cer");
      expect(cer.actual).toMatchObject({ source: "output", field: "text" });
      expect(cer.reference).toMatchObject({
        source: "reference",
        field: "text",
      });
      expect(cer.required).toBe(false);
      expect(
        (
          await api(
            "get",
            "/evaluation-profiles/" + state.profile.id + "?version=1",
          )
        ).data.dimensions,
      ).toHaveLength(1);
      return {
        version: state.profile.version,
        actual: "output.text",
        reference: "reference.text",
        old_revision_retained: true,
      };
    },
  );
  await ledger.verify(
    ["evaluation-dimensions"],
    "normal",
    "Dimension additions and removals retain the other entered values",
    async () => {
      await button("编辑", card).click();
      const before = await dialog()
        .getByRole("textbox", { name: "维度名称", exact: true })
        .count();
      await button("新增维度", dialog()).click();
      await expect(
        dialog().getByRole("textbox", { name: "维度名称", exact: true }),
      ).toHaveCount(before + 1);
      await button("删除", dialog()).last().click();
      await expect(
        dialog().getByRole("textbox", { name: "维度名称", exact: true }),
      ).toHaveCount(before);
      await button("取消", dialog()).click();
      return { dimensions_retained: before };
    },
  );
}

export async function tasksControls(env) {
  const { ui, ledger, names, state } = env,
    { page, button, dialog, api, resource } = ui;
  await page.goto(ui.origin + "/test-tasks");
  await ledger.verify(
    ["new-task"],
    "negative",
    "An un-preflighted task cannot create; invalid pair fields produce validation feedback",
    async () => {
      await button("创建测试任务").click();
      await expect(button("创建测试任务", dialog())).toBeDisabled();
      await button("预检与计划预览", dialog()).click();
      await expect(dialog().getByRole("alert")).toBeVisible();
      return { create_blocked_without_preview: true, validation_visible: true };
    },
  );
  await dialog()
    .getByRole("textbox", { name: "名称", exact: true })
    .fill(names.task);
  await ui.select("评测配置", names.profile);
  await ui.select("测试集版本", names.dataset);
  await ui.select("流程版本", names.pipeline);
  await ledger.verify(
    ["remove-pair"],
    "boundary",
    "The last required pair cannot be removed",
    async () => {
      await expect(button("删除", dialog()).first()).toBeDisabled();
      return { last_pair_protected: true };
    },
  );
  await ledger.verify(
    ["add-pair"],
    "normal",
    "Adding a pair leaves existing explicit selections intact",
    async () => {
      await button("新增配对", dialog()).click();
      await expect(button("删除", dialog())).toHaveCount(2);
      await expect(dialog()).toContainText(names.dataset);
      await expect(dialog()).toContainText(names.pipeline);
      return { pairs: 2, original_selections_retained: true };
    },
  );
  await ledger.verify(
    ["add-pair"],
    "negative",
    "An incomplete added pair blocks preview without erasing the configured pair",
    async () => {
      await button("预检与计划预览", dialog()).click();
      await expect(dialog().getByRole("alert")).toBeVisible();
      await expect(button("创建测试任务", dialog())).toBeDisabled();
      await expect(dialog()).toContainText(names.dataset);
      return { incomplete_pair_blocked: true, configured_pair_retained: true };
    },
  );
  await ledger.verify(
    ["remove-pair"],
    "normal",
    "Removing the second pair restores a one-pair task with the selected versions",
    async () => {
      await button("删除", dialog()).last().click();
      await expect(button("删除", dialog())).toHaveCount(1);
      await expect(dialog()).toContainText(names.pipeline);
      return { pairs: 1 };
    },
  );
  await ledger.verify(
    ["task-preflight-binding"],
    "negative",
    "A wrong completion target and zero concurrency are rejected before freezing any task",
    async () => {
      const actual = dialog()
        .locator(".testflow-outline")
        .filter({
          has: page.getByRole("heading", { name: "实际输出绑定", exact: true }),
        })
        .first();
      await actual
        .getByRole("textbox", { name: "字段", exact: true })
        .fill("cleanup");
      await button("预检与计划预览", dialog()).click();
      await expect(dialog().getByRole("alert")).toBeVisible();
      await actual
        .getByRole("textbox", { name: "字段", exact: true })
        .fill("state");
      await dialog().getByLabel("同时执行案例数", { exact: true }).fill("0");
      await button("预检与计划预览", dialog()).click();
      await expect(dialog().getByRole("alert")).toBeVisible();
      await expect(
        dialog().getByLabel("同时执行案例数", { exact: true }),
      ).toHaveValue("0");
      await dialog().getByLabel("同时执行案例数", { exact: true }).fill("2");
      return { invalid_binding_blocked: true, zero_retained: true };
    },
  );
  await ledger.verify(
    ["new-task"],
    "normal",
    "An explicit pair previews and freezes real plans, then runs and evaluates its cases",
    async () => {
      await button("预检与计划预览", dialog()).click();
      await expect(dialog().getByText(/所设并发 2/)).toBeVisible();
      await expect(button("创建测试任务", dialog())).toBeEnabled();
      await button("创建测试任务", dialog()).click();
      await expect(
        page.getByRole("heading", { name: names.task, exact: true }),
      ).toBeVisible();
      await expect(button("取消任务")).toBeDisabled({ timeout: 60000 });
      state.task = await api(
        "get",
        "/tasks/" + new URL(page.url()).pathname.split("/").at(-1),
      );
      expect(state.task.report.plan_count).toBe(2);
      expect(state.task.report.passed).toBe(2);
      expect(state.task.requested_concurrency).toBe(2);
      expect(state.task.effective_concurrency).toBe(2);
      state.taskReports = await api(
        "get",
        "/tasks/" + state.task.id + "/reports",
      );
      state.oldReport = state.taskReports.items[0];
      return {
        task_id: state.task.id,
        plan_count: 2,
        passed: 2,
        concurrency: 2,
      };
    },
  );
  await ledger.verify(
    ["task-detail"],
    "normal",
    "The report exposes completed run and evaluation progress separately",
    async () => {
      await button("返回", page.locator(".testflow-page-heading")).click();
      await button(
        "查看报告",
        page.getByRole("row").filter({ hasText: names.task }),
      ).click();
      await expect(page.getByText("执行进度", { exact: true })).toBeVisible();
      await expect(page.getByText("评分进度", { exact: true })).toBeVisible();
      expect(state.task.report.run_completed).toBe(2);
      expect(state.task.report.evaluated).toBe(2);
      return { run_completed: 2, evaluated: 2 };
    },
  );
  await ledger.verify(
    ["task-back"],
    "normal",
    "Task Back returns to its collection and exposes the real report action",
    async () => {
      await button("返回", page.locator(".testflow-page-heading")).click();
      await expect(page).toHaveURL(ui.origin + "/test-tasks");
      await expect(
        button(
          "查看报告",
          page.getByRole("row").filter({ hasText: names.task }),
        ),
      ).toBeVisible();
      return { route: "/test-tasks" };
    },
  );
  await ledger.verify(
    ["task-detail"],
    "negative",
    "A missing task shows an error and a usable return control",
    async () => {
      await page.goto(
        ui.origin + "/test-tasks/00000000-0000-4000-8000-000000000000",
      );
      await expect(
        page.getByRole("alert").filter({ hasText: "资源或版本不存在。" }),
      ).toBeVisible();
      await button("返回").click();
      return { missing_task_handled: true };
    },
  );
  await button(
    "查看报告",
    page.getByRole("row").filter({ hasText: names.task }),
  ).click();
  await ledger.verify(
    ["task-history"],
    "normal",
    "History filters to the chosen task and retains a report return address",
    async () => {
      await button("查看执行历史").click();
      await expect(page).toHaveURL(/\/executions\?/);
      const url = new URL(page.url());
      expect(url.searchParams.get("task_id")).toBe(state.task.id);
      expect(url.searchParams.get("return")).toContain(state.task.id);
      await expect(
        page.getByRole("row").filter({ hasText: names.case + " edited" }),
      ).toHaveCount(1);
      return {
        task_filter: state.task.id,
        return: url.searchParams.get("return"),
      };
    },
  );
  await ledger.verify(
    ["task-back", "task-history"],
    "boundary",
    "A hidden task keeps its name in history and still returns to its fixed report",
    async () => {
      await button("返回", page.locator(".testflow-page-heading")).click();
      await button("删除 " + names.task).click();
      await button("确认删除", dialog()).click();
      await button("查看执行历史").click();
      await expect(button(names.task + " 测试任务 测试任务")).toBeVisible();
      await button("返回", page.locator(".testflow-page-heading")).click();
      await expect(
        page.getByRole("heading", { name: names.task, exact: true }),
      ).toBeVisible();
      await api("post", "/tasks/" + state.task.id + "/restore");
      return { hidden_history_name_retained: true, report_returned: true };
    },
  );
  await ledger.verify(
    ["cancel-task"],
    "boundary",
    "A completed task cannot be canceled",
    async () => {
      await expect(button("取消任务")).toBeDisabled();
      return { completed_cancel_disabled: true };
    },
  );
  const module = state.fault,
    inputs = module.data.inputs,
    outputs = module.data.outputs;
  state.cancelPipeline = await api("post", "/pipelines", {
    name: env.prefix + " Cancel pipeline",
    input_schema: inputs,
    output_schema: outputs,
    cleanup_timeout: 2,
    nodes: [
      { id: "start", name: "Start", kind: "start", output_schema: inputs },
      {
        id: "module",
        name: "Cancelable module",
        kind: "module",
        module_id: module.id,
        module_version: module.version,
        runtime: module.data.manifest.runtime,
        parameters: { mode: "by_input", delay_ms: 0 },
        timeout: 60,
      },
      {
        id: "end",
        name: "End",
        kind: "end",
        input_schema: outputs,
        output_schema: outputs,
      },
    ],
    edges: [
      { source: "start", target: "module" },
      { source: "module", target: "end" },
    ],
  });
  state.cancelDataset = await api("post", "/datasets", {
    name: env.prefix + " Cancel cases",
    input_schema: inputs,
    output_schema: outputs,
    cases: ["hang", "success", "never_started"].map((text) => ({
      id: randomUUID(),
      name: text,
      inputs: { text: { value: text } },
    })),
  });
  await ledger.verify(
    ["cancel-task"],
    "normal",
    "Cancel an active real Pod batch and leave its remaining frozen plans unstarted",
    async () => {
      await page.goto(ui.origin + "/test-tasks");
      await button("创建测试任务").click();
      await dialog()
        .getByRole("textbox", { name: "名称", exact: true })
        .fill(env.prefix + " Cancellation");
      await ui.select("评测配置", names.profile);
      await ui.select("测试集版本", state.cancelDataset.name);
      await ui.select("流程版本", state.cancelPipeline.name);
      await dialog().getByLabel("同时执行案例数", { exact: true }).fill("1");
      await button("预检与计划预览", dialog()).click();
      await expect(button("创建测试任务", dialog())).toBeEnabled();
      await button("创建测试任务", dialog()).click();
      await expect(
        page.getByRole("heading", {
          name: env.prefix + " Cancellation",
          exact: true,
        }),
      ).toBeVisible();
      const id = new URL(page.url()).pathname.split("/").at(-1);
      await expect
        .poll(
          async () => {
            const task = await api("get", "/tasks/" + id),
              executionId =
                task.report.rows[0].active_execution_id ||
                task.report.rows[0].execution_id;
            if (!executionId) return false;
            const execution = await api("get", "/executions/" + executionId);
            return (
              execution.nodes.module?.state === "running" &&
              execution.events.some((event) => event.kind === "module.request")
            );
          },
          { timeout: 45000 },
        )
        .toBe(true);
      await expect(button("取消任务")).toBeEnabled();
      await button("取消任务").click();
      await expect
        .poll(async () => (await api("get", "/tasks/" + id)).state, {
          timeout: 30000,
        })
        .toBe("canceled");
      const task = await api("get", "/tasks/" + id),
        attempts = (await api("get", "/executions?task_id=" + id)).items;
      expect(attempts).toHaveLength(1);
      expect(
        task.report.rows.slice(1).every((row) => row.plan_state === "canceled"),
      ).toBe(true);
      state.canceledTask = task;
      return {
        task_id: id,
        active_attempts: 1,
        remaining_unstarted: 2,
        state: task.state,
      };
    },
  );
}
