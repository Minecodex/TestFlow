import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";

export async function waitForPreview(request, origin) {
  await expect
    .poll(
      async () => {
        try {
          const response = await request.get(origin + "/api/v1/auth/session", {
            timeout: 2000,
          });
          return [200, 401].includes(response.status());
        } catch {
          return false;
        }
      },
      {
        timeout: 30000,
        message: "Wait for the owned port-forward after rollout",
      },
    )
    .toBe(true);
}

export async function testWorkspace() {
  const namespace = process.env.TESTFLOW_E2E_NAMESPACE;
  if (!namespace || !/^testflow-e2e-[a-z0-9-]+$/.test(namespace))
    throw Error("Provide an owned disposable TESTFLOW_E2E_NAMESPACE");
  const access = JSON.parse(
    await fs.readFile(
      path.resolve(".data/kubernetes", namespace, "access.json"),
      "utf8",
    ),
  );
  const acceptance = JSON.parse(
    await fs.readFile(
      path.resolve(".data/acceptance", namespace, "result.json"),
      "utf8",
    ),
  );
  return { namespace, access, acceptance };
}

// Preserve failed attempts and their immutable execution snapshots; avoid repeated-name selectors.
export async function retirePriorUiResources(request, origin) {
  for (const kind of [
    "repositories",
    "assets",
    "datasets",
    "pipelines",
    "evaluation-profiles",
    "tasks",
  ]) {
    const response = await request.get(
      `${origin}/api/v1/${kind}?page_size=100`,
    );
    if (!response.ok())
      throw Error(
        "Cannot read disposable fixture resources: " + response.status(),
      );
    const rows = (await response.json()).items;
    for (const resource of rows.filter((row) =>
      row.name.startsWith("TEST UI"),
    )) {
      if (kind !== "tasks") {
        const changed = await request.put(
          `${origin}/api/v1/${kind}/${resource.id}`,
          {
            data: {
              expected_version: resource.version,
              data: {
                ...resource.data,
                name: `Previous attempt ${resource.id.slice(0, 8)} · ${resource.name}`,
              },
            },
          },
        );
        if (!changed.ok())
          throw Error(
            "Cannot preserve a prior disposable fixture: " + changed.status(),
          );
      }
      const hidden = await request.post(
        `${origin}/api/v1/${kind}/${resource.id}/hide`,
      );
      if (!hidden.ok())
        throw Error(
          "Cannot hide a prior disposable fixture: " + hidden.status(),
        );
    }
  }
}
