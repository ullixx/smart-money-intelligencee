import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";

test("public inline JavaScript parses without syntax errors", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const start = html.indexOf("<script>");
  const end = html.lastIndexOf("</script>");
  assert.ok(start >= 0 && end > start, "expected an inline script block");
  const source = html.slice(start + 8, end);
  assert.doesNotThrow(() => new Script(source));
});
