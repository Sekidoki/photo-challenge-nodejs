import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { config } from "./config.js";

export type MaintainerRole = "owner" | "manager" | "maintainer";

export type MaintainerRecord = {
  userName: string;
  role: MaintainerRole;
  addedAt: string | null;
  addedBy: string | null;
};

type LegacyStoredMaintainer = Omit<MaintainerRecord, "role"> & {
  role: Exclude<MaintainerRole, "owner">;
};

type RegistryFile = {
  version: 2;
  updatedAt: string;
  updatedBy: string;
  maintainers: MaintainerRecord[];
};

type LegacyRegistryFile = {
  version: 1;
  updatedAt: string;
  updatedBy: string;
  maintainers: LegacyStoredMaintainer[];
};

let mutationQueue: Promise<void> = Promise.resolve();

export async function listMaintainers(): Promise<MaintainerRecord[]> {
  await mutationQueue;
  const registry = await readRegistry();
  return registry.maintainers.slice().sort(compareMaintainers);
}

export async function getMaintainerRole(userName: string): Promise<MaintainerRole | null> {
  await mutationQueue;
  const registry = await readRegistry();
  return getRoleFromRegistry(userName, registry);
}

export function canManageMaintainers(role: MaintainerRole | null): boolean {
  return role === "owner" || role === "manager";
}

export async function upsertMaintainer(
  actorUserName: string,
  targetUserName: string,
  requestedRole: Exclude<MaintainerRole, "owner">
): Promise<void> {
  return enqueueMutation(async () => {
    const registry = await readRegistry();
    const actorRole = getRoleFromRegistry(actorUserName, registry);
    assertCanManage(actorRole);

    const normalizedTarget = validateUserName(targetUserName);
    const targetKey = normalizeUserNameKey(normalizedTarget);
    const owner = getOwner(registry);
    if (targetKey === normalizeUserNameKey(owner.userName)) {
      throw new Error(`${owner.userName} is the protected owner and cannot be changed here.`);
    }

    const existingIndex = registry.maintainers.findIndex(
      (entry) => normalizeUserNameKey(entry.userName) === targetKey
    );
    const existing = existingIndex >= 0 ? registry.maintainers[existingIndex] : null;

    if (actorRole === "manager" && (requestedRole !== "maintainer" || existing?.role === "manager")) {
      throw new Error("Only the owner can grant, change, or revoke maintainer-list management access.");
    }

    const next: MaintainerRecord = {
      userName: normalizedTarget,
      role: requestedRole,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      addedBy: existing?.addedBy ?? actorUserName
    };
    if (existingIndex >= 0) registry.maintainers[existingIndex] = next;
    else registry.maintainers.push(next);

    await writeRegistry(registry.maintainers, actorUserName);
  });
}

export async function removeMaintainer(actorUserName: string, targetUserName: string): Promise<void> {
  return enqueueMutation(async () => {
    const registry = await readRegistry();
    const actorRole = getRoleFromRegistry(actorUserName, registry);
    assertCanManage(actorRole);

    const targetKey = normalizeUserNameKey(validateUserName(targetUserName));
    const owner = getOwner(registry);
    if (targetKey === normalizeUserNameKey(owner.userName)) {
      throw new Error(`${owner.userName} is the protected owner and cannot be removed here.`);
    }

    const existing = registry.maintainers.find(
      (entry) => normalizeUserNameKey(entry.userName) === targetKey
    );
    if (!existing) throw new Error("That Wikimedia user is not in the maintainer list.");
    if (actorRole === "manager" && existing.role === "manager") {
      throw new Error("Only the owner can remove a maintainer-list manager.");
    }

    await writeRegistry(
      registry.maintainers.filter((entry) => normalizeUserNameKey(entry.userName) !== targetKey),
      actorUserName
    );
  });
}

export function normalizeUserNameKey(userName: string): string {
  return userName.trim().replaceAll("_", " ").replace(/\s+/g, " ").toLocaleLowerCase();
}

async function readRegistry(): Promise<RegistryFile> {
  try {
    const raw = await readFile(config.accessControl.registryPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RegistryFile | LegacyRegistryFile>;
    if (!Array.isArray(parsed.maintainers)) {
      throw new Error("Maintainer registry has an unsupported format.");
    }
    if (parsed.version === 2) {
      return buildRegistry(
        parsed.maintainers.map(validateStoredMaintainer),
        parsed.updatedAt,
        parsed.updatedBy
      );
    }
    if (parsed.version === 1) {
      const bootstrap = await readBootstrapRegistry();
      const legacyMaintainers = parsed.maintainers.map(validateLegacyStoredMaintainer);
      return buildRegistry(
        [getOwner(bootstrap), ...legacyMaintainers],
        parsed.updatedAt,
        parsed.updatedBy
      );
    }
    throw new Error("Maintainer registry has an unsupported format.");
  } catch (error) {
    if (isMissingFile(error)) return readBootstrapRegistry();
    if (error instanceof SyntaxError) throw new Error("Maintainer registry is not valid JSON.");
    throw error;
  }
}

async function readBootstrapRegistry(): Promise<RegistryFile> {
  try {
    const raw = await readFile(config.accessControl.bootstrapPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RegistryFile>;
    if (parsed.version !== 2 || !Array.isArray(parsed.maintainers)) {
      throw new Error("Maintainer bootstrap has an unsupported format.");
    }
    return buildRegistry(parsed.maintainers.map(validateStoredMaintainer), "", "");
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Maintainer bootstrap is not valid JSON.");
    throw error;
  }
}

async function writeRegistry(maintainers: MaintainerRecord[], actorUserName: string): Promise<void> {
  const registry: RegistryFile = {
    version: 2,
    updatedAt: new Date().toISOString(),
    updatedBy: actorUserName,
    maintainers: maintainers.slice().sort(compareMaintainers)
  };
  await mkdir(path.dirname(config.accessControl.registryPath), { recursive: true });
  const serialized = `${JSON.stringify(registry, null, 2)}\n`;
  const temporaryPath = `${config.accessControl.registryPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, serialized, "utf8");
  try {
    await rename(temporaryPath, config.accessControl.registryPath);
  } catch (error) {
    if (!isWindowsReplaceError(error)) throw error;
    await writeFile(config.accessControl.registryPath, serialized, "utf8");
    await rm(temporaryPath, { force: true });
  }
}

function getRoleFromRegistry(userName: string, registry: RegistryFile): MaintainerRole | null {
  const key = normalizeUserNameKey(userName);
  if (!key) return null;
  return registry.maintainers.find((entry) => normalizeUserNameKey(entry.userName) === key)?.role ?? null;
}

function validateStoredMaintainer(value: unknown): MaintainerRecord {
  if (!value || typeof value !== "object") throw new Error("Maintainer registry contains an invalid entry.");
  const record = value as Record<string, unknown>;
  const userName = validateUserName(record.userName);
  if (record.role !== "owner" && record.role !== "manager" && record.role !== "maintainer") {
    throw new Error(`Maintainer registry has an invalid role for ${userName}.`);
  }
  return {
    userName,
    role: record.role,
    addedAt: typeof record.addedAt === "string" ? record.addedAt : null,
    addedBy: typeof record.addedBy === "string" ? record.addedBy : null
  };
}

function validateLegacyStoredMaintainer(value: unknown): LegacyStoredMaintainer {
  const record = validateStoredMaintainer(value);
  if (record.role === "owner") throw new Error("Legacy maintainer registry contains an invalid owner entry.");
  return record as LegacyStoredMaintainer;
}

function validateUserName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a Wikimedia user name.");
  const userName = value.trim().replaceAll("_", " ").replace(/\s+/g, " ");
  if (!userName || userName.length > 255 || /[\u0000-\u001f\u007f]/.test(userName)) {
    throw new Error("Enter a valid Wikimedia user name.");
  }
  return userName;
}

function assertCanManage(role: MaintainerRole | null): asserts role is "owner" | "manager" {
  if (!canManageMaintainers(role)) throw new Error("You are not allowed to manage the maintainer list.");
}

function assertNoDuplicateUsers(maintainers: MaintainerRecord[]): void {
  const keys = maintainers.map((entry) => normalizeUserNameKey(entry.userName));
  if (new Set(keys).size !== keys.length) throw new Error("Maintainer registry contains duplicate users.");
}

function getOwner(registry: RegistryFile): MaintainerRecord {
  const owners = registry.maintainers.filter((entry) => entry.role === "owner");
  if (owners.length !== 1) throw new Error("Maintainer registry must contain exactly one owner.");
  return owners[0] as MaintainerRecord;
}

function buildRegistry(
  maintainers: MaintainerRecord[],
  updatedAt: unknown,
  updatedBy: unknown
): RegistryFile {
  assertNoDuplicateUsers(maintainers);
  const registry: RegistryFile = {
    version: 2,
    updatedAt: typeof updatedAt === "string" ? updatedAt : "",
    updatedBy: typeof updatedBy === "string" ? updatedBy : "",
    maintainers
  };
  getOwner(registry);
  return registry;
}

function compareMaintainers(left: MaintainerRecord, right: MaintainerRecord): number {
  const rank = { owner: 0, manager: 1, maintainer: 2 } satisfies Record<MaintainerRole, number>;
  return rank[left.role] - rank[right.role] || left.userName.localeCompare(right.userName);
}

function enqueueMutation(operation: () => Promise<void>): Promise<void> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.catch(() => undefined);
  return result;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isWindowsReplaceError(error: unknown): boolean {
  return process.platform === "win32"
    && Boolean(error && typeof error === "object" && "code" in error && (error.code === "EEXIST" || error.code === "EPERM"));
}
