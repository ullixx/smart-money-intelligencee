import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { readFileSync } from "node:fs";

test("applies baseline security headers to static asset responses", async () => {
  const response = await worker.fetch(new Request("https://example.test/"), {
    ASSETS: { fetch: async () => new Response("<html><script></script></html>", { headers: { "Content-Type": "text/html", "Content-Encoding": "gzip" } }) }
  });
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.match(response.headers.get("Content-Security-Policy") || "", /default-src 'self'/);
  assert.match(response.headers.get("Content-Security-Policy") || "", /frame-ancestors 'none'/);
  assert.match(response.headers.get("Content-Security-Policy") || "", /script-src 'self' 'nonce-[a-f0-9]{36}'/);
  assert.match(await response.text(), /<script nonce="[a-f0-9]{36}">/);
  assert.doesNotMatch(response.headers.get("Content-Security-Policy") || "", /script-src[^;]*unsafe-inline/);
  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("applies security headers to API method errors", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health", { method: "POST" }), {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});


test("rate limits expensive API routes with weighted per-client requests", async () => {
  let call;
  const response = await worker.fetch(new Request("https://example.test/api/performance?address=invalid", {
    headers: { "CF-Connecting-IP": "203.0.113.8" }
  }), {
    API_RATE_LIMITER: { limit: async value => { call = value; return { success: false }; } }
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.deepEqual(call, { key: "203.0.113.8", delta: 5 });
  assert.equal((await response.json()).status, "RATE_LIMITED");
});

test("fails closed when the configured API rate limiter is unavailable", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health", {
    headers: { "CF-Connecting-IP": "203.0.113.9" }
  }), {
    API_RATE_LIMITER: { limit: async () => { throw new Error("binding unavailable"); } }
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).status, "UNAVAILABLE");
});

test("Wrangler config isolates preview rate-limit namespace from production",()=>{
 const config=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
 assert.match(config,/\[\[ratelimits\]\][\s\S]*?namespace_id = "91732026"/);
 assert.match(config,/\[\[previews\.ratelimits\]\][\s\S]*?namespace_id = "91732027"/);
 assert.match(config,/\[previews\.ratelimits\.simple\][\s\S]*?limit = 60[\s\S]*?period = 60/);
});
