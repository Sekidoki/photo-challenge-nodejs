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

async function withRegistry(
  run: (registryPath: string) => Promise<void>,
  ownerUserName = "Sekidoki"
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "photo-challenge-maintainers-"));
  const previousPath = config.accessControl.registryPath;
  const previousBootstrapPath = config.accessControl.bootstrapPath;
  config.accessControl.registryPath = path.join(directory, "maintainers.json");
  config.accessControl.bootstrapPath = path.join(directory, "maintainers.bootstrap.json");
  await writeFile(config.accessControl.bootstrapPath, JSON.stringify({
    version: 2,
    updatedAt: "",
    updatedBy: "",
    maintainers: [{ userName: ownerUserName, role: "owner", addedAt: null, addedBy: null }]
  }), "utf8");
  try {
    await run(config.accessControl.registryPath);
  } finally {
    config.accessControl.registryPath = previousPath;
    config.accessControl.bootstrapPath = previousBootstrapPath;
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

test("maintainer registry reads the owner from the bootstrap list", async () => {
  await withRegistry(async () => {
    assert.equal(await getMaintainerRole("Configured Owner"), "owner");
    assert.equal(await getMaintainerRole("Sekidoki"), null);
  }, "Configured Owner");
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
    assert.equal(persisted.maintainers.length, 2);
    const manager = persisted.maintainers.find((entry) => entry.role === "manager");
    assert.equal(manager?.userName, "List Manager");
    assert.equal(manager?.addedBy, "Sekidoki");
    assert(manager?.addedAt);
  });
});

test("version 1 registries migrate to a version 2 list containing the owner", async () => {
  await withRegistry(async (registryPath) => {
    await writeFile(registryPath, JSON.stringify({
      version: 1,
      updatedAt: "2026-08-01T00:00:00.000Z",
      updatedBy: "Sekidoki",
      maintainers: [{
        userName: "Existing Maintainer",
        role: "maintainer",
        addedAt: "2026-08-01T00:00:00.000Z",
        addedBy: "Sekidoki"
      }]
    }), "utf8");

    assert.equal(await getMaintainerRole("Sekidoki"), "owner");
    assert.equal(await getMaintainerRole("Existing Maintainer"), "maintainer");
    await upsertMaintainer("Sekidoki", "New Maintainer", "maintainer");

    const persisted = JSON.parse(await readFile(registryPath, "utf8")) as {
      version: number;
      maintainers: Array<{ userName: string; role: string }>;
    };
    assert.equal(persisted.version, 2);
    assert.deepEqual(persisted.maintainers.map((entry) => entry.role).sort(), [
      "maintainer",
      "maintainer",
      "owner"
    ]);
  });
});

test("invalid maintainer registry data does not open access", async () => {
  await withRegistry(async (registryPath) => {
    await writeFile(registryPath, "{not-json", "utf8");
    await assert.rejects(() => getMaintainerRole("Someone"), /not valid JSON/);
  });
});
