import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { config } from "../../src/infra/config.js";
import { createApp } from "../../src/web/app.js";
import { test } from "../support/harness.js";

test("Web responses compress text and apply safe cache policies", async () => {
  const previousMode = config.webAuthMode;
  config.webAuthMode = "local";
  const server = await listen(createApp().listen(0, "127.0.0.1"));
  try {
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;
    const page = await fetch(`${baseUrl}/`, { headers: { "Accept-Encoding": "gzip" } });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "private, no-store");
    assert.match(await page.text(), /class="skip-link" href="#main-content"/);

    const stylesheet = await fetch(`${baseUrl}/static/styles.css`, { headers: { "Accept-Encoding": "gzip" } });
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("cache-control") ?? "", /max-age=31536000/);
    assert.match(stylesheet.headers.get("cache-control") ?? "", /immutable/);
    assert.equal(stylesheet.headers.get("content-encoding"), "gzip");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    config.webAuthMode = previousMode;
  }
});

function listen(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}
