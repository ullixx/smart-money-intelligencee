export function valueCapitalFlow(flow, candles, toleranceSeconds = 3600) {
  const events = Array.isArray(flow?.eventDetails) ? flow.eventDetails : [];
  if (!events.length || !Array.isArray(candles) || !candles.length) {
    return { usdValue: null, usdInflow: null, usdOutflow: null, pricedEvents: 0, totalEvents: events.length, valuationStatus: "UNAVAILABLE", valuationMethod: "Historische Kerzenpreise fehlen" };
  }
  let usdInflow = 0, usdOutflow = 0, pricedEvents = 0;
  for (const event of events) {
    if (!Number.isFinite(event.amount) || !Number.isFinite(event.time)) continue;
    let best = candles[0];
    for (const candle of candles) if (Math.abs(candle.time - event.time) < Math.abs(best.time - event.time)) best = candle;
    if (Math.abs(best.time - event.time) > toleranceSeconds || !Number.isFinite(best.close)) continue;
    const value = Math.abs(event.amount) * best.close;
    if (event.amount > 0) usdInflow += value;
    else if (event.amount < 0) usdOutflow += value;
    pricedEvents++;
  }
  const status = pricedEvents === events.length ? "HISTORICAL" : pricedEvents > 0 ? "PARTIAL" : "UNAVAILABLE";
  return {
    usdValue: pricedEvents ? Number((usdInflow - usdOutflow).toFixed(8)) : null,
    usdInflow: pricedEvents ? Number(usdInflow.toFixed(8)) : null,
    usdOutflow: pricedEvents ? Number(usdOutflow.toFixed(8)) : null,
    pricedEvents, totalEvents: events.length, valuationStatus: status,
    valuationMethod: "Token-Menge × nächster historischer Kerzenschlusskurs; keine exakte Swap-Gegenleistung"
  };
}
