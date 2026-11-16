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
  assert.equal(token.winRateClosedLots, 1);
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
  assert.equal(result.tokenResults[0].losingClosedLots, 1);
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
  assert.equal(token.averageWinUsd, 5);
  assert.equal(token.averageLossUsd, 10);
});
