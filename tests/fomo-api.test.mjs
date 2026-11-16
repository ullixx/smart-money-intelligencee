import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/fomo.js";

const TOKEN = "Token11111111111111111111111111111111111";
const OTHER = "Other11111111111111111111111111111111111";
const response = value => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "Content-Type": "application/json" }
});

async function withFixture(pairs, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const value = String(url);
    if (value.includes("/token-profiles/latest")) return response([{ chainId: "solana", tokenAddress: TOKEN }]);
    if (value.includes("/token-boosts/latest")) return response([]);
    if (value.includes("/tokens/v1/solana/")) return response(pairs);
    throw new Error("Unexpected URL: " + value);
  };
  try { await run(); } finally { globalThis.fetch = originalFetch; }
}

test("FOMO does not turn missing market inputs into a zero score", async () => {
  await withFixture([{
    baseToken: { address: TOKEN, name: "Example", symbol: "EX" },
    quoteToken: { address: OTHER, name: "Quote", symbol: "Q" },
    pairAddress: "Pool111111111111111111111111111111111111",
    liquidity: {},
    volume: {},
    txns: {}
  }], async () => {
    const response = await onRequestGet();
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.tokens[0].score, null);
    assert.equal(data.tokens[0].scoreStatus, "UNAVAILABLE");
    assert.deepEqual(data.tokens[0].scoreCoverage, { available: 0, total: 4 });
  });
});

test("FOMO maps quote-side token activity without borrowing base-token price", async () => {
  await withFixture([{
    baseToken: { address: OTHER, name: "Base", symbol: "BASE" },
    quoteToken: { address: TOKEN, name: "Quote Token", symbol: "QUOTE" },
    pairAddress: "Pool111111111111111111111111111111111111",
    priceUsd: "15",
    liquidity: { usd: 60000 },
    volume: { h24: 30000 },
    txns: { h24: { buys: 40, sells: 60 } },
    url: "https://dexscreener.com/solana/example"
  }], async () => {
    const response = await onRequestGet();
    const data = await response.json();
    const token = data.tokens[0];
    assert.equal(token.pairTokenSide, "quote");
    assert.equal(token.name, "Quote Token");
    assert.equal(token.priceUsd, null);
    assert.equal(token.buys24h, 60);
    assert.equal(token.sells24h, 40);
    assert.equal(token.scoreStatus, "LIVE");
    assert.equal(token.scoreCoverage.available, 4);
    assert.ok(Number.isFinite(token.score));
  });
});
