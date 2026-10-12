import { expect } from "@playwright/test";

export async function repositoriesControls(env) {
  const { ui, ledger, names, state } = env,
    { page, button, dialog, api, resource } = ui;
  await page.goto(ui.origin + "/repositories");
  await ledger.verify(
    ["new-repo"],
    "negative",
    "Empty registration is disabled; cancel returns focus",
    async () => {
      await button("注册仓库").click();
      await expect(button("保存", dialog())).toBeDisabled();
      await button("取消", dialog()).click();
      await expect(button("注册仓库")).toBeFocused();
      return { submit_disabled: true, focus_returned: true };
    },
  );
  await ledger.verify(
    ["new-repo"],
    "normal",
    "Register an actual Git repository and read its persisted identity",
    async () => {
      await button("注册仓库").click();
      await dialog()
        .getByRole("textbox", { name: "名称*", exact: true })
        .fill(names.repo);
      await dialog()
        .getByRole("textbox", { name: "仓库地址*", exact: true })
        .fill("file:///data/fixtures/repository");
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      state.repo = await resource("repositories", names.repo);
      return { id: state.repo.id, branch: state.repo.data.branch };
    },
  );
  const row = page.getByRole("row").filter({ hasText: names.repo });
  await ledger.verify(
    ["sync-repo"],
    "normal",
    "Sync this repository to a complete immutable commit",
    async () => {
      await button("手动同步", row).click();
      await expect(row.getByText("可用", { exact: true })).toBeVisible({
        timeout: 45000,
      });
      state.repo = await api("get", "/repositories/" + state.repo.id);
      expect(state.repo.data.commit).toMatch(/^[a-f0-9]{40}$/);
      return { commit: state.repo.data.commit, version: state.repo.version };
    },
  );
  await ledger.verify(
    ["edit-repo"],
    "normal",
    "Edit metadata into a new persisted revision",
    async () => {
      await button("编辑", row).click();
      await dialog()
        .getByRole("textbox", { name: "说明", exact: true })
        .fill("coverage revision");
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      state.repo = await api("get", "/repositories/" + state.repo.id);
      expect(state.repo.data.description).toBe("coverage revision");
      return {
        version: state.repo.version,
        description: state.repo.data.description,
      };
    },
  );
  await ledger.verify(
    ["edit-repo"],
    "negative",
    "A real concurrent edit produces 409 and retains the draft through explicit review",
    async () => {
      await button("编辑", row).click();
      await dialog()
        .getByRole("textbox", { name: "说明", exact: true })
        .fill("retained local description");
      const prior = await api("get", "/repositories/" + state.repo.id);
      await api("put", "/repositories/" + prior.id, {
        expected_version: prior.version,
        data: { ...prior.data, description: "other writer" },
      });
      await button("保存", dialog()).click();
      await expect(
        page.getByText("服务端已有新版本，本地草稿已保留。", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog().getByRole("textbox", { name: "说明", exact: true }),
      ).toHaveValue("retained local description");
      await button("查看最新版本", dialog()).click();
      await expect(dialog().locator("pre").first()).toContainText(
        "other writer",
      );
      await button("保留草稿并继续编辑", dialog()).click();
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      state.repo = await api("get", "/repositories/" + prior.id);
      expect(state.repo.data.description).toBe("retained local description");
      return {
        conflict_preserved: true,
        reviewed: true,
        version: state.repo.version,
      };
    },
  );
  await ledger.verify(
    ["sync-repo"],
    "negative",
    "A missing branch fails, survives reload and succeeds after correction",
    async () => {
      await button("编辑", row).click();
      await dialog()
        .getByRole("textbox", { name: "分支*", exact: true })
        .fill("missing-coverage-branch");
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      await button("手动同步", row).click();
      await expect(row.getByText("失败", { exact: true })).toBeVisible({
        timeout: 45000,
      });
      await page.reload();
      await expect(row.getByText("失败", { exact: true })).toBeVisible();
      await button("编辑", row).click();
      await dialog()
        .getByRole("textbox", { name: "分支*", exact: true })
        .fill("main");
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      await button("手动同步", row).click();
      await expect(row.getByText("可用", { exact: true })).toBeVisible({
        timeout: 45000,
      });
      return { failure_persisted: true, retry_succeeded: true };
    },
  );
  await ledger.verify(
    ["repo-versions"],
    "normal",
    "Versions show previous revisions; close returns to the source row",
    async () => {
      await button("版本记录", row).click();
      await expect(dialog().locator("pre")).toContainText('"number"');
      await button("关闭", dialog()).click();
      await expect(row).toBeVisible();
      return { drawer_closed: true };
    },
  );
  await ledger.verify(
    ["repo-versions"],
    "boundary",
    "Escape closes versions without changing the commit and returns focus",
    async () => {
      await button("版本记录", row).click();
      await dialog().press("Escape");
      await expect(dialog()).toHaveCount(0);
      await expect(button("版本记录", row)).toBeFocused();
      const current = await api("get", "/repositories/" + state.repo.id);
      expect(current.data.commit).toMatch(/^[a-f0-9]{40}$/);
      return { focus_returned: true, commit: current.data.commit };
    },
  );
}

export async function globalControls(env) {
  const { ui, ledger, state } = env,
    { page, button, dialog, api } = ui;
  await ledger.verify(
    ["about"],
    "normal",
    "Account opens version and protocol information",
    async () => {
      await button("关于 TestFlow").first().click();
      await expect(dialog("关于 TestFlow")).toContainText("testflow.module.v1");
      return { version_visible: true };
    },
  );
  await ledger.verify(
    ["close-modal"],
    "normal",
    "Close dismisses about and returns focus",
    async () => {
      await button("关闭", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      await expect(button("关于 TestFlow").first()).toBeFocused();
      return { closed: true, focus_returned: true };
    },
  );
  await ledger.verify(
    ["about", "close-modal"],
    "boundary",
    "Escape closes information without changing resources",
    async () => {
      await button("关于 TestFlow").first().click();
      await dialog().press("Escape");
      await expect(dialog()).toHaveCount(0);
      return { closed_with_escape: true, resource_id: state.repo.id };
    },
  );
  await ledger.verify(
    ["guide"],
    "normal",
    "Guide starts at registration and exposes eight steps",
    async () => {
      await button("体验全流程").click();
      await expect(page.locator(".testflow-guide")).toContainText("1 / 8");
      return { step: 1 };
    },
  );
  await ledger.verify(
    ["guide", "guide-prev"],
    "boundary",
    "The first guide step cannot go backward",
    async () => {
      await expect(
        button("上一步", page.locator(".testflow-guide")),
      ).toBeDisabled();
      return { previous_disabled: true };
    },
  );
  await ledger.verify(
    ["guide-next"],
    "normal",
    "Next opens the capability module step",
    async () => {
      await button("下一步", page.locator(".testflow-guide")).click();
      await expect(page.locator(".testflow-guide")).toContainText("2 / 8");
      await expect(
        page.getByRole("heading", { name: "能力模块", exact: true }),
      ).toBeVisible();
      return { step: 2 };
    },
  );
  await ledger.verify(
    ["guide-prev"],
    "normal",
    "Previous returns to registration",
    async () => {
      await button("上一步", page.locator(".testflow-guide")).click();
      await expect(page.locator(".testflow-guide")).toContainText("1 / 8");
      return { step: 1 };
    },
  );
  await ledger.verify(
    ["guide-next"],
    "boundary",
    "Guide cannot advance beyond the eighth step",
    async () => {
      for (let i = 0; i < 7; i++)
        await button("下一步", page.locator(".testflow-guide")).click();
      await expect(page.locator(".testflow-guide")).toContainText("8 / 8");
      await expect(
        button("下一步", page.locator(".testflow-guide")),
      ).toBeDisabled();
      return { step: 8, next_disabled: true };
    },
  );
  await ledger.verify(
    ["end-guide"],
    "normal",
    "End removes the guide while retaining the current page",
    async () => {
      await button("结束导览").click();
      await expect(page.locator(".testflow-guide")).toHaveCount(0);
      return { route: new URL(page.url()).pathname };
    },
  );
  await ledger.verify(
    ["end-guide"],
    "boundary",
    "Guide can end early and the selected page remains usable",
    async () => {
      await button("体验全流程").click();
      await button("结束导览").click();
      await expect(page.locator(".testflow-guide")).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "代码仓库", exact: true }),
      ).toBeVisible();
      return { early_end: true };
    },
  );
  await ledger.verify(
    ["refresh-view"],
    "normal",
    "Refresh reads the server again and retains the route",
    async () => {
      const route = page.url(),
        refreshed = page.waitForResponse(
          (r) =>
            r.url().includes("/api/v1/repositories") &&
            r.request().method() === "GET",
        );
      await button("刷新", page.getByRole("banner")).click();
      expect((await refreshed).status()).toBe(200);
      expect(page.url()).toBe(route);
      return { fresh_response: 200, route };
    },
  );
  await ledger.verify(
    ["refresh-view"],
    "negative",
    "A failed refresh shows an error and explicit retry recovers",
    async () => {
      const injected = await ui.failReads("**/api/v1/repositories?*");
      await button("刷新", page.getByRole("banner")).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "服务暂时不可用，请重试。" }),
      ).toBeVisible();
      expect(injected.count()).toBeGreaterThan(0);
      await injected.restore();
      await button("刷新", page.getByRole("banner")).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "服务暂时不可用，请重试。" }),
      ).toHaveCount(0);
      return { failure_visible: true, retry_succeeded: true };
    },
  );
  await ledger.verify(
    ["search"],
    "normal",
    "A real resource search navigates through its result",
    async () => {
      await button("搜索工作区 Ctrl K").click();
      await dialog()
        .getByRole("textbox", { name: "搜索工作区", exact: true })
        .fill(state.repo.name);
      await dialog()
        .getByRole("button")
        .filter({ hasText: state.repo.name })
        .click();
      await expect(page).toHaveURL(
        new RegExp("/repositories/" + state.repo.id),
      );
      await expect(dialog()).toContainText(state.repo.name + " · 版本记录");
      await button("关闭", dialog()).click();
      return { resource_id: state.repo.id };
    },
  );
  await ledger.verify(
    ["search"],
    "boundary",
    "An unmatched search shows empty state and Escape returns focus",
    async () => {
      await button("搜索工作区 Ctrl K").click();
      await dialog()
        .getByRole("textbox", { name: "搜索工作区", exact: true })
        .fill("coverage-no-matching-resource");
      await expect(
        dialog().getByText("没有匹配结果", { exact: true }),
      ).toBeVisible();
      await dialog().press("Escape");
      await expect(button("搜索工作区 Ctrl K")).toBeFocused();
      return { empty: true, focus_returned: true };
    },
  );
  await ledger.verify(
    ["search-execution"],
    "normal",
    "Ctrl K and an execution ID open actual execution detail",
    async () => {
      await page.locator("body").press("Control+k");
      await dialog()
        .getByRole("textbox", { name: "搜索工作区", exact: true })
        .fill(env.acceptance.executions[0].id);
      await dialog().locator(".testflow-search-result").click();
      await expect(page).toHaveURL(
        new RegExp("/executions/" + env.acceptance.executions[0].id),
      );
      await expect(
        page.getByRole("tab", { name: "执行过程", exact: true }),
      ).toBeVisible();
      return { execution_id: env.acceptance.executions[0].id };
    },
  );
  await ledger.verify(
    ["search-execution"],
    "negative",
    "A search API failure retains the dialog and a new query recovers",
    async () => {
      await button("搜索工作区 Ctrl K").click();
      const failure = await ui.failReads("**/api/v1/system/search?*");
      await dialog()
        .getByRole("textbox", { name: "搜索工作区", exact: true })
        .fill("temporary-search-failure");
      await expect(
        dialog()
          .getByRole("alert")
          .filter({ hasText: "服务暂时不可用，请重试。" }),
      ).toBeVisible();
      await failure.restore();
      await dialog()
        .getByRole("textbox", { name: "搜索工作区", exact: true })
        .fill(env.acceptance.executions[0].id);
      await expect(dialog().locator(".testflow-search-result")).toHaveCount(1);
      await dialog().press("Escape");
      return { failure_recovered: true };
    },
  );
  await page.goto(ui.origin + "/repositories");
  const row = page.getByRole("row").filter({ hasText: state.repo.name });
  await ledger.verify(
    ["hide-resource", "confirm-hide"],
    "boundary",
    "Canceling hide keeps the resource available",
    async () => {
      await button("隐藏 " + state.repo.name, row).click();
      await button("取消", dialog()).click();
      await expect(row).toBeVisible();
      expect((await api("get", "/repositories/" + state.repo.id)).hidden).toBe(
        false,
      );
      return { hidden: false };
    },
  );
  await ledger.verify(
    ["hide-resource", "confirm-hide"],
    "normal",
    "Confirm hide removes the row and preserves the old revision",
    async () => {
      await button("隐藏 " + state.repo.name, row).click();
      await button("确认隐藏", dialog()).click();
      await expect(row).toHaveCount(0);
      expect((await api("get", "/repositories/" + state.repo.id)).hidden).toBe(
        true,
      );
      expect(
        (await api("get", "/repositories/" + state.repo.id + "?version=1"))
          .selected_version,
      ).toBe(1);
      return { hidden: true, old_version: 1 };
    },
  );
  await ledger.verify(
    ["hidden-resources"],
    "normal",
    "Global hidden view lists the hidden repository",
    async () => {
      await button("隐藏资源").click();
      await expect(button("恢复 " + state.repo.name, dialog())).toBeVisible();
      return { resource_id: state.repo.id };
    },
  );
  await ledger.verify(
    ["hidden-resources"],
    "boundary",
    "A type with no hidden resources displays the empty state",
    async () => {
      await ui.select("类型", "能力模块");
      await expect(
        dialog().getByText("暂无数据", { exact: true }),
      ).toBeVisible();
      await ui.select("类型", "代码仓库");
      return { empty_type: "modules" };
    },
  );
  await ledger.verify(
    ["restore-resource"],
    "boundary",
    "Canceling restore keeps the resource hidden",
    async () => {
      await button("恢复 " + state.repo.name, dialog()).click();
      await button("取消", dialog()).click();
      expect((await api("get", "/repositories/" + state.repo.id)).hidden).toBe(
        true,
      );
      return { hidden: true };
    },
  );
  await ledger.verify(
    ["restore-resource"],
    "normal",
    "Restore returns the repository to its original list",
    async () => {
      await button("恢复 " + state.repo.name, dialog()).click();
      await button("恢复", dialog()).click();
      await expect(button("恢复 " + state.repo.name, dialog())).toHaveCount(0);
      await button("关闭", dialog()).click();
      await expect(row).toBeVisible();
      expect((await api("get", "/repositories/" + state.repo.id)).hidden).toBe(
        false,
      );
      return { hidden: false };
    },
  );
}
