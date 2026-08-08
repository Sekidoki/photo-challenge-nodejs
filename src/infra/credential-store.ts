import { config } from "./config.js";

type KeytarApi = typeof import("keytar");

type CredentialRecord = {
  name: string;
  botPassword: string;
};

type CredentialBackend = "system" | "memory";

type CredentialStoreStatus = {
  backend: CredentialBackend;
  backendLabel: string;
  canPersistAcrossRestarts: boolean;
};

const lastUsedAccount = "__last_used_name__";
const memoryCredentials = new Map<string, string>();
let backend: CredentialBackend = "system";
let keytarPromise: Promise<KeytarApi> | null = null;

function loadKeytar(): Promise<KeytarApi> {
  keytarPromise ??= import("keytar");
  return keytarPromise;
}

async function useKeytar<T>(operation: (keytar: KeytarApi) => Promise<T>): Promise<T> {
  if (backend === "memory") {
    throw new Error("System keychain unavailable");
  }

  try {
    return await operation(await loadKeytar());
  } catch {
    backend = "memory";
    throw new Error("System keychain unavailable");
  }
}

function getMemoryValue(account: string): string | null {
  return memoryCredentials.get(account) ?? null;
}

function setMemoryValue(account: string, value: string) {
  memoryCredentials.set(account, value);
}

function deleteMemoryValue(account: string) {
  memoryCredentials.delete(account);
}

export async function getSavedCredential(): Promise<CredentialRecord | null> {
  const name = await getSavedName();
  if (!name) {
    return null;
  }

  const botPassword = await getCredentialPassword(name);
  if (!botPassword) {
    return null;
  }

  return { name, botPassword };
}

export async function getSavedName(): Promise<string | null> {
  if (backend === "memory") {
    return getMemoryValue(lastUsedAccount);
  }

  try {
    return await useKeytar((keytar) => keytar.getPassword(config.credentialServiceName, lastUsedAccount));
  } catch {
    return getMemoryValue(lastUsedAccount);
  }
}

export async function getCredentialPassword(name: string): Promise<string | null> {
  if (!name) {
    return null;
  }

  if (backend === "memory") {
    return getMemoryValue(name);
  }

  try {
    return await useKeytar((keytar) => keytar.getPassword(config.credentialServiceName, name));
  } catch {
    return getMemoryValue(name);
  }
}

export async function rememberCredential(name: string, botPassword: string): Promise<void> {
  if (!name || !botPassword) {
    return;
  }

  if (backend === "memory") {
    setMemoryValue(name, botPassword);
    setMemoryValue(lastUsedAccount, name);
    return;
  }

  try {
    await useKeytar((keytar) => keytar.setPassword(config.credentialServiceName, name, botPassword));
    await useKeytar((keytar) => keytar.setPassword(config.credentialServiceName, lastUsedAccount, name));
  } catch {
    setMemoryValue(name, botPassword);
    setMemoryValue(lastUsedAccount, name);
  }
}

export async function clearSavedCredential(name?: string): Promise<void> {
  const targetName = name || (await getSavedName());
  if (!targetName) {
    return;
  }

  if (backend === "memory") {
    deleteMemoryValue(targetName);
    if (getMemoryValue(lastUsedAccount) === targetName) {
      deleteMemoryValue(lastUsedAccount);
    }
    return;
  }

  try {
    await useKeytar((keytar) => keytar.deletePassword(config.credentialServiceName, targetName));
    const savedName = await useKeytar((keytar) =>
      keytar.getPassword(config.credentialServiceName, lastUsedAccount)
    );
    if (savedName === targetName) {
      await useKeytar((keytar) => keytar.deletePassword(config.credentialServiceName, lastUsedAccount));
    }
  } catch {
    deleteMemoryValue(targetName);
    if (getMemoryValue(lastUsedAccount) === targetName) {
      deleteMemoryValue(lastUsedAccount);
    }
  }
}

export function getCredentialStoreStatus(): CredentialStoreStatus {
  return backend === "system"
    ? {
        backend,
        backendLabel: "System keychain",
        canPersistAcrossRestarts: true
      }
    : {
        backend,
        backendLabel: "In-memory session",
        canPersistAcrossRestarts: false
      };
}
