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


test("discovery UI never renders unknown or partial risk as low risk",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(html,/t\.riskLevel==="PARTIAL"\?"TEILWEISE"/);
  assert.match(html,/:"UNBEKANNT"\)/);
  assert.match(html,/t\.riskLevel==="LOW"\?"NIEDRIG"/);
});


test("wallet UI labels raw SOL delta as a balance change, not swap proceeds",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(html,/SOL-Saldoänderung/);
  assert.doesNotMatch(html,/SOL netto/);
});
