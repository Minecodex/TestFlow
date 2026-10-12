import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

export class ControlLedger {
  constructor(directory, namespace, page) {
    this.directory = directory;
    this.namespace = namespace;
    this.page = page;
    this.cases = [];
  }
  async verify(controls, scenario, expected, run) {
    const id =
      String(this.cases.length + 1).padStart(3, "0") +
      "-" +
      scenario +
      "-" +
      controls[0];
    const row = { id, controls, scenario, expected, passed: false };
    console.info("Control case: " + id);
    this.cases.push(row);
    await test.step(id + ": " + expected, async () => {
      try {
        row.actual = await run();
        expect(
          row.actual,
          "Record an observed result alongside executable assertions",
        ).toBeTruthy();
        if (this.page) {
          row.screenshot = id + ".png";
          await this.page.screenshot({
            path: path.join(this.directory, row.screenshot),
            fullPage: true,
          });
          await fs.chmod(path.join(this.directory, row.screenshot), 0o600);
        }
        row.passed = true;
      } finally {
        await this.save();
      }
    });
  }
  async save() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      path.join(this.directory, "control-cases.json"),
      JSON.stringify(
        { namespace: this.namespace, cases: this.cases },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  }
  async report() {
    const manifest = JSON.parse(
      await fs.readFile("tests/action-manifest.json", "utf8"),
    );
    const controls = manifest.map((item) => {
      const cases = this.cases.filter(
        (row) => row.controls.includes(item.id) && row.passed,
      );
      const excluded = [
        "unverified_microphone_per_user",
        "excluded_desktop_scope",
      ].includes(item.status);
      const normal = cases.filter((row) => row.scenario === "normal");
      const alternate = cases.filter((row) =>
        ["negative", "boundary"].includes(row.scenario),
      );
      return {
        id: item.id,
        excluded,
        scope: item.status,
        normal: normal.map((row) => row.id),
        alternate: alternate.map((row) => row.id),
        passed: !excluded && normal.length > 0 && alternate.length > 0,
      };
    });
    const missing = controls
      .filter((item) => !item.excluded && !item.passed)
      .map((item) => item.id);
    const report = {
      namespace: this.namespace,
      total: controls.length,
      verified: controls.filter((item) => item.passed).length,
      deferred: controls.filter(
        (item) => item.scope === "unverified_microphone_per_user",
      ).length,
      excluded: controls.filter(
        (item) => item.scope === "excluded_desktop_scope",
      ).length,
      missing,
      passed: missing.length === 0,
      controls,
    };
    await fs.writeFile(
      path.join(this.directory, "control-coverage.json"),
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
    return report;
  }
}

export function controlsUI(page, origin) {
  const button = (name, scope = page) =>
    scope.getByRole("button", { name, exact: true });
  const dialog = (name) =>
    page.getByRole("dialog", name ? { name, exact: true } : {}).last();
  const api = async (method, route, data) => {
    const options = {
      ...(data === undefined ? {} : { data }),
      ...(method === "get"
        ? {}
        : { headers: { "Idempotency-Key": crypto.randomUUID() } }),
    };
    const response = await page.request[method](
      origin + "/api/v1" + route,
      options,
    );
    expect(
      response.ok(),
      method.toUpperCase() + " " + route + ": " + response.status(),
    ).toBe(true);
    return response.json();
  };
  const resource = async (kind, name) => {
    const rows = (
      await api(
        "get",
        "/" + kind + "?page_size=100&search=" + encodeURIComponent(name),
      )
    ).items;
    const found = rows.find((row) => row.name === name);
    expect(found, "A real persisted resource must exist").toBeTruthy();
    return found;
  };
  const select = async (label, name, scope = dialog()) => {
    await scope
      .getByRole("button", {
        name: new RegExp(" " + label + " " + label + "$"),
      })
      .click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  const upload = async (scope, files) => {
    const waiting = page.waitForEvent("filechooser");
    await scope.locator('input[type="file"]').click();
    const chooser = await waiting;
    await chooser.setFiles(files);
  };
  const setChecked = async (locator, value) => {
    if ((await locator.isChecked()) !== value) await locator.press("Space");
    await expect(locator).toBeChecked({ checked: value });
  };
  const failOnce = async (route, method = "GET") => {
    let matched = false;
    const handler = async (interception) => {
      if (interception.request().method() !== method || matched)
        return interception.continue();
      matched = true;
      await interception.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "database_unavailable",
          message: "Injected disposable UI failure",
          fields: {},
          request_id: "coverage-failure",
        }),
      });
      await page.unroute(route, handler);
    };
    await page.route(route, handler);
    return () => matched;
  };
  const failReads = async (pattern) => {
    let count = 0;
    const handler = async (interception) => {
      if (interception.request().method() !== "GET")
        return interception.continue();
      count++;
      await interception.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "database_unavailable",
          message: "Injected disposable UI failure",
          fields: {},
          request_id: "coverage-failure",
        }),
      });
    };
    await page.route(pattern, handler);
    return {
      count: () => count,
      restore: () => page.unroute(pattern, handler),
    };
  };
  const holdOnce = async (pattern, method = "POST") => {
    let entered,
      release,
      matched = false;
    const started = new Promise((resolve) => {
        entered = resolve;
      }),
      released = new Promise((resolve) => {
        release = resolve;
      });
    const handler = async (interception) => {
      if (interception.request().method() !== method || matched)
        return interception.continue();
      matched = true;
      entered();
      await released;
      await interception.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "database_unavailable",
          message: "Disposable pending-state failure",
          request_id: "coverage-pending",
        }),
      });
      await page.unroute(pattern, handler);
    };
    await page.route(pattern, handler);
    return { started, release };
  };
  return {
    page,
    origin,
    button,
    dialog,
    api,
    resource,
    select,
    upload,
    setChecked,
    failOnce,
    failReads,
    holdOnce,
  };
}
