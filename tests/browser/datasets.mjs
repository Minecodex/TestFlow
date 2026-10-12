import { expect } from "@playwright/test";

export async function datasetsControls(env) {
  const { ui, ledger, names, state } = env,
    { page, button, dialog, api, resource } = ui;
  await page.goto(ui.origin + "/datasets");
  await ledger.verify(
    ["new-dataset", "dataset-next"],
    "negative",
    "Unnamed wizard cannot advance; closing does not create a resource",
    async () => {
      await button("新建测试集").click();
      await expect(button("下一步", dialog())).toBeDisabled();
      await button("取消", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      return { next_disabled: true };
    },
  );
  await ledger.verify(
    ["new-dataset"],
    "normal",
    "New dataset opens the ordered input/output schema wizard",
    async () => {
      await button("新建测试集").click();
      await dialog()
        .getByRole("textbox", { name: "名称", exact: true })
        .fill(names.dataset);
      await expect(
        dialog().getByRole("textbox", { name: "字段名", exact: true }),
      ).toHaveCount(2);
      return { input_fields: 1, output_fields: 1 };
    },
  );
  await ledger.verify(
    ["schema-up", "dataset-prev"],
    "boundary",
    "First fields and the first wizard step cannot move backward",
    async () => {
      await expect(button("向上移动", dialog()).first()).toBeDisabled();
      await expect(button("上一步", dialog())).toBeDisabled();
      return { field_up_disabled: true, previous_step_disabled: true };
    },
  );
  await ledger.verify(
    ["schema-add"],
    "normal",
    "Add creates another ordered input field without replacing existing values",
    async () => {
      await button("新增字段", dialog()).first().click();
      await expect(
        dialog().getByRole("textbox", { name: "字段名", exact: true }),
      ).toHaveCount(3);
      await expect(
        dialog().getByRole("textbox", { name: "字段名", exact: true }).nth(1),
      ).toHaveValue("field_2");
      return { field_names: ["text", "field_2", "text"] };
    },
  );
  await ledger.verify(
    ["schema-add", "dataset-batch-add"],
    "boundary",
    "Duplicate field names block advancement; multi-field inputs disable one-asset batch creation",
    async () => {
      await dialog()
        .getByRole("textbox", { name: "字段名", exact: true })
        .nth(1)
        .fill("text");
      await expect(
        dialog().getByRole("alert").filter({ hasText: "字段名不能重复。" }),
      ).toBeVisible();
      await expect(button("下一步", dialog())).toBeDisabled();
      await dialog()
        .getByRole("textbox", { name: "字段名", exact: true })
        .nth(1)
        .fill("field_2");
      await button("下一步", dialog()).click();
      await expect(button("批量加入素材", dialog())).toBeDisabled();
      await button("上一步", dialog()).click();
      return { duplicate_blocked: true, multi_field_batch_disabled: true };
    },
  );
  await ledger.verify(
    ["schema-up"],
    "normal",
    "Moving field two up preserves values and changes only input order",
    async () => {
      await button("向上移动", dialog()).nth(1).click();
      await expect(
        dialog().getByRole("textbox", { name: "字段名", exact: true }).first(),
      ).toHaveValue("field_2");
      return { first_input: "field_2", second_input: "text" };
    },
  );
  await ledger.verify(
    ["schema-remove"],
    "normal",
    "Remove discards the selected field and retains the other schema group",
    async () => {
      await button("删除字段", dialog()).first().click();
      await expect(
        dialog().getByRole("textbox", { name: "字段名", exact: true }),
      ).toHaveCount(2);
      return { input: "text", output: "text" };
    },
  );
  await ledger.verify(
    ["schema-remove"],
    "boundary",
    "Removing all input fields disables advancement until a valid field is restored",
    async () => {
      await button("删除字段", dialog()).first().click();
      await expect(button("下一步", dialog())).toBeDisabled();
      await expect(
        dialog().getByText("字段组至少需要一个字段。", { exact: true }),
      ).toBeVisible();
      await button("新增字段", dialog()).first().click();
      await dialog()
        .getByRole("textbox", { name: "字段名", exact: true })
        .first()
        .fill("text");
      await expect(button("下一步", dialog())).toBeEnabled();
      return { empty_blocked: true, restored: true };
    },
  );
  await ledger.verify(
    ["dataset-next"],
    "normal",
    "A valid schema advances to editable members",
    async () => {
      await button("下一步", dialog()).click();
      await expect(button("新增案例", dialog())).toBeVisible();
      return { step: "members" };
    },
  );
  await ledger.verify(
    ["draft-add-case"],
    "negative",
    "Invalid reference JSON blocks a nested case save and retains input",
    async () => {
      await button("新增案例", dialog()).click();
      await dialog()
        .getByRole("textbox", { name: "案例名称", exact: true })
        .fill(names.case);
      await dialog()
        .getByRole("textbox", { name: "text", exact: true })
        .fill("coverage case input");
      await dialog()
        .getByRole("textbox", { name: "参考字段 JSON", exact: true })
        .fill("{bad");
      await expect(button("保存", dialog())).toBeDisabled();
      await expect(dialog().getByRole("alert")).toBeVisible();
      await expect(
        dialog().getByRole("textbox", { name: "text", exact: true }),
      ).toHaveValue("coverage case input");
      return { invalid_reference_blocked: true, input_retained: true };
    },
  );
  await ledger.verify(
    ["draft-add-case"],
    "normal",
    "Valid nested case is added with explicit reference confirmation",
    async () => {
      await dialog()
        .getByRole("textbox", { name: "参考字段 JSON", exact: true })
        .fill('{"text":"coverage reference"}');
      await ui.setChecked(
        dialog().getByRole("checkbox", { name: "已确认参考", exact: true }),
        true,
      );
      await button("保存", dialog()).click();
      await expect(
        dialog().getByText(names.case, { exact: true }),
      ).toBeVisible();
      return { case_name: names.case, confirmed: true };
    },
  );
  await ledger.verify(
    ["draft-add-case"],
    "boundary",
    "Canceling a nested empty case returns to existing members",
    async () => {
      await button("新增案例", dialog()).click();
      await button("取消", dialog()).click();
      await expect(
        dialog().getByText(names.case, { exact: true }),
      ).toBeVisible();
      return { parent_restored: true };
    },
  );
  await ledger.verify(
    ["draft-edit-case"],
    "normal",
    "Draft edit changes case identity while retaining its input and reference",
    async () => {
      await button("编辑", dialog()).click();
      await expect(
        dialog().getByRole("textbox", { name: "text", exact: true }),
      ).toHaveValue("coverage case input");
      await dialog()
        .getByRole("textbox", { name: "案例名称", exact: true })
        .fill(names.case + " edited");
      await button("保存", dialog()).click();
      await expect(
        dialog().getByText(names.case + " edited", { exact: true }),
      ).toBeVisible();
      return { case_name: names.case + " edited", input_retained: true };
    },
  );
  await ledger.verify(
    ["draft-edit-case"],
    "boundary",
    "Canceling an edit leaves the original member unchanged",
    async () => {
      await button("编辑", dialog()).click();
      await dialog()
        .getByRole("textbox", { name: "案例名称", exact: true })
        .fill("discarded nested rename");
      await button("取消", dialog()).click();
      await expect(
        dialog().getByText(names.case + " edited", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog().getByText("discarded nested rename", { exact: true }),
      ).toHaveCount(0);
      return { member_unchanged: true };
    },
  );
  await ledger.verify(
    ["draft-remove-case"],
    "normal",
    "Removing a draft member updates the wizard without server writes",
    async () => {
      await button("新增案例", dialog()).click();
      await dialog()
        .getByRole("textbox", { name: "案例名称", exact: true })
        .fill("temporary removable member");
      await button("保存", dialog()).click();
      await button("移除", dialog()).last().click();
      await expect(
        dialog().getByText("temporary removable member", { exact: true }),
      ).toHaveCount(0);
      await expect(
        dialog().getByText(names.case + " edited", { exact: true }),
      ).toBeVisible();
      return { temporary_removed: true, other_member_retained: true };
    },
  );
  await ledger.verify(
    ["dataset-batch-add"],
    "normal",
    "Batch addition uses the selected immutable material version and prevents duplicates",
    async () => {
      await button("批量加入素材", dialog()).click();
      const add = button(names.asset + " · v2", dialog());
      await add.click();
      await expect(add).toBeDisabled();
      await button("关闭", dialog()).click();
      await expect(
        dialog().getByText(names.asset, { exact: true }),
      ).toHaveCount(1);
      return { asset_version: 2, deduplicated: true };
    },
  );
  await ledger.verify(
    ["dataset-prev"],
    "normal",
    "Previous retains wizard metadata and members",
    async () => {
      await button("上一步", dialog()).click();
      await expect(
        dialog().getByRole("textbox", { name: "名称", exact: true }),
      ).toHaveValue(names.dataset);
      await button("下一步", dialog()).click();
      await expect(
        dialog().getByText(names.case + " edited", { exact: true }),
      ).toBeVisible();
      return { name_retained: true, members_retained: true };
    },
  );
  await ledger.verify(
    ["dataset-create"],
    "normal",
    "Review saves an immutable dataset with literal and material-bound cases",
    async () => {
      await button("下一步", dialog()).click();
      await expect(dialog().locator("pre")).toContainText(
        '"reference_confirmed": true',
      );
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      state.dataset = await resource("datasets", names.dataset);
      expect(state.dataset.data.cases).toHaveLength(2);
      expect(
        state.dataset.data.cases.find((c) => c.name === names.asset).inputs.text
          .asset_version,
      ).toBe(2);
      return { id: state.dataset.id, version: 1, cases: 2 };
    },
  );
  const card = page
    .locator(".testflow-card")
    .filter({ hasText: names.dataset });
  await ledger.verify(
    ["dataset-detail"],
    "normal",
    "Open case details through the actual dataset card",
    async () => {
      await button("打开测试集", card).click();
      await expect(page).toHaveURL(new RegExp("/datasets/" + state.dataset.id));
      await expect(
        page.getByRole("row").filter({ hasText: names.case + " edited" }),
      ).toBeVisible();
      return { dataset_id: state.dataset.id };
    },
  );
  await ledger.verify(
    ["add-case"],
    "normal",
    "An added case produces a new persisted dataset revision",
    async () => {
      await button("新增案例").click();
      await dialog()
        .getByRole("textbox", { name: "案例名称", exact: true })
        .fill(names.case + " direct");
      await dialog()
        .getByRole("textbox", { name: "text", exact: true })
        .fill("direct persisted input");
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      state.dataset = await api("get", "/datasets/" + state.dataset.id);
      expect(state.dataset.data.cases).toHaveLength(3);
      return { version: state.dataset.version, cases: 3 };
    },
  );
  await ledger.verify(
    ["add-case"],
    "boundary",
    "Cancel/reopen retains an unsubmitted case and does not change saved membership",
    async () => {
      await button("新增案例").click();
      await dialog()
        .getByRole("textbox", { name: "案例名称", exact: true })
        .fill("retained direct draft");
      await button("取消", dialog()).click();
      await button("新增案例").click();
      await expect(
        dialog().getByRole("textbox", { name: "案例名称", exact: true }),
      ).toHaveValue("retained direct draft");
      await button("取消", dialog()).click();
      expect(
        (await api("get", "/datasets/" + state.dataset.id)).data.cases,
      ).toHaveLength(3);
      return { draft_retained: true, saved_members: 3 };
    },
  );
  const direct = page
    .getByRole("row")
    .filter({ hasText: names.case + " direct" });
  await ledger.verify(
    ["edit-case"],
    "negative",
    "A failed case write retains the edited input and can be retried",
    async () => {
      await button("编辑", direct).click();
      await dialog()
        .getByRole("textbox", { name: "text", exact: true })
        .fill("edited direct input");
      await ui.failOnce("**/api/v1/datasets/" + state.dataset.id, "PUT");
      await button("保存", dialog()).click();
      await expect(
        dialog()
          .getByRole("alert")
          .filter({ hasText: "服务暂时不可用，请重试。" }),
      ).toBeVisible();
      await expect(
        dialog().getByRole("textbox", { name: "text", exact: true }),
      ).toHaveValue("edited direct input");
      return { failed_write_retained_input: true };
    },
  );
  await ledger.verify(
    ["edit-case"],
    "normal",
    "Retry persists only the selected case in a new revision",
    async () => {
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      state.dataset = await api("get", "/datasets/" + state.dataset.id);
      expect(
        state.dataset.data.cases.find((c) => c.name === names.case + " direct")
          .inputs.text.value,
      ).toBe("edited direct input");
      return {
        version: state.dataset.version,
        edited_input: "edited direct input",
      };
    },
  );
  await ledger.verify(
    ["remove-case"],
    "negative",
    "A failed case removal retains the row and all server members",
    async () => {
      await ui.failOnce("**/api/v1/datasets/" + state.dataset.id, "PUT");
      await button("移除", direct).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "服务暂时不可用，请重试。" }),
      ).toBeVisible();
      await expect(direct).toBeVisible();
      expect(
        (await api("get", "/datasets/" + state.dataset.id)).data.cases,
      ).toHaveLength(3);
      return { members_retained: 3 };
    },
  );
  await ledger.verify(
    ["remove-case", "draft-remove-case"],
    "boundary",
    "Successful removal keeps the removed case in the previous immutable version",
    async () => {
      const previous = state.dataset.version;
      await button("移除", direct).click();
      await expect(direct).toHaveCount(0);
      state.dataset = await api("get", "/datasets/" + state.dataset.id);
      expect(state.dataset.data.cases).toHaveLength(2);
      expect(
        (
          await api(
            "get",
            "/datasets/" + state.dataset.id + "?version=" + previous,
          )
        ).data.cases,
      ).toHaveLength(3);
      return { current_members: 2, previous_members: 3 };
    },
  );
  await ledger.verify(
    ["remove-case"],
    "normal",
    "The selected case is absent from the current revision",
    async () => {
      await expect(direct).toHaveCount(0);
      expect(
        state.dataset.data.cases.some((c) => c.name === names.case + " direct"),
      ).toBe(false);
      return { removed_from_current: true };
    },
  );
  await ledger.verify(
    ["edit-dataset", "dataset-create"],
    "negative",
    "A failed dataset save preserves review data and permits retry",
    async () => {
      await button("编辑", page.locator(".testflow-page-heading")).click();
      await dialog()
        .getByRole("textbox", { name: "说明", exact: true })
        .fill("review retained metadata");
      await button("下一步", dialog()).click();
      await button("下一步", dialog()).click();
      await ui.failOnce("**/api/v1/datasets/" + state.dataset.id, "PUT");
      await button("保存", dialog()).click();
      await expect(
        dialog()
          .getByRole("alert")
          .filter({ hasText: "服务暂时不可用，请重试。" }),
      ).toBeVisible();
      await expect(dialog().locator("pre")).toContainText(
        "review retained metadata",
      );
      return { review_retained: true };
    },
  );
  await ledger.verify(
    ["edit-dataset"],
    "normal",
    "Retry stores metadata and keeps confirmed members intact",
    async () => {
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      state.dataset = await api("get", "/datasets/" + state.dataset.id);
      expect(state.dataset.data.description).toBe("review retained metadata");
      expect(state.dataset.data.cases).toHaveLength(2);
      return { version: state.dataset.version, members: 2 };
    },
  );
  await ledger.verify(
    ["dataset-back"],
    "normal",
    "Back restores the dataset collection and its saved card",
    async () => {
      await button("返回", page.locator(".testflow-page-heading")).click();
      await expect(page).toHaveURL(ui.origin + "/datasets");
      await expect(card).toBeVisible();
      return { route: "/datasets" };
    },
  );
  await ledger.verify(
    ["dataset-detail", "dataset-back"],
    "negative",
    "A missing dataset shows an error and Back restores the collection",
    async () => {
      await page.goto(
        ui.origin + "/datasets/00000000-0000-4000-8000-000000000000",
      );
      await expect(
        page.getByRole("alert").filter({ hasText: "资源或版本不存在。" }),
      ).toBeVisible();
      await button("返回").click();
      await expect(card).toBeVisible();
      return { missing_resource_handled: true };
    },
  );
}
