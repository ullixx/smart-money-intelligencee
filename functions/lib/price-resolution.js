export function selectPriceResolution(events = []) {
  const times = (Array.isArray(events) ? events : []).map(x => Number(x?.time)).filter(Number.isFinite);
  if (!times.length) return { timeframe: "hour", aggregate: 1, toleranceSeconds: 3600, method: "HOURLY_ESTIMATE" };
  const span = Math.max(...times) - Math.min(...times);
  if (span <= 15 * 3600) return { timeframe: "minute", aggregate: 1, toleranceSeconds: 90, method: "MINUTE_ESTIMATE" };
  return { timeframe: "hour", aggregate: 1, toleranceSeconds: 3600, method: "HOURLY_ESTIMATE" };
}

export function nearestCandle(candles = [], timestamp, toleranceSeconds = 3600) {
  if (!Array.isArray(candles) || !candles.length || !Number.isFinite(timestamp)) return null;
  let best = candles[0];
  for (const candle of candles) {
    if (Math.abs(candle.time - timestamp) < Math.abs(best.time - timestamp)) best = candle;
  }
  return Math.abs(best.time - timestamp) <= toleranceSeconds ? best : null;
}
