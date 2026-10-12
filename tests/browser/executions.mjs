import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";

export async function executionsControls(env) {
  const { ui, ledger, state } = env,
    { page, button, dialog, api } = ui;
  const returnTo =
    "/executions?" +
    new URLSearchParams({ task_id: state.task.id, search: env.names.case });
  const detail = async (id, tab = "trace") => {
    await page.goto(
      ui.origin +
        "/executions/" +
        id +
        "?tab=" +
        tab +
        "&return=" +
        encodeURIComponent(returnTo),
    );
    await expect(button("仅重新评测")).toBeVisible();
  };
  const settled = async (id) =>
    expect
      .poll(
        async () => {
          const ex = await api("get", "/executions/" + id);
          return (
            !["queued", "running"].includes(ex.state) &&
            ["stopped", "timed_out"].includes(ex.cleanup)
          );
        },
        { timeout: 60000 },
      )
      .toBe(true);
  const attempts = (await api("get", "/executions?task_id=" + state.task.id))
    .items;
  state.execution =
    attempts.find((ex) => ex.name === env.names.case + " edited") ||
    attempts[0];
  await page.goto(ui.origin + returnTo);
  await ledger.verify(
    ["execution-detail"],
    "normal",
    "A filtered row opens its actual execution and retains the list address",
    async () => {
      await page.locator('[data-a="execution-detail"]').first().click();
      await expect(
        page.getByRole("tab", { name: "执行过程", exact: true }),
      ).toBeVisible();
      expect(new URL(page.url()).searchParams.get("return")).toBe(returnTo);
      return {
        execution_id: new URL(page.url()).pathname.split("/").at(-1),
        return: returnTo,
      };
    },
  );
  await ledger.verify(
    ["execution-tab"],
    "normal",
    "All six detail tabs select their own content and survive reload",
    async () => {
      const selected = [];
      for (const [key, name] of [
        ["trace", "执行过程"],
        ["io", "输入与输出"],
        ["scoring", "评测结果"],
        ["snapshot", "配置快照"],
        ["events", "原始事件"],
        ["history", "历史记录"],
      ]) {
        const control = page.getByRole("tab", { name, exact: true });
        await control.click();
        await expect(control).toHaveAttribute("aria-selected", "true");
        expect(new URL(page.url()).searchParams.get("tab")).toBe(key);
        await expect(page.getByRole("tabpanel")).toBeVisible();
        selected.push(key);
      }
      await page.reload();
      await expect(
        page.getByRole("tab", { name: "历史记录", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      return { tabs: selected, reload_retained: "history" };
    },
  );
  await ledger.verify(
    ["execution-tab"],
    "boundary",
    "Arrow keys and Enter move the selected tab without losing the execution identity",
    async () => {
      await page.getByRole("tab", { name: "执行过程", exact: true }).click();
      await page
        .getByRole("tab", { name: "执行过程", exact: true })
        .press("ArrowRight");
      await page
        .getByRole("tab", { name: "输入与输出", exact: true })
        .press("Enter");
      await expect(
        page.getByRole("tab", { name: "输入与输出", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      expect(new URL(page.url()).pathname).toContain("/executions/");
      return { keyboard_selected: "io", identity_retained: true };
    },
  );
  await ledger.verify(
    ["export-execution"],
    "normal",
    "JSON export includes the fixed snapshot, events and separate evaluation records",
    async () => {
      const waiting = page.waitForEvent("download");
      await button("导出 JSON").click();
      const file = await waiting;
      const value = JSON.parse(await fs.readFile(await file.path(), "utf8"));
      expect(value.id).toBe(state.execution.id);
      expect(value.snapshot.pipeline.selected_version).toBe(
        state.pipeline.version,
      );
      expect(value.events.length).toBeGreaterThan(0);
      expect(value.evaluations.length).toBeGreaterThan(0);
      expect(JSON.stringify(value)).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
      return {
        id: value.id,
        snapshot: true,
        events: value.events.length,
        evaluations: value.evaluations.length,
      };
    },
  );
  await ledger.verify(
    ["export-execution"],
    "boundary",
    "Exporting twice is read-only and keeps the execution and evaluation count unchanged",
    async () => {
      const before = await api("get", "/executions/" + state.execution.id),
        waiting = page.waitForEvent("download");
      await button("导出 JSON").click();
      await waiting;
      const after = await api("get", "/executions/" + state.execution.id);
      expect(after.snapshot).toEqual(before.snapshot);
      expect(after.evaluations.length).toBe(before.evaluations.length);
      return { immutable_export: true };
    },
  );
  await ledger.verify(
    ["execution-back"],
    "normal",
    "Back restores the exact task and search filters",
    async () => {
      await button("返回", page.locator(".testflow-page-heading")).click();
      await expect(page).toHaveURL(ui.origin + returnTo);
      return { return: returnTo };
    },
  );
  await ledger.verify(
    ["clear-history"],
    "normal",
    "Clearing filters preserves the report return destination",
    async () => {
      await page.goto(
        ui.origin +
          returnTo +
          "&return=" +
          encodeURIComponent("/test-tasks/" + state.task.id),
      );
      await button("清空筛选").click();
      await expect
        .poll(() => new URL(page.url()).searchParams.has("task_id"))
        .toBe(false);
      const cleared = new URL(page.url());
      expect(cleared.searchParams.has("task_id")).toBe(false);
      expect(cleared.searchParams.has("search")).toBe(false);
      expect(cleared.searchParams.get("return")).toBe(
        "/test-tasks/" + state.task.id,
      );
      return { filters_cleared: true, return_retained: true };
    },
  );
  await ledger.verify(
    ["clear-history"],
    "boundary",
    "Repeated clearing retains an unfiltered list and does not erase any attempts",
    async () => {
      const before = (await api("get", "/executions")).total;
      await button("清空筛选").click();
      expect((await api("get", "/executions")).total).toBe(before);
      return { attempt_count: before, repeat_readonly: true };
    },
  );
  await ledger.verify(
    ["execution-detail"],
    "negative",
    "A missing execution gives a useful error and return control",
    async () => {
      await page.goto(
        ui.origin + "/executions/00000000-0000-4000-8000-000000000000",
      );
      await expect(
        page.getByRole("alert").filter({ hasText: "资源或版本不存在。" }),
      ).toBeVisible();
      await button("返回").click();
      await expect(
        page.getByRole("heading", { name: "执行历史", exact: true }),
      ).toBeVisible();
      return { missing_handled: true };
    },
  );
  await ledger.verify(
    ["execution-back"],
    "boundary",
    "An unsafe return URL falls back to the local history page",
    async () => {
      await page.goto(
        ui.origin +
          "/executions/" +
          state.execution.id +
          "?return=" +
          encodeURIComponent("https://example.invalid"),
      );
      await button("返回", page.locator(".testflow-page-heading")).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe("/executions");
      expect(new URL(page.url()).origin).toBe(ui.origin);
      return { unsafe_return_rejected: true };
    },
  );
  await detail(env.acceptance.executions[0].id);
  await ledger.verify(
    ["trace-node"],
    "normal",
    "Selecting a real module node and internal Span exposes their recorded identities",
    async () => {
      const ex = await api(
        "get",
        "/executions/" + env.acceptance.executions[0].id,
      );
      const node = Object.values(ex.nodes).find((n) => n.runtime_id),
        span = ex.events.find(
          (e) => e.node_id === node.id && e.kind === "trace.internal",
        );
      expect(node.image_id).toBeTruthy();
      expect(span).toBeTruthy();
      const nodeControl = page
        .locator('[data-a="trace-node"]')
        .filter({ hasText: node.name });
      await nodeControl.click();
      await expect(nodeControl).toHaveAttribute("aria-pressed", "true");
      expect(new URL(page.url()).searchParams.get("node")).toBe(node.id);
      const spanControl = page
        .locator('[data-a="trace-span"]')
        .filter({ hasText: span.data.name })
        .first();
      await spanControl.click();
      await expect(spanControl).toHaveAttribute("aria-pressed", "true");
      expect(new URL(page.url()).searchParams.get("span")).toBe(
        span.data.span_id,
      );
      await expect(
        page
          .getByRole("tabpanel")
          .locator("pre")
          .filter({ hasText: node.runtime_id })
          .first(),
      ).toBeVisible();
      return {
        node_id: node.id,
        span_id: span.data.span_id,
        image_id: node.image_id,
      };
    },
  );
  await ledger.verify(
    ["trace-node"],
    "boundary",
    "Returning to a parent node clears the internal Span selection",
    async () => {
      const id = new URL(page.url()).searchParams.get("node");
      const ex = await api(
        "get",
        "/executions/" + env.acceptance.executions[0].id,
      );
      const parent = page
        .locator('[data-a="trace-node"]')
        .filter({ hasText: ex.nodes[id].name });
      await parent.click();
      await expect(parent).toHaveAttribute("aria-pressed", "true");
      expect(new URL(page.url()).searchParams.has("span")).toBe(false);
      return { parent: id, span_cleared: true };
    },
  );
  await detail(state.execution.id, "scoring");
  await ledger.verify(
    ["evaluation-evidence"],
    "normal",
    "A scoring evidence control locates the explicitly bound source",
    async () => {
      await page
        .getByRole("button", { name: "证据跳转 · 实际输出绑定", exact: true })
        .first()
        .click();
      await expect(
        page.getByRole("tab", { name: "输入与输出", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      expect(new URL(page.url()).searchParams.get("evidence_source")).toBe(
        "execution",
      );
      return {
        source: "execution",
        field: new URL(page.url()).searchParams.get("evidence_field"),
      };
    },
  );
  await ledger.verify(
    ["rerun-execution"],
    "negative",
    "A rerun request failure shows an error and keeps the old attempt",
    async () => {
      const failure = await ui.failOnce(
        "**/api/v1/executions/" + state.execution.id + "/rerun",
        "POST",
      );
      await button("重跑").click();
      await expect(
        page.getByRole("alert").filter({ hasText: "服务暂时不可用，请重试。" }),
      ).toBeVisible();
      expect(failure()).toBe(true);
      expect(new URL(page.url()).pathname).toBe(
        "/executions/" + state.execution.id,
      );
      return { request_failed: true, old_attempt_retained: true };
    },
  );
  await ledger.verify(
    ["rerun-execution"],
    "normal",
    "Explicit retry appends a new attempt and leaves the frozen denominator and old report intact",
    async () => {
      await button("重跑").click();
      await expect(page).not.toHaveURL(
        new RegExp("/executions/" + state.execution.id),
      );
      const id = new URL(page.url()).pathname.split("/").at(-1);
      await settled(id);
      state.rerun = await api("get", "/executions/" + id);
      expect(state.rerun.attempt).toBe(2);
      expect(state.rerun.snapshot).toEqual(state.execution.snapshot);
      const task = await api("get", "/tasks/" + state.task.id);
      expect(task.report.plan_count).toBe(2);
      const reports = await api("get", "/tasks/" + state.task.id + "/reports");
      expect(reports.items.find((r) => r.id === state.oldReport.id)).toEqual(
        state.oldReport,
      );
      return {
        execution_id: id,
        attempt: 2,
        plan_count: 2,
        old_report_unchanged: true,
      };
    },
  );
  await ledger.verify(
    ["reevaluate-execution"],
    "negative",
    "Cancel adds no evaluation; a failed reevaluation keeps the dialog available for retry",
    async () => {
      const before = (await api("get", "/executions/" + state.rerun.id))
        .evaluations.length;
      await button("仅重新评测").click();
      await button("取消", dialog()).click();
      expect(
        (await api("get", "/executions/" + state.rerun.id)).evaluations.length,
      ).toBe(before);
      await button("仅重新评测").click();
      const failure = await ui.failOnce(
        "**/api/v1/executions/" + state.rerun.id + "/reevaluate*",
        "POST",
      );
      await button("仅重新评测", dialog()).click();
      await expect(dialog().getByRole("alert")).toBeVisible();
      expect(failure()).toBe(true);
      state.evaluationCount = before;
      return { cancel_no_write: true, failed_dialog_retained: true };
    },
  );
  await ledger.verify(
    ["reevaluate-execution"],
    "normal",
    "Reevaluation appends a separate ended record and retains all old scoring evidence",
    async () => {
      await button("仅重新评测", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      await expect
        .poll(
          async () => {
            const ex = await api("get", "/executions/" + state.rerun.id);
            return (
              ex.evaluations.length === state.evaluationCount + 1 &&
              ex.evaluations.every(
                (e) => !["queued", "running"].includes(e.state),
              )
            );
          },
          { timeout: 60000 },
        )
        .toBe(true);
      expect(new URL(page.url()).searchParams.get("tab")).toBe("scoring");
      return {
        evaluations: state.evaluationCount + 1,
        old_scoring_retained: true,
      };
    },
  );
  await ledger.verify(
    ["cancel-case"],
    "normal",
    "Cancel an actual active invocation while retaining input and terminal evidence",
    async () => {
      const ex = await api("post", "/executions/quick", {
        pipeline_id: state.cancelPipeline.id,
        pipeline_version: state.cancelPipeline.version,
        profile_id: state.profile.id,
        profile_version: state.profile.version,
        inputs: { text: { value: "hang" } },
      });
      await detail(ex.id);
      await expect
        .poll(
          async () => {
            const record = await api("get", "/executions/" + ex.id);
            return record.events.some((e) => e.kind === "module.request");
          },
          { timeout: 45000 },
        )
        .toBe(true);
      await button("取消执行").click();
      await settled(ex.id);
      const canceled = await api("get", "/executions/" + ex.id);
      expect(canceled.state).toBe("canceled");
      expect(canceled.events.some((e) => e.kind === "module.request")).toBe(
        true,
      );
      state.canceledExecution = canceled;
      return { id: ex.id, state: canceled.state, cleanup: canceled.cleanup };
    },
  );
  await ledger.verify(
    ["cancel-case"],
    "boundary",
    "A terminal execution exposes rerun and cannot be canceled again from the page",
    async () => {
      await expect(button("取消执行")).toHaveCount(0);
      await expect(button("重跑")).toBeEnabled();
      expect(
        (await api("get", "/executions/" + state.canceledExecution.id)).state,
      ).toBe("canceled");
      return { terminal_cancel_absent: true };
    },
  );
  await page.goto(ui.origin + "/executions?task_id=" + state.task.id);
}

export async function sessionControls(env) {
  const { ui, ledger } = env,
    { page, button, api } = ui;
  await env.finishTrace();
  const target = "/executions?task_id=" + env.state.task.id;
  await ledger.verify(
    ["session-expiry"],
    "negative",
    "Server-side logout invalidates the live session and login retains the original address",
    async () => {
      await api("post", "/auth/logout");
      await expect(page).toHaveURL(/\/login\?return=/, { timeout: 15000 });
      expect(new URL(page.url()).searchParams.get("return")).toBe(target);
      return { server_session_invalidated: true, return: target };
    },
  );
  await ledger.verify(
    ["login"],
    "negative",
    "An incorrect password returns a localized error without exposing the submitted password",
    async () => {
      await page
        .getByRole("textbox", { name: "密码*", exact: true })
        .fill("intentionally-incorrect-coverage-password");
      await button("登录").click();
      await expect(page.getByRole("alert")).toContainText(
        "用户名或密码不正确。",
      );
      expect(
        (await page.locator("body").innerText()).includes(
          "intentionally-incorrect-coverage-password",
        ),
      ).toBe(false);
      return { wrong_password_rejected: true, secret_not_rendered: true };
    },
  );
  await ledger.verify(
    ["login", "session-expiry"],
    "normal",
    "A valid login returns to the saved filters with an HttpOnly session cookie",
    async () => {
      await page
        .getByRole("textbox", { name: "密码*", exact: true })
        .fill(env.access.password);
      await button("登录").click();
      await expect(page).toHaveURL(ui.origin + target);
      const cookies = await env.context.cookies();
      expect(cookies.find((c) => c.name === "testflow_session").httpOnly).toBe(
        true,
      );
      return { returned_to: target, cookie_http_only: true };
    },
  );
  await ledger.verify(
    ["logout"],
    "normal",
    "The account logout revokes the session and returns to login",
    async () => {
      await button("退出登录").click();
      await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
      const response = await page.request.get(
        ui.origin + "/api/v1/auth/session",
      );
      expect(response.status()).toBe(401);
      return { revoked: true, session_status: 401 };
    },
  );
  await ledger.verify(
    ["logout"],
    "boundary",
    "An unsafe login return cannot navigate outside TestFlow",
    async () => {
      await page.goto(
        ui.origin + "/login?return=" + encodeURIComponent("//example.invalid"),
      );
      await page
        .getByRole("textbox", { name: "密码*", exact: true })
        .fill(env.access.password);
      await button("登录").click();
      await expect
        .poll(() => {
          const url = new URL(page.url());
          return url.origin + url.pathname;
        })
        .toBe(ui.origin + "/");
      return { unsafe_return_rejected: true };
    },
  );
  await ledger.verify(
    ["session-read"],
    "negative",
    "A session read outage gives Retry and preserves authentication for recovery",
    async () => {
      const failure = await ui.failReads("**/api/v1/auth/session");
      await page.reload();
      await expect(
        page.getByRole("alert").filter({ hasText: "服务暂时不可用，请重试。" }),
      ).toBeVisible();
      await failure.restore();
      await button("重试").click();
      await expect(
        page.getByRole("heading", { name: "测试工作台", exact: true }),
      ).toBeVisible();
      return { outage_visible: true, recovered_without_relogin: true };
    },
  );
  const secret = "disposable-browser-fixture-" + randomUUID(),
    credentialName = env.prefix + " Git credential";
  await ledger.verify(
    ["credentials"],
    "negative",
    "Credential creation requires values and a write failure retains the masked secret for explicit retry",
    async () => {
      await button("凭据管理").click();
      await expect(button("创建", ui.dialog())).toBeDisabled();
      await ui
        .dialog()
        .getByRole("textbox", { name: "名称*", exact: true })
        .fill(credentialName);
      await ui.select("类型", "git-http");
      await ui.dialog().locator('input[type="password"]').fill(secret);
      await ui.failOnce("**/api/v1/credentials", "POST");
      await button("创建", ui.dialog()).click();
      await expect(ui.dialog().getByRole("alert")).toBeVisible();
      await expect(ui.dialog().locator('input[type="password"]')).toHaveValue(
        secret,
      );
      expect((await ui.dialog().innerText()).includes(secret)).toBe(false);
      return { required_values: true, failed_secret_retained_and_masked: true };
    },
  );
  await ledger.verify(
    ["credentials"],
    "normal",
    "Retry saves a credential reference and API/UI expose metadata only",
    async () => {
      await button("创建", ui.dialog()).click();
      await expect(
        ui.dialog().getByText(credentialName, { exact: true }),
      ).toBeVisible();
      const records = await api("get", "/credentials"),
        created = records.items.find((item) => item.name === credentialName);
      expect(created).toBeTruthy();
      expect(created).not.toHaveProperty("value");
      expect(created).not.toHaveProperty("encrypted");
      expect(JSON.stringify(records).includes(secret)).toBe(false);
      await expect(ui.dialog().locator('input[type="password"]')).toHaveValue(
        "",
      );
      await button("关闭", ui.dialog()).click();
      return {
        credential_id: created.id,
        metadata_only: true,
        input_cleared: true,
      };
    },
  );
}
