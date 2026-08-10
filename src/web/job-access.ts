import { normalizeUserNameKey } from "../infra/maintainer-registry.js";

export function isJobOwnedBy(loginName: string, userName: string): boolean {
  return Boolean(loginName)
    && normalizeUserNameKey(loginName) === normalizeUserNameKey(userName);
}
