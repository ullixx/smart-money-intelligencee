import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

test("public inline JavaScript parses without syntax errors", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length > 0, "expected at least one inline script");
  for (const source of scripts) assert.doesNotThrow(() => new Script(source));
});
