import fs from "node:fs/promises";
import { expect } from "@playwright/test";

export async function pipelinesControls(env) {
  const { ui, ledger, names, state } = env,
    { page, button: rawButton, dialog: allDialogs, api, resource } = ui;
  const dialog = () => allDialogs().last();
  const nodes = () => page.locator(".react-flow__node"),
    edges = () => page.locator(".react-flow__edge");
  const node = (id) => page.locator('.react-flow__node[data-id="' + id + '"]');
  const closeInspector = async () => {
    while (await page.locator(".testflow-node-drawer").count()) await dialog().press("Escape");
  };
  const inspectNode = async id => {
    await closeInspector(); await node(id).click(); await expect(page.locator(".testflow-node-drawer")).toBeVisible();
  };
  const button = (name, scope = page) => {
    const locator = rawButton(name, scope);
    const toolbar = ["适应画布", "放大", "缩小", "恢复上次保存", "校验流程", "流程列表", "导出流程", "快速运行", "添加节点"];
    return new Proxy(locator, {get(target, property) {
      if (property === "click" && scope === page && toolbar.includes(name)) return async options => { await closeInspector(); return target.click(options); };
      const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
    }});
  };
  const point = async (locator) => {
    const isPath=await locator.evaluate(element=>element instanceof SVGPathElement);
    if(isPath) {
      await expect.poll(()=>locator.evaluate(element=>element.getTotalLength())).toBeGreaterThan(0);
      // SVG geometry can have height zero. Use the actual stroke midpoint in screen coordinates.
      return locator.evaluate(element=>{
        const point=element.getPointAtLength(element.getTotalLength()/2);
        const matrix=element.getScreenCTM();
        const screen=new DOMPoint(point.x,point.y).matrixTransform(matrix);
        return [screen.x,screen.y];
      });
    }
    await expect(locator).toBeVisible();
    const r = await locator.boundingBox();
    expect(r).toBeTruthy();
    return [r.x + r.width / 2, r.y + r.height / 2];
  };
  const fit = async () => {
    await button("适应画布").click();
    await expect
      .poll(async () => {
        const canvas = await page.locator(".testflow-canvas").boundingBox();
        const boxes = await nodes().all();
        return (
          await Promise.all(boxes.map((item) => item.boundingBox()))
        ).every(
          (r) =>
            r &&
            r.x >= canvas.x - 1 &&
            r.y >= canvas.y - 1 &&
            r.x + r.width <= canvas.x + canvas.width + 1 &&
            r.y + r.height <= canvas.y + canvas.height + 1,
        );
      })
      .toBe(true);
  };
  const connect = async (source, target) => {
    await fit();
    const from = await point(
      node(source).locator(".react-flow__handle.source"),
    );
    const to = await point(node(target).locator(".react-flow__handle.target"));
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps: 16 });
    await page.mouse.up();
  };
  await page.goto(ui.origin + "/pipelines");
  await ledger.verify(
    ["new-flow"],
    "negative",
    "An unnamed flow cannot be created and cancel retains the list",
    async () => {
      await button("新建流程").click();
      await expect(button("创建", dialog())).toBeDisabled();
      await button("取消", dialog()).click();
      await expect(dialog()).toHaveCount(0);
      return { create_disabled: true };
    },
  );
  await ledger.verify(
    ["new-flow"],
    "negative",
    "A pending creation disables duplicate submission and closing; its failure retains the name",
    async () => {
      await button("新建流程").click();
      await dialog()
        .getByRole("textbox", { name: "名称", exact: true })
        .fill(names.pipeline);
      const request = await ui.holdOnce("**/api/v1/pipelines");
      try {
        await button("创建", dialog()).click();
        await request.started;
        await expect(button("创建", dialog())).toBeDisabled();
        await expect(button("取消", dialog())).toBeDisabled();
        await dialog().press("Escape");
        await expect(dialog()).toBeVisible();
        await page.screenshot({
          path: env.directory + "/pending-new-flow.png",
        });
      } finally {
        request.release();
      }
      await expect(dialog().getByRole("alert")).toBeVisible();
      await expect(
        dialog().getByRole("textbox", { name: "名称", exact: true }),
      ).toHaveValue(names.pipeline);
      return {
        duplicate_disabled: true,
        escape_blocked_while_pending: true,
        failed_draft_retained: true,
        pending_screenshot: "pending-new-flow.png",
      };
    },
  );
  await ledger.verify(
    ["new-flow"],
    "normal",
    "Create a real saved Start to End flow",
    async () => {
      await button("创建", dialog()).click();
      await expect(nodes()).toHaveCount(2);
      await expect(edges()).toHaveCount(1);
      state.pipeline = await resource("pipelines", names.pipeline);
      return { id: state.pipeline.id, nodes: 2, edges: 1 };
    },
  );
  await ledger.verify(
    ["flow-list", "open-flow"],
    "normal",
    "Return to the list and reopen the same saved canvas",
    async () => {
      await button("流程列表").click();
      const card = page
        .locator(".testflow-card")
        .filter({ hasText: names.pipeline });
      await button("打开画布", card).click();
      await expect(page).toHaveURL(
        new RegExp("/pipelines/" + state.pipeline.id),
      );
      await expect(nodes()).toHaveCount(2);
      return { pipeline_id: state.pipeline.id };
    },
  );
  const zoom = () =>
    page
      .locator(".react-flow__viewport")
      .evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).a);
  await ledger.verify(
    ["zoom-in"],
    "normal",
    "Zoom in changes the actual canvas transform",
    async () => {
      const before = await zoom();
      await button("放大").click();
      await expect.poll(zoom).toBeGreaterThan(before);
      return { before, after: await zoom() };
    },
  );
  await ledger.verify(
    ["zoom-out"],
    "normal",
    "Zoom out changes the actual canvas transform",
    async () => {
      const before = await zoom();
      await button("缩小").click();
      await expect.poll(zoom).toBeLessThan(before);
      return { before, after: await zoom() };
    },
  );
  await ledger.verify(
    ["zoom-in", "zoom-out"],
    "boundary",
    "Repeated zoom respects its configured minimum and maximum",
    async () => {
      for (let i = 0; i < 12; i++) await button("放大").click();
      const high = await zoom();
      expect(high).toBeCloseTo(1.65, 5);
      await button("放大").click();
      await expect.poll(zoom).toBe(high);
      for (let i = 0; i < 26; i++) await button("缩小").click();
      const low = await zoom();
      expect(low).toBeGreaterThanOrEqual(0.25);
      await button("缩小").click();
      await expect.poll(zoom).toBe(low);
      return { minimum: low, maximum: high };
    },
  );
  await ledger.verify(
    ["fit-canvas"],
    "normal",
    "Fit places all saved nodes inside the canvas viewport",
    async () => {
      await button("适应画布").click();
      await expect
        .poll(async () => {
          const canvas = await page.locator(".testflow-canvas").boundingBox(),
            boxes = await nodes().all();
          return (await Promise.all(boxes.map((n) => n.boundingBox()))).every(
            (r) =>
              r.x >= canvas.x - 1 &&
              r.y >= canvas.y - 1 &&
              r.x + r.width <= canvas.x + canvas.width + 1 &&
              r.y + r.height <= canvas.y + canvas.height + 1,
          );
        })
        .toBe(true);
      return { all_nodes_inside: true };
    },
  );
  await ledger.verify(
    ["remove-edge", "confirm-edge-delete"],
    "boundary",
    "Canceling edge deletion keeps the complete-group edge",
    async () => {
      const xy = await point(
        page.locator(".react-flow__edge-interaction").first(),
      );
      await page.mouse.click(...xy);
      await button("取消", dialog()).click();
      await expect(edges()).toHaveCount(1);
      return { edge_retained: true };
    },
  );
  await ledger.verify(
    ["remove-edge", "confirm-edge-delete"],
    "normal",
    "Confirmed edge deletion changes the draft and removes the edge",
    async () => {
      const xy = await point(
        page.locator(".react-flow__edge-interaction").first(),
      );
      await page.mouse.click(...xy);
      await button("删除", dialog()).click();
      await expect(edges()).toHaveCount(0);
      return { edges: 0, draft_changed: true };
    },
  );
  await ledger.verify(
    ["validate-flow"],
    "negative",
    "Validation rejects an End with no input and retains the editable draft",
    async () => {
      await button("校验流程").click();
      await expect(page.getByRole("alert")).toBeVisible();
      expect(
        (await api("get", "/pipelines/" + state.pipeline.id)).data.edges,
      ).toHaveLength(1);
      return { invalid_draft_not_saved: true };
    },
  );
  await ledger.verify(
    ["revert-flow"],
    "normal",
    "Revert restores the saved complete-group edge",
    async () => {
      await button("恢复上次保存").click();
      await expect(edges()).toHaveCount(1);
      return { saved_edge_restored: true };
    },
  );
  await ledger.verify(
    ["revert-flow"],
    "boundary",
    "A clean saved canvas cannot be reverted unnecessarily",
    async () => {
      await expect(button("恢复上次保存")).toBeDisabled();
      return { clean_revert_disabled: true };
    },
  );
  await ledger.verify(["flow-schema"], "normal", "Start edits its ordered input in the node drawer", async () => {
    await inspectNode("start");
    await expect(dialog().getByRole("textbox", {name:"字段名",exact:true})).toHaveCount(1);
    const checkbox=dialog().getByRole("checkbox").first(), square=dialog().locator('[data-slot="checkbox-control"]').first();
    await square.click(); await expect(checkbox).toBeChecked(); await square.click(); await expect(checkbox).not.toBeChecked();
    return {input_group:true,checkbox_mouse_toggle:true};
  });
  await ledger.verify(["flow-schema","save-flow-schema"], "negative", "Duplicate names block version save and explicit revert restores the original group", async () => {
    await button("新增字段",dialog()).click(); await dialog().getByRole("textbox",{name:"字段名",exact:true}).nth(1).fill("text");
    await expect(page.locator('[data-a="save-flow"]').first()).toBeDisabled(); await closeInspector(); await button("恢复上次保存").click();
    expect((await api("get","/pipelines/"+state.pipeline.id)).data.input_schema.fields).toHaveLength(1);
    return {duplicate_blocked:true,saved_schema_retained:true};
  });
  await ledger.verify(["save-flow-schema"], "normal", "Start and End have separate drawers with the shared ordered contract", async () => {
    await inspectNode("end"); await expect(dialog().getByRole("textbox",{name:"字段名",exact:true})).toHaveValue("text");
    await closeInspector(); await expect(node("start").locator(".testflow-chips")).toContainText("text");
    return {ordered_input:["text"],ordered_output:["text"]};
  });
  await ledger.verify(
    ["disconnect-node"],
    "normal",
    "Disconnect the selected End input without deleting its node",
    async () => {
      await inspectNode("end");
      await button("断开输入连线").click();
      await expect(edges()).toHaveCount(0);
      await expect(node("end")).toBeVisible();
      return { end_retained: true, edges: 0 };
    },
  );
  await ledger.verify(
    ["disconnect-node"],
    "boundary",
    "Disconnecting an already disconnected input is harmless",
    async () => {
      await button("断开输入连线").click();
      await expect(edges()).toHaveCount(0);
      await expect(nodes()).toHaveCount(2);
      return { nodes: 2, edges: 0 };
    },
  );
  await ledger.verify(
    ["add-node"],
    "normal",
    "Add a selected assembly node with a distinct identity",
    async () => {
      await button("添加节点").click();
      await button("字段组装", page.locator(".testflow-palette")).click();
      await expect(nodes()).toHaveCount(3);
      state.assembly = await nodes()
        .filter({ hasText: "字段组装" })
        .getAttribute("data-id");
      await inspectNode(state.assembly);
      await expect(page.locator(".testflow-node-settings")).toContainText("明确的来源字段映射");
      return { assembly: state.assembly };
    },
  );
  await ledger.verify(
    ["assembly-schema"],
    "normal",
    "Assembly output groups can be edited independently",
    async () => {
      await button("输出字段组", page.locator(".testflow-node-settings")).click();
      await expect(
        dialog().getByRole("textbox", { name: "字段名", exact: true }),
      ).toHaveCount(1);
      return { output_only: true };
    },
  );
  await ledger.verify(
    ["assembly-schema", "save-assembly-schema"],
    "negative",
    "An empty assembly group cannot save and a canceled edit retains its fields",
    async () => {
      await button("删除字段", dialog()).click();
      await expect(button("保存", dialog())).toBeDisabled();
      await button("取消", dialog()).click();
      await expect(
        node(state.assembly).locator(".testflow-chips"),
      ).toContainText("text");
      return { empty_output_blocked: true };
    },
  );
  await ledger.verify(
    ["save-assembly-schema"],
    "normal",
    "Save a valid assembly group and return to its mapping panel",
    async () => {
      await button("输出字段组", page.locator(".testflow-node-settings")).click();
      await button("保存", dialog()).click();
      await expect(dialog()).toHaveCount(1);
      await expect(page.locator(".testflow-node-settings")).toContainText(
        "明确的来源字段映射",
      );
      return { assembly_group_saved_to_draft: true };
    },
  );
  await button("适应画布").click();
  await ledger.verify(
    ["connect-out", "connect-in"],
    "normal",
    "Drag complete-group handles to establish an assembly chain and explicit field mapping",
    async () => {
      await connect("start", state.assembly);
      await expect(edges()).toHaveCount(1);
      await inspectNode(state.assembly);
      await ui.select(
        "text",
        "开始节点 → text",
        page.locator(".testflow-node-settings"),
      );
      await connect(state.assembly, "end");
      await expect(edges()).toHaveCount(2);
      return {
        edges: [
          ["start", state.assembly],
          [state.assembly, "end"],
        ],
        mapping: "text",
      };
    },
  );
  await ledger.verify(
    ["connect-out", "connect-in"],
    "negative",
    "Self, duplicate and a second ordinary-input source are rejected",
    async () => {
      await connect(state.assembly, state.assembly);
      await connect("start", state.assembly);
      await connect("start", "end");
      await expect(edges()).toHaveCount(2);
      return {
        rejected: ["self", "duplicate", "second_ordinary_input"],
        edges: 2,
      };
    },
  );
  await ledger.verify(
    ["validate-flow"],
    "normal",
    "The explicitly mapped assembly DAG passes real API validation",
    async () => {
      await button("校验流程").click();
      await expect(page.getByText("图校验通过", { exact: true })).toBeVisible();
      return { valid: true };
    },
  );
  await ledger.verify(
    ["save-flow"],
    "negative",
    "A failed save retains all unsaved nodes and edges for retry",
    async () => {
      await ui.failOnce("**/api/v1/pipelines/" + state.pipeline.id, "PUT");
      await button("保存", page.locator(".testflow-page-heading")).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "服务暂时不可用，请重试。" }),
      ).toBeVisible();
      await expect(nodes()).toHaveCount(3);
      await expect(edges()).toHaveCount(2);
      expect(
        (await api("get", "/pipelines/" + state.pipeline.id)).version,
      ).toBe(1);
      return { draft_nodes: 3, draft_edges: 2, saved_version: 1 };
    },
  );
  await ledger.verify(
    ["save-flow"],
    "normal",
    "Retry freezes a new version with the explicit assembly mapping",
    async () => {
      await button("保存", page.locator(".testflow-page-heading")).click();
      await expect(
        page.getByText("已保存版本 v2", { exact: true }),
      ).toBeVisible();
      state.pipeline = await api("get", "/pipelines/" + state.pipeline.id);
      expect(
        state.pipeline.data.nodes.find((n) => n.id === state.assembly).mappings,
      ).toEqual([{ target: "text", source: "start", field: "text" }]);
      return { version: 2, mapping_persisted: true };
    },
  );
  await ledger.verify(
    ["export-flow"],
    "normal",
    "Export contains the actual saved DAG and credential references only",
    async () => {
      const pending = page.waitForEvent("download");
      await button("导出流程").click();
      const data = JSON.parse(
        await fs.readFile(await (await pending).path(), "utf8"),
      );
      expect(data.format).toBe("testflow.workflow.v1");
      expect(data.pipeline.nodes).toHaveLength(3);
      expect(data.pipeline.edges).toHaveLength(2);
      expect(JSON.stringify(data)).not.toMatch(/\bsk-[\w-]{16,}/);
      return {
        format: data.format,
        nodes: data.pipeline.nodes.length,
        edges: data.pipeline.edges.length,
      };
    },
  );
  await ledger.verify(
    ["add-node", "remove-node"],
    "boundary",
    "Start is protected; an additional End can be removed with Delete",
    async () => {
      await inspectNode("start");
      await expect(button("删除节点")).toHaveCount(0);
      await closeInspector();
      await button("添加节点").click();
      await button("结束节点", page.locator(".testflow-palette")).click();
      await expect(nodes()).toHaveCount(4);
      await page.locator(".testflow-canvas").press("Delete");
      await expect(nodes()).toHaveCount(3);
      await expect(button("恢复上次保存")).toBeDisabled();
      return {
        start_protected: true,
        extra_end_deleted: true,
        net_draft_clean: true,
      };
    },
  );
  await ledger.verify(
    ["remove-node"],
    "normal",
    "Remove selected assembly and its connected edges without changing the old version",
    async () => {
      await inspectNode(state.assembly);
      await button("删除节点").click();
      await expect(nodes()).toHaveCount(2);
      await expect(edges()).toHaveCount(0);
      expect(
        (await api("get", "/pipelines/" + state.pipeline.id)).data.nodes,
      ).toHaveLength(3);
      await button("恢复上次保存").click();
      return { draft_nodes: 2, saved_nodes: 3 };
    },
  );
  await ledger.verify(
    ["node-timeout"],
    "negative",
    "Zero node timeout stays visible and is rejected by the real graph validator",
    async () => {
      await inspectNode(state.assembly);
      const timeout = page.getByLabel("节点运行超时（秒）", { exact: true });
      await timeout.fill("0");
      await expect(timeout).toHaveValue("0");
      await button("校验流程").click();
      await expect(page.getByRole("alert")).toBeVisible();
      await inspectNode(state.assembly);
      await expect(page.getByLabel("节点运行超时（秒）",{exact:true})).toHaveValue("0");
      await page.getByLabel("节点运行超时（秒）", {exact:true}).fill("30");
      return { zero_retained: true, invalid_timeout_rejected: true };
    },
  );
  await ledger.verify(
    ["export-flow", "flow-list"],
    "boundary",
    "A dirty canvas guards departure, exports its draft and can restore it after return",
    async () => {
      await inspectNode(state.assembly);
      await page
        .getByLabel("节点名称", { exact: true })
        .fill("retained canvas draft");
      await button("流程列表").click();
      await expect(dialog()).toContainText("未保存");
      await button("继续编辑", dialog()).click();
      const pending = page.waitForEvent("download");
      await button("导出流程").click();
      const data = JSON.parse(
        await fs.readFile(await (await pending).path(), "utf8"),
      );
      expect(data.pipeline.nodes.some((n) => n.name === "retained canvas draft")).toBe(
        true,
      );
      await button("流程列表").click();
      await button("保留草稿并离开", dialog()).click();
      await button(
        "打开画布",
        page.locator(".testflow-card").filter({ hasText: names.pipeline }),
      ).click();
      await expect(
        nodes().filter({ hasText: "retained canvas draft" }),
      ).toHaveCount(1);
      await button("恢复上次保存").click();
      return {
        departure_guarded: true,
        draft_exported: true,
        draft_restored: true,
      };
    },
  );
  await ledger.verify(
    ["fit-canvas"],
    "boundary",
    "Fit also works after node deletion and draft recovery",
    async () => {
      await button("适应画布").click();
      await expect(nodes()).toHaveCount(3);
      await expect(node("start")).toBeVisible();
      return { fit_recovered_graph: true };
    },
  );
  await ledger.verify(
    ["quick-run"],
    "negative",
    "Quick run requires a profile; an invalid reference and HTTP error preserve input",
    async () => {
      await button("快速运行").click();
      await expect(button("快速运行", dialog())).toBeDisabled();
      await ui.select("评测配置", names.profile);
      await dialog()
        .getByRole("textbox", { name: "text", exact: true })
        .fill("coverage quick input");
      await dialog()
        .getByRole("textbox", { name: "独立参考", exact: true })
        .fill("{bad");
      await expect(button("快速运行", dialog())).toBeDisabled();
      await dialog()
        .getByRole("textbox", { name: "独立参考", exact: true })
        .fill("{}");
      await ui.failOnce("**/api/v1/executions/quick", "POST");
      await button("快速运行", dialog()).click();
      await expect(
        dialog()
          .getByRole("alert")
          .filter({ hasText: "服务暂时不可用，请重试。" }),
      ).toBeVisible();
      await expect(
        dialog().getByRole("textbox", { name: "text", exact: true }),
      ).toHaveValue("coverage quick input");
      return {
        missing_profile_blocked: true,
        invalid_reference_blocked: true,
        input_retained: true,
      };
    },
  );
  await ledger.verify(
    ["quick-run"],
    "normal",
    "Retry actually executes the saved assembly DAG and returns to its canvas",
    async () => {
      await button("快速运行", dialog()).click();
      await expect(button("重跑")).toBeVisible({ timeout: 45000 });
      state.quick = await api(
        "get",
        "/executions/" + new URL(page.url()).pathname.split("/").at(-1),
      );
      expect(state.quick.state).toBe("succeeded");
      expect(state.quick.output.text).toBe("coverage quick input");
      await button("返回").click();
      await expect(page).toHaveURL(
        new RegExp("/pipelines/" + state.pipeline.id),
      );
      return {
        execution_id: state.quick.id,
        state: state.quick.state,
        output: state.quick.output.text,
      };
    },
  );
  await ledger.verify(
    ["canvas-shortcut"],
    "normal",
    "Ctrl S from a configuration input saves the real draft as a new version",
    async () => {
      await inspectNode(state.assembly);
      const input = page.getByLabel("节点名称", { exact: true });
      await input.fill("Shortcut verified assembly");
      await expect(node(state.assembly)).toContainText(
        "Shortcut verified assembly",
      );
      await input.press("Control+s");
      await expect(
        page.getByText("已保存版本 v3", { exact: true }),
      ).toBeVisible();
      state.pipeline = await api("get", "/pipelines/" + state.pipeline.id);
      expect(
        state.pipeline.data.nodes.find((n) => n.id === state.assembly).name,
      ).toBe("Shortcut verified assembly");
      return { version: 3, input_shortcut_saved: true };
    },
  );
  await ledger.verify(
    ["canvas-shortcut"],
    "negative",
    "A shortcut save failure keeps the typed node configuration until explicit revert",
    async () => {
      const input = page.getByLabel("节点名称", { exact: true });
      await input.fill("Retained shortcut failure");
      await ui.failOnce("**/api/v1/pipelines/" + state.pipeline.id, "PUT");
      await input.press("Control+s");
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(input).toHaveValue("Retained shortcut failure");
      expect(
        (await api("get", "/pipelines/" + state.pipeline.id)).version,
      ).toBe(3);
      await button("恢复上次保存").click();
      return { failed_draft_retained: true, saved_version: 3 };
    },
  );
  await ledger.verify(
    ["open-flow"],
    "negative",
    "A missing flow shows a recoverable error and returns to the collection",
    async () => {
      await page.goto(
        ui.origin + "/pipelines/00000000-0000-4000-8000-000000000000",
      );
      await expect(
        page.getByRole("alert").filter({ hasText: "资源或版本不存在。" }),
      ).toBeVisible();
      await button("返回").click();
      await expect(
        page.locator(".testflow-card").filter({ hasText: names.pipeline }),
      ).toBeVisible();
      return { missing_handled: true };
    },
  );
}
