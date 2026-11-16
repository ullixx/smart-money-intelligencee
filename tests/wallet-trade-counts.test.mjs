import test from "node:test";
import assert from "node:assert/strict";
import { countWalletTradeDirections } from "../functions/lib/wallet-trade-counts.js";

test("counts SOL-to-token and token-to-SOL swaps once in their actual direction", () => {
  const result = countWalletTradeDirections([
    { success: true, classification: "DEX_SWAP_EVIDENCE", swapDirection: "SOL_TO_TOKEN", assetsSent: [{ mint: "SOL" }], assetsReceived: [{ mint: "A" }] },
    { success: true, classification: "SWAP_CANDIDATE", swapDirection: "TOKEN_TO_SOL", assetsSent: [{ mint: "A" }], assetsReceived: [{ mint: "SOL" }] }
  ]);
  assert.deepEqual(result, { buys: 1, sells: 1, tokenToTokenSwaps: 0 });
});

test("does not double-count token-to-token swaps as both buys and sells", () => {
  const result = countWalletTradeDirections([
    { success: true, classification: "DEX_SWAP_EVIDENCE", swapDirection: "TOKEN_TO_TOKEN", assetsSent: [{ mint: "A" }], assetsReceived: [{ mint: "B" }] }
  ]);
  assert.deepEqual(result, { buys: 0, sells: 0, tokenToTokenSwaps: 1 });
});

test("ignores failed, unrelated and unresolved transactions", () => {
  const result = countWalletTradeDirections([
    { success: false, classification: "DEX_SWAP_EVIDENCE", swapDirection: "SOL_TO_TOKEN" },
    { success: true, classification: "TOKEN_TRANSFER_IN", swapDirection: "SOL_TO_TOKEN" },
    { success: true, classification: "SWAP_CANDIDATE", swapDirection: "UNRESOLVED" }
  ]);
  assert.deepEqual(result, { buys: 0, sells: 0, tokenToTokenSwaps: 0 });
});
