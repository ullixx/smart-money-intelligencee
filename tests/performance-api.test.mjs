import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/performance.js";

const WALLET = "Wallet1111111111111111111111111111111111";

test("performance endpoint exposes per-transaction RPC batch failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (Array.isArray(body)) {
      return new Response(JSON.stringify([{
        jsonrpc: "2.0",
        id: body[0].id,
        error: { code: -32015, message: "Unsupported transaction version" }
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    assert.equal(body.method, "getSignaturesForAddress");
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: [{ signature: "signature-one", blockTime: 1700000000 }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const request = new Request("https://app.test/api/performance?address=" + WALLET + "&pages=1");
    const response = await onRequestGet({ request, env: { SOLANA_RPC_URL: "https://rpc.test" } });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.transactionsRequested, 1);
    assert.equal(data.skippedTransactions, 1);
    assert.equal(data.skipReasons.rpcError, 1);
    assert.equal(data.skipReasons.missingMetadata, 0);
    assert.equal(data.rpcErrorDetails["Solana RPC -32015: Unsupported transaction version"], 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
