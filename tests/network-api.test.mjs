import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/network.js";

test("checks five wallets within the RPC request budget using one transaction batch", async () => {
  const originalFetch = globalThis.fetch;
  const wallets = ["11111111111111111111111111111111","TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","So11111111111111111111111111111111111111112","JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4","675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"];
  const signatureWallet = new Map();
  let httpRequests = 0;
  let batchRequests = 0;

  globalThis.fetch = async (_url, options) => {
    httpRequests++;
    const body = JSON.parse(options.body);
    if (Array.isArray(body)) {
      batchRequests++;
      return new Response(JSON.stringify(body.slice().reverse().map(item => {
        const signature = item.params[0];
        const wallet = signatureWallet.get(signature);
        return {
          jsonrpc: "2.0",
          id: item.id,
          result: {
            transaction: { message: { accountKeys: [wallet], instructions: [] } },
            meta: {
              err: null,
              preBalances: [100],
              postBalances: [100],
              preTokenBalances: [],
              postTokenBalances: [],
              loadedAddresses: { writable: [], readonly: [] },
              innerInstructions: []
            }
          }
        };
      })), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    assert.equal(body.method, "getSignaturesForAddress");
    const wallet = body.params[0];
    const result = Array.from({ length: 8 }, (_, index) => {
      const signature = "sig-" + wallet + "-" + index;
      signatureWallet.set(signature, wallet);
      return { signature, blockTime: 100000 + index };
    });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const request = new Request("https://app.test/api/network?wallets=" + wallets.join(","));
    const response = await onRequestGet({ request, env: { SOLANA_RPC_URL: "https://rpc.test" } });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.transactionsRequested, 40);
    assert.equal(data.transactionsAnalysed, 40);
    assert.equal(data.skippedTransactions, 0);
    assert.equal(data.rpcBudget.used, 6);
    assert.equal(httpRequests, 6);
    assert.equal(batchRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("counts every transaction once when the RPC batch itself fails", async () => {
  const originalFetch = globalThis.fetch;
  const wallets = ["11111111111111111111111111111111","TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (Array.isArray(body)) throw new Error("batch transport failed");
    const wallet = body.params[0];
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: Array.from({ length: 8 }, (_, index) => ({
        signature: "sig-" + wallet + "-" + index,
        blockTime: 100000 + index
      }))
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const request = new Request("https://app.test/api/network?wallets=" + wallets.join(","));
    const response = await onRequestGet({ request, env: { SOLANA_RPC_URL: "https://rpc.test" } });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.transactionsRequested, 16);
    assert.equal(data.transactionsAnalysed, 0);
    assert.equal(data.skippedTransactions, 16);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
