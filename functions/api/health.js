const probe = async (name, endpoint) => {
  const started = Date.now();
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" }),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    if (data.error || !Number.isFinite(data.result)) throw new Error(data.error?.message || "RPC meldet nicht ok");
    return { name, status: "LIVE", latencyMs: Date.now() - started, detail: { slot: data.result } };
  } catch (error) {
    return { name, status: "UNAVAILABLE", latencyMs: Date.now() - started, error: error.message };
  }
};
export async function onRequestGet({ env }) {
  const timestamp = new Date().toISOString();
  const checks = [
    (async () => {
      const started = Date.now();
      try {
        const r = await fetch("https://api.dexscreener.com/token-profiles/latest/v1", {
          headers: { "accept": "application/json" }, signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const data = await r.json();
        if (!Array.isArray(data)) throw new Error("Unerwartetes Antwortformat");
        return { name: "DEX Screener", status: "LIVE", latencyMs: Date.now() - started, detail: { records: data.length } };
      } catch (error) {
        return { name: "DEX Screener", status: "UNAVAILABLE", latencyMs: Date.now() - started, error: error.message };
      }
    })(),
    env?.SOLANA_RPC_URL
      ? probe("Solana RPC · Helius (Primary)", env.SOLANA_RPC_URL)
      : Promise.resolve({ name: "Solana RPC · Helius (Primary)", status: "NOT_CONFIGURED" }),
    env?.SOLANA_RPC_FALLBACK_URL
      ? probe("Solana RPC · QuickNode (Fallback)", env.SOLANA_RPC_FALLBACK_URL)
      : Promise.resolve({ name: "Solana RPC · QuickNode (Fallback)", status: "NOT_CONFIGURED" })
  ];
  const results = await Promise.all(checks);
  const configured = results.filter(x => x.status !== "NOT_CONFIGURED");
  const status = configured.length && configured.every(x => x.status === "LIVE") ? "LIVE" : "PARTIAL";
  return Response.json({ status, timestamp, checks: results }, { headers: { "Cache-Control": "no-store" } });
}
