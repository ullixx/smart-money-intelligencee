const round = value => Number.isFinite(value) ? Number(value.toFixed(8)) : null;

export function aggregatePerformancePages(pages = []) {
  const eventsByKey = new Map();
  for (const page of Array.isArray(pages) ? pages : []) {
    for (const token of page?.tokenResults || []) {
      for (const event of token?.events || []) {
        if (!event?.signature || !token.mint || !["BUY", "SELL"].includes(event.side)) continue;
        const key = [event.signature, token.mint, event.side].join("|");
        if (!eventsByKey.has(key)) eventsByKey.set(key, { ...event, mint: token.mint });
      }
    }
  }

  const byMint = new Map();
  for (const event of eventsByKey.values()) {
    if (!byMint.has(event.mint)) byMint.set(event.mint, []);
    byMint.get(event.mint).push(event);
  }

  const tokenResults = [];
  for (const [mint, events] of byMint) {
    events.sort((a, b) => a.time - b.time || String(a.signature).localeCompare(String(b.signature)));
    const lots = [];
    let realized = 0, matchedAmount = 0, closedLots = 0, winningTrades = 0, losingTrades = 0, breakevenTrades = 0;
    let partialClosedTrades = 0, unmatchedEvents = 0, grossProfit = 0, grossLoss = 0, holdingDays = 0;

    for (const event of events) {
      const amount = Number(event.amount);
      if (!Number.isFinite(amount) || amount <= 0) { unmatchedEvents++; continue; }
      if (event.side === "BUY") {
        lots.push({ amount, price: Number.isFinite(event.priceUsd) ? event.priceUsd : null, time: event.time });
        if (!Number.isFinite(event.priceUsd)) unmatchedEvents++;
        continue;
      }

      let remaining = amount, tradePnl = 0, tradeMatched = 0, tradeComplete = true, tradeHoldingWeighted = 0;
      while (remaining > 1e-12 && lots.length) {
        const lot = lots[0], quantity = Math.min(remaining, lot.amount);
        if (lot.price == null || !Number.isFinite(event.priceUsd)) {
          unmatchedEvents++;
          tradeComplete = false;
        } else {
          const pnl = (event.priceUsd - lot.price) * quantity;
          realized += pnl;
          tradePnl += pnl;
          matchedAmount += quantity;
          tradeMatched += quantity;
          closedLots++;
          tradeHoldingWeighted += Math.max(0, event.time - lot.time) * quantity;
        }
        remaining -= quantity;
        lot.amount -= quantity;
        if (lot.amount <= 1e-12) lots.shift();
      }
      if (remaining > 1e-12) { unmatchedEvents++; tradeComplete = false; }
      if (tradeMatched > 0) {
        if (tradeComplete) {
          if (tradePnl > 0) { winningTrades++; grossProfit += tradePnl; }
          else if (tradePnl < 0) { losingTrades++; grossLoss += Math.abs(tradePnl); }
          else breakevenTrades++;
          holdingDays += (tradeHoldingWeighted / tradeMatched) / 86400;
        } else partialClosedTrades++;
      }
    }

    const closedTrades = winningTrades + losingTrades + breakevenTrades;
    tokenResults.push({
      mint, buys: events.filter(e => e.side === "BUY").length,
      sells: events.filter(e => e.side === "SELL").length,
      estimatedRealizedPnlUsd: matchedAmount ? round(realized) : null,
      matchedTokenAmount: round(matchedAmount), closedLots,
      closedTrades, winningTrades, losingTrades, breakevenTrades, partialClosedTrades,
      profitableClosedLots: winningTrades, losingClosedLots: losingTrades,
      winRateClosedLots: closedTrades ? winningTrades / closedTrades : null,
      averageWinUsd: winningTrades ? round(grossProfit / winningTrades) : null,
      averageLossUsd: losingTrades ? round(grossLoss / losingTrades) : null,
      grossProfitUsd: round(grossProfit), grossLossUsd: round(grossLoss),
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : (grossProfit > 0 ? "INFINITE" : null),
      winRateClosedTrades: closedTrades ? winningTrades / closedTrades : null,
      averageHoldingDays: closedTrades ? holdingDays / closedTrades : null,
      openLots: lots.length, unmatchedEvents,
      pricedEvents: events.filter(e => Number.isFinite(e.priceUsd)).length,
      totalEvents: events.length,
      status: events.every(e => Number.isFinite(e.priceUsd)) ? "HISTORICAL" : "PARTIAL"
    });
  }

  const closed = tokenResults.filter(x => x.estimatedRealizedPnlUsd !== null);
  const closedLots = tokenResults.reduce((n, x) => n + x.closedLots, 0);
  const closedTrades = tokenResults.reduce((n, x) => n + x.closedTrades, 0);
  const winningTrades = tokenResults.reduce((n, x) => n + x.winningTrades, 0);
  const losingTrades = tokenResults.reduce((n, x) => n + x.losingTrades, 0);
  const breakevenTrades = tokenResults.reduce((n, x) => n + x.breakevenTrades, 0);
  const partialClosedTrades = tokenResults.reduce((n, x) => n + x.partialClosedTrades, 0);
  const holdingDays = tokenResults.reduce((n, x) => n + (x.averageHoldingDays || 0) * x.closedTrades, 0);
  const grossProfit = tokenResults.reduce((n, x) => n + (x.grossProfitUsd || 0), 0);
  const grossLoss = tokenResults.reduce((n, x) => n + (x.grossLossUsd || 0), 0);
  const realizedPnl = tokenResults.reduce((n, x) => n + (x.estimatedRealizedPnlUsd || 0), 0);
  const allPagesHaveMore = (pages || []).some(page => page?.historyPagination?.hasMore);
  return {
    status: "PARTIAL",
    pagesLoaded: (pages || []).length,
    events: [...eventsByKey.values()].length,
    tokenResults,
    summary: {
      tokens: tokenResults.length,
      closedTokens: closed.length,
      positiveTokenPnlTokens: closed.filter(x => x.estimatedRealizedPnlUsd > 0).length,
      tokenLevelPositiveShare: closed.length ? closed.filter(x => x.estimatedRealizedPnlUsd > 0).length / closed.length : null,
      closedFifoLots: closedLots, closedTrades, winningTrades, losingTrades, breakevenTrades, partialClosedTrades,
      fifoLotWinRate: closedTrades ? winningTrades / closedTrades : null,
      estimatedRealizedPnlUsd: closedLots ? round(realizedPnl) : null,
      grossProfitUsd: round(grossProfit), grossLossUsd: round(grossLoss),
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : (grossProfit > 0 ? "INFINITE" : null),
      averageWinUsd: winningTrades ? round(grossProfit / winningTrades) : null,
      averageLossUsd: losingTrades ? round(grossLoss / losingTrades) : null,
      averageHoldingDays: closedTrades ? holdingDays / closedTrades : null,
      reputationStatus: closedTrades >= 10 ? "PARTIAL" : "INSUFFICIENT_DATA"
    },
    history: { pagesLoaded: (pages || []).length, hasMore: allPagesHaveMore, scope: "CUMULATIVE_PAGES_LOADED_ONLY" }
  };
}
