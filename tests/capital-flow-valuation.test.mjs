import test from "node:test";
import assert from "node:assert/strict";
import { valueCapitalFlow } from "../functions/lib/capital-flow-valuation.js";

test("values positive and negative token movements at their nearest historical candles", () => {
  const result = valueCapitalFlow({eventDetails:[
    {time:100,amount:2},{time:200,amount:-1}
  ]},[{time:100,close:5},{time:200,close:8}],10);
  assert.equal(result.usdInflow,10);
  assert.equal(result.usdOutflow,8);
  assert.equal(result.usdValue,2);
  assert.equal(result.valuationStatus,"HISTORICAL");
});

test("marks partial coverage when some events have no nearby candle", () => {
  const result = valueCapitalFlow({eventDetails:[
    {time:100,amount:2},{time:10000,amount:-1}
  ]},[{time:100,close:5}],30);
  assert.equal(result.pricedEvents,1);
  assert.equal(result.totalEvents,2);
  assert.equal(result.valuationStatus,"PARTIAL");
});

test("does not manufacture a value without historical events or prices", () => {
  assert.equal(valueCapitalFlow({eventDetails:[]},[]).usdValue,null);
  assert.equal(valueCapitalFlow({eventDetails:[{time:100,amount:1}]},[]).valuationStatus,"UNAVAILABLE");
});
