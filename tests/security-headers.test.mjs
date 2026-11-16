import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("applies baseline security headers to static asset responses", async () => {
  const response = await worker.fetch(new Request("https://example.test/"), {
    ASSETS: { fetch: async () => new Response("ok", { headers: { "Content-Type": "text/html" } }) }
  });
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.match(response.headers.get("Content-Security-Policy") || "", /default-src 'self'/);
  assert.match(response.headers.get("Content-Security-Policy") || "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("Content-Security-Policy") || "", /script-src 'self' 'nonce-[a-f0-9]{36}'/);
  assert.match(await response.text(), /<script nonce="[a-f0-9]{36}">/);
  assert.doesNotMatch(response.headers.get("Content-Security-Policy") || "", /script-src[^;]*unsafe-inline/);
});

test("applies security headers to API method errors", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health", { method: "POST" }), {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});
