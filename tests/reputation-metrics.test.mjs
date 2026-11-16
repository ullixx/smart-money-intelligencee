import test from "node:test";
import assert from "node:assert/strict";
import { aggregatePerformancePages } from "../functions/lib/reputation-metrics.js";

const page = events => ({ tokenResults: [{ mint: "MintA", events }] });
const event = (signature, side, time, priceUsd, amount = 1) => ({ signature, side, time, priceUsd, amount });

test("matches BUY and SELL lots across separately loaded history pages", () => {
  const result = aggregatePerformancePages([
    page([event("sell-2", "SELL", 200, 15)]),
    page([event("buy-1", "BUY", 100, 10)])
  ]);
  const token = result.tokenResults[0];
  assert.equal(token.closedLots, 1);
  assert.equal(token.estimatedRealizedPnlUsd, 5);
  assert.equal(token.winRateClosedTrades, 1);
  assert.equal(token.closedTrades, 1);
  assert.equal(result.summary.averageHoldingDays, 100 / 86400);
});

test("deduplicates repeated events and does not count open inventory as closed PnL", () => {
  const buy = event("buy-1", "BUY", 100, 10, 2);
  const result = aggregatePerformancePages([page([buy]), page([buy])]);
  assert.equal(result.events, 1);
  assert.equal(result.tokenResults[0].closedLots, 0);
  assert.equal(result.tokenResults[0].openLots, 1);
  assert.equal(result.tokenResults[0].estimatedRealizedPnlUsd, null);
});

test("keeps unpriced BUY lots unmatched rather than inventing PnL", () => {
  const result = aggregatePerformancePages([page([
    event("buy-1", "BUY", 100, null),
    event("sell-1", "SELL", 200, 15)
  ])]);
  assert.equal(result.tokenResults[0].estimatedRealizedPnlUsd, null);
  assert.equal(result.tokenResults[0].unmatchedEvents, 2);
});

test("calculates a loss and labels incomplete price coverage", () => {
  const result = aggregatePerformancePages([page([
    event("buy-1", "BUY", 100, 20),
    event("sell-1", "SELL", 200, 15)
  ])]);
  assert.equal(result.tokenResults[0].estimatedRealizedPnlUsd, -5);
  assert.equal(result.tokenResults[0].losingTrades, 1);
  assert.equal(result.tokenResults[0].status, "HISTORICAL");
});

test("calculates profit factor and average win and loss from closed FIFO fragments", () => {
  const result = aggregatePerformancePages([page([
    event("buy-a", "BUY", 100, 10),
    event("sell-a", "SELL", 200, 15),
    event("buy-b", "BUY", 300, 20),
    event("sell-b", "SELL", 400, 10)
  ])]);
  const token = result.tokenResults[0];
  assert.equal(token.grossProfitUsd, 5);
  assert.equal(token.grossLossUsd, 10);
  assert.equal(token.profitFactor, 0.5);
  assert.equal(token.closedTrades, 2);
  assert.equal(token.averageWinUsd, 5);
  assert.equal(token.averageLossUsd, 10);
});

test("does not inflate win rate when one sell consumes several FIFO lots", () => {
  const result = aggregatePerformancePages([page([
    event("buy-a", "BUY", 100, 10, 1),
    event("buy-b", "BUY", 110, 12, 1),
    event("sell-one", "SELL", 200, 15, 2)
  ])]);
  const token = result.tokenResults[0];
  assert.equal(token.closedLots, 2);
  assert.equal(token.closedTrades, 1);
  assert.equal(token.winningTrades, 1);
  assert.equal(token.winRateClosedTrades, 1);
  assert.equal(token.estimatedRealizedPnlUsd, 8);
});

test("excludes partly priced sells from the trade hit-rate denominator", () => {
  const result = aggregatePerformancePages([page([
    event("buy-priced", "BUY", 100, 10, 1),
    event("buy-unpriced", "BUY", 110, null, 1),
    event("sell-partial", "SELL", 200, 15, 2)
  ])]);
  const token = result.tokenResults[0];
  assert.equal(token.partialClosedTrades, 1);
  assert.equal(token.closedTrades, 0);
  assert.equal(token.winRateClosedTrades, null);
});

test("counts break-even exits in the completed-trade denominator", () => {
  const result = aggregatePerformancePages([page([
    event("buy-a", "BUY", 100, 10),
    event("sell-a", "SELL", 200, 10),
    event("buy-b", "BUY", 300, 10),
    event("sell-b", "SELL", 400, 15)
  ])]);
  const token = result.tokenResults[0];
  assert.equal(token.closedTrades, 2);
  assert.equal(token.breakevenTrades, 1);
  assert.equal(token.winningTrades, 1);
  assert.equal(token.winRateClosedTrades, 0.5);
});

test("ranks only profiles with enough completed trades and price coverage", async () => {
  const { rankPerformanceProfiles } = await import("../functions/lib/reputation-metrics.js");
  const profile = (address, pnl, trades, coverage, winRate = 0.5) => ({
    address, coverage,
    summary: { estimatedRealizedPnlUsd: pnl, closedTrades: trades, fifoLotWinRate: winRate }
  });
  const result = rankPerformanceProfiles([
    profile("wallet-low", 50, 12, 0.9),
    profile("wallet-top", 100, 15, 0.95),
    profile("wallet-thin", 1000, 3, 1),
    profile("wallet-poor-coverage", 900, 20, 0.5)
  ]);
  assert.deepEqual(result.ranked.map(x => [x.address, x.rank]), [["wallet-top", 1], ["wallet-low", 2]]);
  assert.deepEqual(result.unqualified.map(x => x.address), ["wallet-thin", "wallet-poor-coverage"]);
});

test("uses deterministic tie breaks without manufacturing a score", async () => {
  const { rankPerformanceProfiles } = await import("../functions/lib/reputation-metrics.js");
  const profiles = ["wallet-b", "wallet-a"].map(address => ({
    address, coverage: 1,
    summary: { estimatedRealizedPnlUsd: 10, closedTrades: 10, fifoLotWinRate: 0.6 }
  }));
  const result = rankPerformanceProfiles(profiles);
  assert.deepEqual(result.ranked.map(x => x.address), ["wallet-a", "wallet-b"]);
  assert.equal("score" in result.ranked[0], false);
});

test("does not rank null realized PnL as a zero-profit wallet", async () => {
  const { rankPerformanceProfiles } = await import("../functions/lib/reputation-metrics.js");
  const result = rankPerformanceProfiles([{
    address: "wallet-no-pnl",
    coverage: 1,
    summary: { estimatedRealizedPnlUsd: null, closedTrades: 12, fifoLotWinRate: 0.5 }
  }]);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.unqualified.length, 1);
  assert.equal(result.unqualified[0].eligible, false);
});
