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

test("FOMO UI exposes score data quality and component coverage",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(html,/t\.scoreStatus==="LIVE"\?"VOLLSTÄNDIG"/);
  assert.match(html,/t\.scoreStatus==="PARTIAL"\?"TEILWEISE"/);
  assert.match(html,/t\.scoreCoverage\.available/);
  assert.match(html,/t\.buys24h\?\?"—"/);
});

test("developer UI exposes mint history coverage limitations",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(html,/d\.historyWindowStatus==="REQUEST_LIMIT_REACHED"/);
  assert.match(html,/RPC lieferte weniger Signaturen als angefragt/);
  assert.match(html,/RPC lieferte keine Signaturen/);
});

test("frontend includes skip navigation and reduced-motion support",()=>{
 const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.match(html,/class="skip-link" href="#main-content"/);
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
});
test("frontend validates stored watchlist shape and catches storage write failures",()=>{
 const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.match(html,/Array\.isArray\(stored\)/);
 assert.match(html,/function safeStoreJson\(key,value\)/);
 assert.match(html,/catch\{return false;\}/);
});
test("frontend prevents duplicate form submissions while requests are running",()=>{
 const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.equal((html.match(/bindBusySubmit\("(?:walletForm|entryForm|developerForm)"/g)||[]).length,3);
 assert.match(html,/form\.dataset\.busy==="true"/);
});
