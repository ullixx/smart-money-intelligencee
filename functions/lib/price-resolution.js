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

export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export function deriveUsdcExecutionPrice({ mint, amount, side, tokenChanges = [] } = {}) {
  if (!mint || mint === SOLANA_USDC_MINT || !Number.isFinite(amount) || amount <= 0) return null;
  if (side !== "BUY" && side !== "SELL") return null;
  const stable = tokenChanges.filter(x => x?.mint === SOLANA_USDC_MINT && Number.isFinite(x.amount) && x.amount !== 0);
  const traded = tokenChanges.filter(x => x?.mint !== SOLANA_USDC_MINT && Number.isFinite(x.amount) && x.amount !== 0);
  if (stable.length !== 1 || traded.length !== 1 || traded[0].mint !== mint) return null;
  const expectedQuoteSign = side === "BUY" ? -1 : 1;
  if (Math.sign(stable[0].amount) !== expectedQuoteSign) return null;
  const price = Math.abs(stable[0].amount) / amount;
  return Number.isFinite(price) && price > 0 ? price : null;
}
