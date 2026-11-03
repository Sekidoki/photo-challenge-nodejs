import { randomUUID } from "node:crypto";

export type FlashLink = { title: string; url: string };
export type FlashNotice = { message: string; tone: "success" | "error"; links: FlashLink[] };

const FLASH_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;
const notices = new Map<string, { notice: FlashNotice; expiresAt: number }>();

/**
 * Store a server-composed notice and return an opaque id for the redirect URL.
 * Notices are only ever created by the server, so a crafted `?notice=` link
 * cannot display arbitrary text. Entries stay readable until they expire so a
 * page refresh keeps showing the same notice.
 */
export function createFlash(message: string, options: Partial<Omit<FlashNotice, "message">> = {}): string {
  pruneExpired();
  if (notices.size >= MAX_ENTRIES) {
    const oldest = notices.keys().next().value;
    if (oldest) notices.delete(oldest);
  }
  const id = randomUUID();
  notices.set(id, {
    notice: { message, tone: options.tone ?? "success", links: options.links ?? [] },
    expiresAt: Date.now() + FLASH_TTL_MS
  });
  return id;
}

export function readFlash(value: unknown): FlashNotice | null {
  const id = Array.isArray(value) ? value[0] : value;
  if (typeof id !== "string") return null;
  const entry = notices.get(id);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.notice;
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, entry] of notices) {
    if (entry.expiresAt < now) notices.delete(id);
  }
}
