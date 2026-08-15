import { readFile } from "node:fs/promises";
import path from "node:path";

const persistentRoot = process.env.PHOTO_CHALLENGE_DATA_ROOT?.trim()
  || (process.env.TOOL_DATA_DIR?.trim() ? path.join(process.env.TOOL_DATA_DIR.trim(), "photo-challenge-nodejs") : process.cwd());
const metricsPath = path.join(persistentRoot, "output", "metrics", "web-vitals.jsonl");
const cutoff = Date.now() - 28 * 24 * 60 * 60 * 1000;
let content = "";
try { content = await readFile(metricsPath, "utf8"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
const rows = content.split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }).filter((row) => Date.parse(row.recordedAt) >= cutoff);
const groups = new Map();
for (const row of rows) {
  const key = `${row.pageType}\t${row.device}\t${row.name}`;
  const values = groups.get(key) || []; values.push(row.value); groups.set(key, values);
}
const expectedPages = ["home", "progress", "result", "publish-review", "maintenance-review", "maintainers"];
console.log("page\tdevice\tmetric\tsamples\tp75\tstatus");
for (const page of expectedPages) for (const device of ["mobile", "desktop"]) for (const metric of ["LCP", "INP", "CLS"]) {
  const values = (groups.get(`${page}\t${device}\t${metric}`) || []).sort((a, b) => a - b);
  const p75 = values.length ? values[Math.ceil(values.length * 0.75) - 1] : null;
  const threshold = metric === "CLS" ? 0.1 : metric === "INP" ? 200 : 2500;
  const status = values.length < 75 ? "insufficient-data" : p75 <= threshold ? "good" : "needs-attention";
  console.log(`${page}\t${device}\t${metric}\t${values.length}\t${p75 ?? "-"}\t${status}`);
}
