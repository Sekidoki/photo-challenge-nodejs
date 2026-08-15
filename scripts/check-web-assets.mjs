import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const assets = [
  ["Codex light tokens", "node_modules/@wikimedia/codex-design-tokens/theme-wikimedia-ui.css", 14_000],
  ["Codex dark tokens", "node_modules/@wikimedia/codex-design-tokens/theme-wikimedia-ui-mode-dark.css", 14_000],
  ["Application CSS", "src/web/public/styles.css", 8_000],
  ["Dashboard JS", "src/web/public/dashboard.js", 3_000],
  ["Progress JS", "src/web/public/progress.js", 3_000],
  ["RUM JS", "src/web/public/rum.js", 1_500]
];

let failed = false;
console.log("asset\traw-bytes\tgzip-bytes\tbudget");
for (const [label, file, budget] of assets) {
  const content = await readFile(file);
  const gzipBytes = gzipSync(content).byteLength;
  console.log(`${label}\t${content.byteLength}\t${gzipBytes}\t${budget}`);
  if (gzipBytes > budget) failed = true;
}
if (failed) {
  console.error("A compressed Web asset exceeded its approved budget.");
  process.exitCode = 1;
}
