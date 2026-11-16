export async function onRequestGet() {
  const source = "DEX Screener";
  const now = new Date().toISOString();
  try {
    const results = await Promise.all([
      fetch("https://api.dexscreener.com/token-profiles/latest/v1", { signal: AbortSignal.timeout(8000) }),
      fetch("https://api.dexscreener.com/token-boosts/latest/v1", { signal: AbortSignal.timeout(8000) })
    ]);
    if (!results[0].ok || !results[1].ok) throw new Error("DEX Screener antwortet nicht");
    const lists = await Promise.all(results.map(response => response.json()));
    const map = new Map();
    for (const item of [...(Array.isArray(lists[0]) ? lists[0] : []), ...(Array.isArray(lists[1]) ? lists[1] : [])]) {
      if (item.chainId === "solana" && item.tokenAddress) map.set(item.tokenAddress, { ...(map.get(item.tokenAddress) || {}), ...item });
    }
    const tokens = [...map.values()].slice(0, 30);
    const addresses = tokens.map(token => token.tokenAddress);
    let pairs = [];
    if (addresses.length) {
      const response = await fetch("https://api.dexscreener.com/tokens/v1/solana/" + addresses.join(","), { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("DEX Screener Handelspaare nicht abrufbar (HTTP " + response.status + ")");
      pairs = await response.json();
      if (!Array.isArray(pairs)) throw new Error("DEX Screener lieferte ein ungültiges Handelspaar-Format");
    }

    // A token can be either side of a pool. Keep the matching side explicit:
    // pair-level USD liquidity/volume are reusable, base-token price/FDV are not.
    const best = new Map();
    for (const pair of pairs) {
      for (const [address, side] of [[pair.baseToken?.address, "base"], [pair.quoteToken?.address, "quote"]]) {
        if (!address || !addresses.includes(address)) continue;
        const current = best.get(address);
        if (!current || (Number(pair.liquidity?.usd) || 0) > (Number(current.pair.liquidity?.usd) || 0)) {
          best.set(address, { pair, side });
        }
      }
    }

    const tokenRows = tokens.map(token => {
      const match = best.get(token.tokenAddress);
      const pair = match?.pair || null;
      const isBase = match?.side === "base";
      const tokenInfo = pair ? (isBase ? pair.baseToken : pair.quoteToken) : null;
      const liquidity = pair?.liquidity?.usd == null ? null : Number(pair.liquidity.usd);
      const volume = pair?.volume?.h24 == null ? null : Number(pair.volume.h24);
      const rawBuys = pair?.txns?.h24?.buys;
      const rawSells = pair?.txns?.h24?.sells;
      const targetBuysRaw = isBase ? rawBuys : rawSells;
      const targetSellsRaw = isBase ? rawSells : rawBuys;
      const buys = targetBuysRaw == null ? null : Number(targetBuysRaw);
      const sells = targetSellsRaw == null ? null : Number(targetSellsRaw);
      const flags = [];
      if (liquidity !== null && Number.isFinite(liquidity) && liquidity < 10000) flags.push("Niedrige Liquidität (< $10k)");
      if (buys !== null && sells !== null && Number.isFinite(buys) && Number.isFinite(sells) && buys + sells >= 10 && sells > buys * 1.5) flags.push("Verkaufsdruck");
      if (liquidity > 0 && volume !== null && Number.isFinite(volume) && volume / liquidity > 5) flags.push("Sehr hoher Umsatz/Liquidität");

      const riskReasons = [];
      let riskScore = 0;
      if (!pair) riskReasons.push("Kein Handelspaar gefunden");
      if (pair && (liquidity === null || !Number.isFinite(liquidity))) riskReasons.push("Liquiditätsdaten fehlen");
      if (pair && (buys === null || sells === null || !Number.isFinite(buys) || !Number.isFinite(sells))) riskReasons.push("24h-Transaktionsdaten fehlen");
      if (pair && (volume === null || !Number.isFinite(volume))) riskReasons.push("24h-Volumendaten fehlen");
      if (pair && liquidity !== null && Number.isFinite(liquidity)) {
        if (liquidity < 5000) { riskScore += 35; riskReasons.push("Sehr geringe Liquidität (< $5k)"); }
        else if (liquidity < 10000) { riskScore += 20; riskReasons.push("Geringe Liquidität (< $10k)"); }
      }
      if (pair && buys !== null && sells !== null && Number.isFinite(buys) && Number.isFinite(sells) && buys + sells >= 10 && sells > buys * 1.5) {
        riskScore += 25;
        riskReasons.push("Deutlich mehr Verkäufe als Käufe");
      }
      if (pair && liquidity > 0 && volume !== null && Number.isFinite(volume)) {
        if (volume / liquidity > 10) { riskScore += 20; riskReasons.push("Extrem hohes Volumen/Liquidität-Verhältnis"); }
        else if (volume / liquidity > 5) { riskScore += 10; riskReasons.push("Hohes Volumen/Liquidität-Verhältnis"); }
      }
      const hasRiskEvidence = pair && [liquidity, buys, sells, volume].some(value => value !== null && Number.isFinite(value));
      const completeRiskInputs = Boolean(pair) && [liquidity, buys, sells, volume].every(value => value !== null && Number.isFinite(value));
      const finalRiskScore = !hasRiskEvidence ? null : Math.min(100, riskScore);
      const riskLevel = !hasRiskEvidence ? "UNKNOWN" : !completeRiskInputs ? "PARTIAL" : finalRiskScore >= 60 ? "HIGH" : finalRiskScore >= 30 ? "ELEVATED" : "LOW";

      return {
        address: token.tokenAddress,
        name: tokenInfo?.name || null,
        symbol: tokenInfo?.symbol || null,
        priceUsd: isBase && pair?.priceUsd != null ? Number(pair.priceUsd) : null,
        liquidityUsd: liquidity,
        volume24h: volume,
        buys24h: buys,
        sells24h: sells,
        marketCapUsd: isBase && pair?.marketCap != null ? Number(pair.marketCap) : null,
        fdvUsd: isBase && pair?.fdv != null ? Number(pair.fdv) : null,
        pairCreatedAt: pair?.pairCreatedAt ?? null,
        pairTokenSide: match?.side || null,
        flags,
        riskScore: finalRiskScore,
        riskLevel,
        riskStatus: !pair ? "UNAVAILABLE" : completeRiskInputs ? "LIVE" : "PARTIAL",
        riskReasons,
        url: pair?.url || token.url || null,
        hasMarketPair: Boolean(pair)
      };
    }).sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));

    return Response.json({
      status: "PARTIAL",
      source,
      timestamp: now,
      note: "Profil- und Boost-Listen sind keine vollständige Liste aller neu erstellten Token. Risikopunkte basieren nur auf sichtbarer Liquidität, Handelsverhältnis und Pool-Verfügbarkeit; fehlende Risikoeingaben werden als PARTIAL oder UNKNOWN statt als niedriges Risiko ausgewiesen. Quote-Token-Paare werden erkannt; Base-Token-Preis und FDV werden dafür nicht fälschlich übernommen. Keine Rug-Pull-Erkennung.",
      tokens: tokenRows
    }, { headers: { "Cache-Control": "public, max-age=30" } });
  } catch (error) {
    return Response.json({ status: "UNAVAILABLE", source, timestamp: now, error: "Datenquelle momentan nicht erreichbar", detail: String(error?.message || error), tokens: [] }, { status: 502 });
  }
}
