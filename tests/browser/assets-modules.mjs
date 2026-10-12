import { expect } from "@playwright/test";

export async function assetsControls(env) {
  const { ui, ledger, names, state, files } = env,
    { page, button, dialog, api, resource } = ui;
  await page.goto(ui.origin + "/assets");
  await ledger.verify(
    ["new-text-asset"],
    "negative",
    "Empty text is disabled; an HTTP failure retains typed content for retry",
    async () => {
      await button("新增文字").click();
      await expect(button("保存", dialog())).toBeDisabled();
      await dialog()
        .getByRole("textbox", { name: "名称", exact: true })
        .fill(names.asset);
      await dialog()
        .getByRole("textbox", { name: "文字内容", exact: true })
        .fill("coverage input");
      const failure = await ui.failOnce("**/api/v1/assets", "POST");
      await button("保存", dialog()).click();
      await expect(
        dialog()
          .getByRole("alert")
          .filter({ hasText: "服务暂时不可用，请重试。" }),
      ).toBeVisible();
      expect(failure()).toBe(true);
      await expect(
        dialog().getByRole("textbox", { name: "文字内容", exact: true }),
      ).toHaveValue("coverage input");
      return { submit_disabled_when_empty: true, content_retained: true };
    },
  );
  await ledger.verify(
    ["new-text-asset"],
    "normal",
    "Retry saves the actual text resource exactly once",
    async () => {
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      state.asset = await resource("assets", names.asset);
      expect(state.asset.data.text).toBe("coverage input");
      const matches = (
        await api("get", "/assets?search=" + encodeURIComponent(names.asset))
      ).items.filter((r) => r.name === names.asset);
      expect(matches).toHaveLength(1);
      return { id: state.asset.id, instances: matches.length };
    },
  );
  const row = page.getByRole("row").filter({ hasText: names.asset });
  await ledger.verify(
    ["asset-detail", "close-drawer"],
    "boundary",
    "Closing and reopening a material drawer retains its unsubmitted reference draft",
    async () => {
      await button("查看详情", row).click();
      await dialog()
        .getByRole("textbox", { name: "参考内容", exact: true })
        .fill("coverage reference");
      await button("关闭", dialog()).click();
      await button("查看详情", row).click();
      await expect(
        dialog().getByRole("textbox", { name: "参考内容", exact: true }),
      ).toHaveValue("coverage reference");
      expect(
        (await api("get", "/assets/" + state.asset.id)).selected_version,
      ).toBe(1);
      return { draft_retained: true, saved_version: 1 };
    },
  );
  await ledger.verify(
    ["asset-detail"],
    "normal",
    "Tags and a confirmed reference create a new version without changing the original",
    async () => {
      await dialog()
        .getByRole("textbox", { name: "标签（逗号分隔）", exact: true })
        .fill("coverage,immutable");
      await ui.setChecked(dialog().getByRole("checkbox"), true);
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      state.asset = await api("get", "/assets/" + state.asset.id);
      expect(state.asset.data.tags).toEqual(["coverage", "immutable"]);
      expect(state.asset.data.reference_confirmed).toBe(true);
      expect(state.asset.version).toBe(2);
      const original = await api(
        "get",
        "/assets/" + state.asset.id + "?version=1",
      );
      expect(original.data.reference_confirmed).toBe(false);
      return { version: 2, original_unchanged: true };
    },
  );
  await ledger.verify(
    ["close-drawer"],
    "normal",
    "The material drawer Close control dismisses it and returns to its source list",
    async () => {
      await button("查看详情", row).click();
      await button("关闭", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      await expect(row).toBeVisible();
      return { drawer_closed: true, source_list_available: true };
    },
  );
  await ledger.verify(
    ["import-asset"],
    "boundary",
    "No files cannot submit; a bad WAV has its own error while other files import",
    async () => {
      await button("导入素材").click();
      await expect(button("导入素材", dialog())).toBeDisabled();
      await ui.upload(dialog(), [
        files.text,
        files.png,
        files.audio,
        files.invalid,
      ]);
      const chosen = await dialog()
        .locator('input[type="file"]')
        .evaluate((e) => Array.from(e.files).map((f) => f.name));
      expect(chosen).toHaveLength(4);
      await button("导入素材", dialog()).click();
      await expect(dialog().getByRole("alert")).toHaveCount(1);
      await expect(
        dialog().getByText(files.invalid.split("/").at(-1), { exact: true }),
      ).toBeVisible();
      return { selected_files: chosen, per_file_errors: 1 };
    },
  );
  await ledger.verify(
    ["import-asset"],
    "normal",
    "Text, PNG and ten-second WAV become real media assets",
    async () => {
      await button("关闭", dialog()).last().click();
      await expect(dialog()).toHaveCount(0);
      const uploaded = [];
      for (const file of [files.text, files.png, files.audio])
        uploaded.push(await resource("assets", file.split("/").at(-1)));
      expect(uploaded.map((r) => r.data.type).sort()).toEqual([
        "Audio",
        "Image",
        "Text",
      ]);
      state.audio = uploaded.find((r) => r.data.type === "Audio");
      state.image = uploaded.find((r) => r.data.type === "Image");
      expect(state.audio.data.metadata.duration).toBeGreaterThanOrEqual(9.9);
      const range = await page.request.get(
        ui.origin + "/api/v1/media/" + state.audio.id,
        { headers: { Range: "bytes=0-15" } },
      );
      expect(range.status()).toBe(206);
      return {
        types: uploaded.map((r) => r.data.type),
        range_status: 206,
        duration: state.audio.data.metadata.duration,
      };
    },
  );
  const audioRow = page.getByRole("row").filter({ hasText: state.audio.name });
  await ledger.verify(
    ["play-audio"],
    "normal",
    "Play starts audio; Stop resets playback to zero and page departure releases it",
    async () => {
      await button("播放音频 " + state.audio.name, audioRow).click();
      await expect(
        button("停止播放 " + state.audio.name, audioRow),
      ).toBeVisible();
      expect(await audioRow.locator("audio").evaluate((e) => e.paused)).toBe(
        false,
      );
      await button("停止播放 " + state.audio.name, audioRow).click();
      expect(
        await audioRow
          .locator("audio")
          .evaluate((e) => ({ paused: e.paused, time: e.currentTime })),
      ).toEqual({ paused: true, time: 0 });
      await button("播放音频 " + state.audio.name, audioRow).click();
      await page.getByRole("link", { name: /^能力模块/ }).click();
      await expect(page.locator("audio")).toHaveCount(0);
      return {
        played: true,
        stopped_at_zero: true,
        released_on_departure: true,
      };
    },
  );
  await ledger.verify(
    ["play-audio"],
    "negative",
    "A failed audio response displays a playback error and a reload permits retry",
    async () => {
      const pattern = "**/api/v1/media/" + state.audio.id + "?*",
        failure = await ui.failReads(pattern);
      await page.goto(ui.origin + "/assets");
      await button("播放音频 " + state.audio.name, audioRow).click();
      await expect(audioRow.getByRole("alert")).toBeVisible();
      await failure.restore();
      await page.reload();
      await button("播放音频 " + state.audio.name, audioRow).click();
      await expect(
        button("停止播放 " + state.audio.name, audioRow),
      ).toBeVisible();
      await button("停止播放 " + state.audio.name, audioRow).click();
      return { playback_error_visible: true, retry_played: true };
    },
  );
}

export async function modulesControls(env) {
  const { ui, ledger, state } = env,
    { page, button, dialog, api } = ui;
  await page.goto(ui.origin + "/modules");
  await ledger.verify(
    ["import-module"],
    "negative",
    "Empty ZIP selection is disabled; an invalid package retains its filename and error",
    async () => {
      await button("导入 ZIP 模块").click();
      await expect(button("导入 ZIP 模块", dialog())).toBeDisabled();
      await ui.upload(dialog(), ["/tmp/testflow-ui-audit/module.zip"]);
      await button("导入 ZIP 模块", dialog()).click();
      await expect(dialog().getByRole("alert")).toBeVisible();
      await expect(dialog()).toContainText("module.zip");
      expect(
        await dialog()
          .locator('input[type="file"]')
          .evaluate((e) => e.files[0].name),
      ).toBe("module.zip");
      return { invalid_package_rejected: true, file_retained: true };
    },
  );
  await ledger.verify(
    ["import-module"],
    "normal",
    "Import the real fault fixture ZIP and open its immutable contract",
    async () => {
      await ui.upload(dialog(), [
        process.cwd() + "/.data/module-packages/test-fixture-1.0.2.zip",
      ]);
      await button("导入 ZIP 模块", dialog()).click();
      await expect(page).toHaveURL(/\/modules\/[a-f0-9-]+$/, {
        timeout: 45000,
      });
      await expect(dialog()).toContainText("manifest.json");
      state.fault = await api(
        "get",
        "/modules/" + new URL(page.url()).pathname.split("/").at(-1),
      );
      expect(state.fault.data.manifest.id).toBe("test-fixture");
      return {
        id: state.fault.id,
        protocol: state.fault.data.manifest.protocol,
      };
    },
  );
  await ledger.verify(
    ["module-detail"],
    "normal",
    "The contract displays Pod configuration, ordered groups and validates an actual Pod",
    async () => {
      await button("关闭", dialog()).click();
      await button(
        "查看契约",
        page
          .locator(".testflow-module-card")
          .filter({ hasText: state.fault.name }),
      ).click();
      await expect(
        dialog().getByRole("textbox", { name: "模块镜像引用", exact: true }),
      ).toHaveValue(state.fault.data.manifest.runtime.image);
      await expect(dialog()).toContainText("输入字段组");
      await expect(dialog()).toContainText("输出字段组");
      await button("验证可用性", dialog()).click();
      await expect(dialog().getByText("成功", { exact: true })).toBeVisible({
        timeout: 90000,
      });
      const available = (await api("get", "/modules?page_size=100")).items.find(
        (m) => m.id === state.fault.id,
      );
      expect(available.availability.result.contract_verified).toBe(true);
      return {
        pod_verified: true,
        image_id: available.availability.result.image_id,
      };
    },
  );
  await button("关闭", dialog()).click();
  await ledger.verify(
    ["module-spec"],
    "normal",
    "Package specification lists required schemas and the shared UI contract",
    async () => {
      await button("包结构说明").click();
      await expect(dialog().locator("pre")).toContainText(
        "schemas/parameters.json",
      );
      await expect(dialog()).toContainText("testflow.ui.v1");
      return { package_spec_visible: true };
    },
  );
  await ledger.verify(
    ["module-spec"],
    "boundary",
    "Escape closes the read-only package specification without importing anything",
    async () => {
      const before = (await api("get", "/modules")).total;
      await dialog().press("Escape");
      await expect(dialog()).toHaveCount(0);
      expect((await api("get", "/modules")).total).toBe(before);
      return { module_count_unchanged: true };
    },
  );
  await ledger.verify(
    ["module-detail"],
    "negative",
    "A configuration component render failure preserves defaults and offers retry",
    async () => {
      await button("导入 ZIP 模块").click();
      await ui.upload(dialog(), ["/tmp/testflow-ui-audit/ui-failure.zip"]);
      await button("导入 ZIP 模块", dialog()).click();
      await expect(
        dialog().getByText("配置组件加载失败；已保存参数保持原样。", {
          exact: true,
        }),
      ).toBeVisible({ timeout: 45000 });
      const moduleId = new URL(page.url()).pathname.split("/").at(-1),
        record = await api("get", "/modules/" + moduleId);
      await expect(
        dialog().locator("pre").filter({ hasText: '"mode"' }).first(),
      ).toBeVisible();
      await button("重试", dialog()).click();
      await expect(
        dialog().getByText("配置组件加载失败；已保存参数保持原样。", {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        (await api("get", "/modules/" + moduleId)).data.manifest.defaults,
      ).toEqual(record.data.manifest.defaults);
      return { readonly_defaults_preserved: true, retry_visible: true };
    },
  );
  await button("关闭", dialog()).click();
  await page.goto(ui.origin + "/modules/" + state.fault.id);
  await ledger.verify(
    ["module-to-flow"],
    "normal",
    "Use in canvas selects an existing saved pipeline and adds the pinned module once",
    async () => {
      await button("在画布中使用", dialog()).click();
      await expect(page).toHaveURL(/\/pipelines\?module=/);
      const card = page
        .locator(".testflow-card")
        .filter({ hasText: "TEST UI scripted pipeline" });
      await button("打开画布", card).click();
      await expect(
        page.locator(".react-flow__node").filter({ hasText: state.fault.name }),
      ).toHaveCount(1);
      state.moduleCanvas = new URL(page.url()).pathname;
      return { canvas: state.moduleCanvas, module_id: state.fault.id };
    },
  );
  await ledger.verify(
    ["module-to-flow"],
    "boundary",
    "The added module is an unsaved draft; revert leaves the saved pipeline intact",
    async () => {
      const id = state.moduleCanvas.split("/").at(-1),
        saved = await api("get", "/pipelines/" + id);
      expect(saved.data.nodes.some((n) => n.module_id === state.fault.id)).toBe(
        false,
      );
      await button("恢复上次保存").click();
      await expect(
        page.locator(".react-flow__node").filter({ hasText: state.fault.name }),
      ).toHaveCount(0);
      return { saved_pipeline_unchanged: true, added_draft_reverted: true };
    },
  );
}
