import test from "node:test";
import assert from "node:assert/strict";
import { selectPriceResolution, nearestCandle } from "../functions/lib/price-resolution.js";

test("uses one-minute candles when the event window fits the recent range", () => {
  assert.deepEqual(selectPriceResolution([{time:1000},{time:1000+3600}]), {
    timeframe:"minute",aggregate:1,toleranceSeconds:90,method:"MINUTE_ESTIMATE"
  });
});

test("falls back to hourly candles for wider historical windows", () => {
  assert.equal(selectPriceResolution([{time:1000},{time:1000+16*3600}]).timeframe,"hour");
});

test("matches only a candle within the configured tolerance", () => {
  const candles=[{time:100,close:1},{time:200,close:2}];
  assert.equal(nearestCandle(candles,190,20).close,2);
  assert.equal(nearestCandle(candles,250,20),null);
});

import { deriveUsdcExecutionPrice, SOLANA_USDC_MINT } from "../functions/lib/price-resolution.js";

test("derives a BUY execution price from the wallet's USDC outflow", () => {
  assert.equal(deriveUsdcExecutionPrice({
    mint: "TokenMint", amount: 1000, side: "BUY",
    tokenChanges: [{ mint: "TokenMint", amount: 1000 }, { mint: SOLANA_USDC_MINT, amount: -25 }]
  }), 0.025);
});

test("derives a SELL execution price from the wallet's USDC inflow", () => {
  assert.equal(deriveUsdcExecutionPrice({
    mint: "TokenMint", amount: 1000, side: "SELL",
    tokenChanges: [{ mint: "TokenMint", amount: -1000 }, { mint: SOLANA_USDC_MINT, amount: 25 }]
  }), 0.025);
});

test("does not guess a price for multi-hop token swaps or mismatched quote direction", () => {
  assert.equal(deriveUsdcExecutionPrice({
    mint: "TokenMint", amount: 1000, side: "BUY",
    tokenChanges: [{ mint: "TokenMint", amount: 1000 }, { mint: "OtherMint", amount: -2 }, { mint: SOLANA_USDC_MINT, amount: -25 }]
  }), null);
  assert.equal(deriveUsdcExecutionPrice({
    mint: "TokenMint", amount: 1000, side: "BUY",
    tokenChanges: [{ mint: "TokenMint", amount: 1000 }, { mint: SOLANA_USDC_MINT, amount: 25 }]
  }), null);
});
