import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { config } from "./config.js";

const metricNames = new Set(["LCP", "INP", "CLS"]);
const ratings = new Set(["good", "needs-improvement", "poor"]);
const pageTypes = new Set(["home", "progress", "result", "publish-review", "maintenance-review", "maintainers", "other"]);

export async function recordWebVital(value: unknown): Promise<boolean> {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  if (!metricNames.has(String(input.name)) || !ratings.has(String(input.rating)) || !pageTypes.has(String(input.pageType))) return false;
  const metricValue = Number(input.value);
  if (!Number.isFinite(metricValue) || metricValue < 0) return false;
  const record = { recordedAt: new Date().toISOString(), name: String(input.name), value: metricValue, rating: String(input.rating), pageType: String(input.pageType), device: input.device === "mobile" ? "mobile" : "desktop" };
  const directory = path.join(path.dirname(config.outputRoot), "metrics");
  await mkdir(directory, { recursive: true });
  await appendFile(path.join(directory, "web-vitals.jsonl"), `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  return true;
}
