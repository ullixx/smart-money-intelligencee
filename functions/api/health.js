const checks = (env) => [
  {
    name: "DEX Screener",
    run: async () => {
      const r = await fetch("https://api.dexscreener.com/token-profiles/latest/v1", {
        headers: { "accept": "application/json" },
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      if (!Array.isArray(data)) throw new Error("Unerwartetes Antwortformat");
      return { records: data.length };
    }
  },
  {
    name: "Solana RPC",
    run: async () => {
      const endpoint = env?.SOLANA_RPC_URL || env?.SOLANA_RPC_FALLBACK_URL || "https://solana-rpc.publicnode.com";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" }),
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      if (data.error || !Number.isFinite(data.result)) throw new Error(data.error?.message || "RPC meldet nicht ok");
      return { slot: data.result, provider: env?.SOLANA_RPC_URL ? "Configured primary RPC (Helius/Custom)" : env?.SOLANA_RPC_FALLBACK_URL ? "Configured fallback RPC" : "PublicNode fallback" };
    }
  }
];

export async function onRequestGet({ env }) {
  const timestamp = new Date().toISOString();
  const results = await Promise.all(checks(env).map(async check => {
    const started = Date.now();
    try {
      const detail = await check.run();
      return { name: check.name, status: "LIVE", latencyMs: Date.now() - started, detail };
    } catch (error) {
      return { name: check.name, status: "UNAVAILABLE", latencyMs: Date.now() - started, error: error.message };
    }
  }));
  const status = results.every(x => x.status === "LIVE") ? "LIVE" : "PARTIAL";
  return Response.json({ status, timestamp, checks: results }, {
    headers: { "Cache-Control": "no-store" }
  });
}
