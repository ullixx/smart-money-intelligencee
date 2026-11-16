import test from "node:test";
import assert from "node:assert/strict";
import { selectPriceResolution, nearestCandle } from "../functions/lib/price-resolution.js";

test("uses one-minute candles when the event window fits the recent range", () => {
  assert.deepEqual(selectPriceResolution([{time:1000},{time:1000+3600}]), {
    timeframe:"minute",aggregate:1,toleranceSeconds:90,method:"MINUTE_ESTIMATE"
  });
});

test("falls back to hourly candles for wider historical windows", () => {
  assert.equal(selectPriceResolution([{time:1000},{time:1000+16*3600}]).timeframe,"hour");
});

test("matches only a candle within the configured tolerance", () => {
  const candles=[{time:100,close:1},{time:200,close:2}];
  assert.equal(nearestCandle(candles,190,20).close,2);
  assert.equal(nearestCandle(candles,250,20),null);
});
