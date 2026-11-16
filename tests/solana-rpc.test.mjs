import test from "node:test";
import assert from "node:assert/strict";
import { createSolanaRpc } from "../functions/lib/solana-rpc.js";

test("returns an empty result for an empty batch without making an HTTP request", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("unexpected network request"); };
  try {
    const rpc = createSolanaRpc({ SOLANA_RPC_URL: "https://rpc.test" });
    assert.deepEqual(await rpc.callBatch([]), []);
    assert.equal(requests, 0);
    assert.equal(rpc.budget().used, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps successful batch results when one transaction returns an RPC error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([
    { jsonrpc: "2.0", id: 2, error: { code: -32015, message: "Unsupported transaction version" } },
    { jsonrpc: "2.0", id: 1, result: { slot: 123 } }
  ]), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const rpc = createSolanaRpc({ SOLANA_RPC_URL: "https://rpc.test" });
    const result = await rpc.callBatch([
      { method: "getTransaction", params: ["good-signature"] },
      { method: "getTransaction", params: ["unsupported-signature"] }
    ]);
    assert.deepEqual(result, [
      { slot: 123 },
      { __rpcError: "Solana RPC -32015: Unsupported transaction version" }
    ]);
    assert.equal(rpc.providerLabel(), "Primary RPC");
    assert.equal(rpc.budget().used, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("still throws for a non-retryable error in a single RPC call", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid params" }
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const rpc = createSolanaRpc({ SOLANA_RPC_URL: "https://rpc.test" });
    await assert.rejects(() => rpc.call("getTransaction", ["bad-signature"]), /Solana RPC -32602: Invalid params/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
