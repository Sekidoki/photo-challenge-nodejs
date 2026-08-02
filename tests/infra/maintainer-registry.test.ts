import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { config } from "../../src/infra/config.js";
import {
  getMaintainerRole,
  listMaintainers,
  removeMaintainer,
  upsertMaintainer
} from "../../src/infra/maintainer-registry.js";
import { test } from "../support/harness.js";

async function withRegistry(run: (registryPath: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "photo-challenge-maintainers-"));
  const previousPath = config.accessControl.registryPath;
  config.accessControl.registryPath = path.join(directory, "maintainers.json");
  try {
    await run(config.accessControl.registryPath);
  } finally {
    config.accessControl.registryPath = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
}

test("maintainer registry defaults to the protected Sekidoki owner and fails closed", async () => {
  await withRegistry(async () => {
    assert.equal(await getMaintainerRole("Sekidoki"), "owner");
    assert.equal(await getMaintainerRole("Unknown user"), null);
    assert.deepEqual(await listMaintainers(), [{
      userName: "Sekidoki",
      role: "owner",
      addedAt: null,
      addedBy: null
    }]);
  });
});

test("owner delegates list management while managers remain below the owner", async () => {
  await withRegistry(async (registryPath) => {
    await upsertMaintainer("Sekidoki", "List_Manager", "manager");
    await upsertMaintainer("List Manager", "Regular Maintainer", "maintainer");

    assert.equal(await getMaintainerRole("list_manager"), "manager");
    assert.equal(await getMaintainerRole("REGULAR MAINTAINER"), "maintainer");
    await assert.rejects(
      () => upsertMaintainer("List Manager", "Second Manager", "manager"),
      /Only the owner/
    );
    await assert.rejects(
      () => removeMaintainer("List Manager", "List Manager"),
      /Only the owner/
    );
    await assert.rejects(
      () => removeMaintainer("Sekidoki", "Sekidoki"),
      /protected owner/
    );

    await removeMaintainer("Sekidoki", "Regular Maintainer");
    assert.equal(await getMaintainerRole("Regular Maintainer"), null);
    const persisted = JSON.parse(await readFile(registryPath, "utf8")) as {
      updatedBy: string;
      maintainers: Array<{ userName: string; role: string; addedAt: string; addedBy: string }>;
    };
    assert.equal(persisted.updatedBy, "Sekidoki");
    assert.equal(persisted.maintainers.length, 1);
    assert.equal(persisted.maintainers[0]?.userName, "List Manager");
    assert.equal(persisted.maintainers[0]?.role, "manager");
    assert.equal(persisted.maintainers[0]?.addedBy, "Sekidoki");
    assert(persisted.maintainers[0]?.addedAt);
  });
});

test("invalid maintainer registry data does not open access", async () => {
  await withRegistry(async (registryPath) => {
    await writeFile(registryPath, "{not-json", "utf8");
    await assert.rejects(() => getMaintainerRole("Someone"), /not valid JSON/);
  });
});
