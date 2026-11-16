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
    let realized = 0, matchedAmount = 0, winningLots = 0, losingLots = 0, closedLots = 0;
    let holdingSeconds = 0, unmatchedEvents = 0, pricedBuys = 0, pricedSells = 0;

    for (const event of events) {
      const amount = Number(event.amount);
      if (!Number.isFinite(amount) || amount <= 0) { unmatchedEvents++; continue; }
      if (event.side === "BUY") {
        lots.push({ amount, price: Number.isFinite(event.priceUsd) ? event.priceUsd : null, time: event.time });
        if (Number.isFinite(event.priceUsd)) pricedBuys++;
        else unmatchedEvents++;
        continue;
      }
      if (Number.isFinite(event.priceUsd)) pricedSells++;
      let remaining = amount, matchedThisSell = false;
      while (remaining > 1e-12 && lots.length) {
        const lot = lots[0], quantity = Math.min(remaining, lot.amount);
        if (lot.price == null || !Number.isFinite(event.priceUsd)) {
          unmatchedEvents++;
        } else {
          const pnl = (event.priceUsd - lot.price) * quantity;
          realized += pnl;
          matchedAmount += quantity;
          closedLots++;
          holdingSeconds += Math.max(0, event.time - lot.time);
          if (pnl > 0) winningLots++;
          else if (pnl < 0) losingLots++;
          matchedThisSell = true;
        }
        remaining -= quantity;
        lot.amount -= quantity;
        if (lot.amount <= 1e-12) lots.shift();
      }
      if (remaining > 1e-12) unmatchedEvents++;
    }

    tokenResults.push({
      mint, buys: events.filter(e => e.side === "BUY").length,
      sells: events.filter(e => e.side === "SELL").length,
      estimatedRealizedPnlUsd: matchedAmount ? round(realized) : null,
      matchedTokenAmount: round(matchedAmount), closedLots,
      profitableClosedLots: winningLots, losingClosedLots: losingLots,
      winRateClosedLots: closedLots ? winningLots / closedLots : null,
      averageHoldingDays: closedLots ? holdingSeconds / closedLots / 86400 : null,
      openLots: lots.length, unmatchedEvents,
      pricedEvents: events.filter(e => Number.isFinite(e.priceUsd)).length,
      totalEvents: events.length,
      status: events.every(e => Number.isFinite(e.priceUsd)) ? "HISTORICAL" : "PARTIAL"
    });
  }

  const closed = tokenResults.filter(x => x.estimatedRealizedPnlUsd !== null);
  const closedLots = tokenResults.reduce((n, x) => n + x.closedLots, 0);
  const winningLots = tokenResults.reduce((n, x) => n + x.profitableClosedLots, 0);
  const losingLots = tokenResults.reduce((n, x) => n + x.losingClosedLots, 0);
  const holdingDays = tokenResults.reduce((n, x) => n + (x.averageHoldingDays || 0) * x.closedLots, 0);
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
      closedFifoLots: closedLots, winningFifoLots: winningLots, losingFifoLots: losingLots,
      fifoLotWinRate: closedLots ? winningLots / closedLots : null,
      averageHoldingDays: closedLots ? holdingDays / closedLots : null,
      reputationStatus: closedLots >= 10 ? "PARTIAL" : "INSUFFICIENT_DATA"
    },
    history: { pagesLoaded: (pages || []).length, hasMore: allPagesHaveMore, scope: "CUMULATIVE_PAGES_LOADED_ONLY" }
  };
}
