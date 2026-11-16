import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/discovery.js";

const TOKEN = "Token11111111111111111111111111111111111";
const OTHER = "Other11111111111111111111111111111111111";
const response = value => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "Content-Type": "application/json" }
});

async function withDexFixture({ profiles = [{ chainId: "solana", tokenAddress: TOKEN }], boosts = [], pairs = [] }, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const value = String(url);
    if (value.includes("/token-profiles/latest")) return response(profiles);
    if (value.includes("/token-boosts/latest")) return response(boosts);
    if (value.includes("/tokens/v1/solana/")) return response(pairs);
    throw new Error("Unexpected URL: " + value);
  };
  try { await run(); } finally { globalThis.fetch = originalFetch; }
}

test("missing pool risk inputs are UNKNOWN, never falsely LOW", async () => {
  await withDexFixture({
    pairs: [{
      chainId: "solana",
      baseToken: { address: TOKEN, name: "Example", symbol: "EX" },
      quoteToken: { address: OTHER, name: "Quote", symbol: "Q" },
      pairAddress: "Pool111111111111111111111111111111111111",
      liquidity: {},
      txns: {},
      volume: {}
    }]
  }, async () => {
    const response = await onRequestGet();
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.tokens[0].riskScore, null);
    assert.equal(data.tokens[0].riskLevel, "UNKNOWN");
    assert.equal(data.tokens[0].riskStatus, "PARTIAL");
    assert.ok(data.tokens[0].riskReasons.includes("Liquiditätsdaten fehlen"));
  });
});

test("recognizes a discovered token on the quote side without borrowing base-token price or FDV", async () => {
  await withDexFixture({
    pairs: [{
      chainId: "solana",
      baseToken: { address: OTHER, name: "Base", symbol: "BASE" },
      quoteToken: { address: TOKEN, name: "Quote Token", symbol: "QUOTE" },
      pairAddress: "Pool111111111111111111111111111111111111",
      priceUsd: "12.5",
      marketCap: 1000000,
      fdv: 2000000,
      liquidity: { usd: 25000 },
      volume: { h24: 10000 },
      txns: { h24: { buys: 30, sells: 10 } },
      url: "https://dexscreener.com/solana/example"
    }]
  }, async () => {
    const response = await onRequestGet();
    const data = await response.json();
    const token = data.tokens[0];
    assert.equal(token.hasMarketPair, true);
    assert.equal(token.pairTokenSide, "quote");
    assert.equal(token.name, "Quote Token");
    assert.equal(token.symbol, "QUOTE");
    assert.equal(token.priceUsd, null);
    assert.equal(token.marketCapUsd, null);
    assert.equal(token.fdvUsd, null);
    assert.equal(token.buys24h, 10);
    assert.equal(token.sells24h, 30);
    assert.equal(token.riskStatus, "LIVE");
  });
});

test("tokens without a market pair have unknown risk rather than a fabricated numeric score", async () => {
  await withDexFixture({ pairs: [] }, async () => {
    const response = await onRequestGet();
    const data = await response.json();
    assert.equal(data.tokens[0].hasMarketPair, false);
    assert.equal(data.tokens[0].riskScore, null);
    assert.equal(data.tokens[0].riskLevel, "UNKNOWN");
    assert.equal(data.tokens[0].riskStatus, "UNAVAILABLE");
  });
});
