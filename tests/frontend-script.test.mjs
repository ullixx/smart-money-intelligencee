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


test("frontend FIFO aggregation uses exact raw token units across pages",()=>{
 const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.match(html,/const exactMode=rawMeta\.every\(Boolean\)&&rawMeta\.every\(x=>x\.decimals===rawMeta\[0\]\.decimals\)/);
 assert.match(html,/remainingRaw>0n/);
 assert.match(html,/matchedRawAmount:exactMode\?matchedRaw\.toString\(\):null/);
 assert.match(html,/quantityPrecision:exactMode\?"RAW_BIGINT":"NUMBER_FALLBACK"/);
});

test("frontend displays network fee coverage and does not invent a slippage estimate",()=>{
 const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.match(html,/Wallet-bezahlte Netzwerkgebühren/);
 assert.match(html,/USD-Bewertung noch nicht enthalten/);
 assert.match(html,/Slippage-Bewertung/);
 assert.match(html,/Keine historische Pre-Trade-DEX-Quote vorhanden/);
});


test("dashboard visual system keeps responsive layouts and accessible focus states",()=>{
 const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.match(html,/--surface-raised:#152238/);
 assert.match(html,/max-width:1480px/);
 assert.match(html,/@media\(max-width:760px\)/);
 assert.match(html,/\.navtab\.active/);
 assert.match(html,/button:focus-visible/);
 assert.match(html,/prefers-reduced-motion:reduce/);
});


test("Cloudflare deployment pins Wrangler v4 for rate-limit binding support",()=>{
 const workflow=readFileSync(new URL("../.github/workflows/deploy-cloudflare.yml",import.meta.url),"utf8");
 assert.match(workflow,/uses: cloudflare\/wrangler-action@v4/);
 assert.match(workflow,/wranglerVersion: ["']4\./);
});


test("intelligence command center uses tactical olive palette and terminal styling",()=>{
 const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.match(html,/--bg:#090d0a/);
 assert.match(html,/--green:#a8c66c/);
 assert.match(html,/Liberation Mono/);
 assert.match(html,/linear-gradient\(rgba\(142,160,111/);
 assert.match(html,/\.navtab\.active/);
 assert.match(html,/@media\(max-width:760px\)/);
 assert.match(html,/prefers-reduced-motion:reduce/);
});


test("tactical command center includes subtle motion and reduced-motion safeguards",()=>{
 const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.match(html,/@keyframes smi-scanline/);
 assert.match(html,/@keyframes smi-status-pulse/);
 assert.match(html,/@keyframes smi-panel-sweep/);
 assert.match(html,/header \.status\{animation:smi-status-pulse/);
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(html,/body:before[\s\S]*animation:smi-scanline/);
});

test("desktop command center uses persistent tactical rail and preserves mobile navigation",()=>{
 const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.match(html,/grid-template-columns:228px minmax\(0,1fr\)/);
 assert.match(html,/"OPERATIONS \/ MODULES"/);
 assert.match(html,/main#main-content>\.mainnav\{grid-column:1/);
 assert.match(html,/main#main-content>section\[data-view\]\{grid-column:2/);
 assert.match(html,/@media\(max-width:760px\)[\s\S]*main#main-content\{display:block\}/);
 assert.match(html,/main#main-content>\.mainnav:before\{display:none\}/);
 assert.match(html,/prefers-reduced-motion:reduce/);
});

test("mobile command deck has distinct tactical metrics and four-column sticky navigation",()=>{
 const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.match(html,/@media\(max-width:760px\)[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(html,/main#main-content>\.mainnav\{position:sticky;top:54px/);
 assert.match(html,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(html,/text-transform:uppercase/);
 assert.match(html,/prefers-reduced-motion:reduce/);
});

test("command center is a real overview powered by discovery and stored wallet data",()=>{
 const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.match(html,/data-target="overview">Command/);
 assert.match(html,/id="view-overview" data-view="overview"/);
 assert.match(html,/id="commandRadar"/);
 assert.match(html,/id="commandSignals"/);
 assert.match(html,/id="commandWalletList"/);
 assert.match(html,/function renderCommandCenter\(\)/);
 assert.match(html,/renderCommandCenter\(\);/);
 assert.match(html,/kein Wallet-Flow-Nachweis/);
 assert.match(html,/NOT CLASSIFIED/);
});
