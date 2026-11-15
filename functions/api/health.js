const checks = [
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
      const r = await fetch("https://api.mainnet-beta.solana.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      if (data.error || data.result !== "ok") throw new Error(data.error?.message || "RPC meldet nicht ok");
      return { result: data.result };
    }
  }
];

export async function onRequestGet() {
  const timestamp = new Date().toISOString();
  const results = await Promise.all(checks.map(async check => {
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
