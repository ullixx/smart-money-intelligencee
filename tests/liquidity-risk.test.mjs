import test from "node:test";
import assert from "node:assert/strict";
import { assessPoolLiquidityRisk } from "../functions/lib/liquidity-risk.js";

test("flags very low pool liquidity and a low liquidity-to-FDV ratio", () => {
  const result = assessPoolLiquidityRisk({ liquidityUsd: 9000, fdvUsd: 1000000, volume24hUsd: 5000 });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.level, "ELEVATED");
  assert.ok(result.flags.includes("LOW_POOL_LIQUIDITY_UNDER_10K_USD"));
  assert.ok(result.flags.includes("LOW_LIQUIDITY_TO_FDV_UNDER_2_PERCENT"));
});

test("uses the limited-liquidity band below 25k but not below 10k", () => {
  const result = assessPoolLiquidityRisk({ liquidityUsd: 15000, fdvUsd: 500000, volume24hUsd: 1000 });
  assert.equal(result.level, "WATCH");
  assert.ok(result.flags.includes("LIMITED_POOL_LIQUIDITY_UNDER_25K_USD"));
  assert.ok(!result.flags.includes("LOW_POOL_LIQUIDITY_UNDER_10K_USD"));
});

test("flags extreme 24h volume relative to pool liquidity", () => {
  const result = assessPoolLiquidityRisk({ liquidityUsd: 20000, fdvUsd: 500000, volume24hUsd: 250000 });
  assert.ok(result.flags.includes("HIGH_24H_VOLUME_TO_LIQUIDITY_RATIO"));
});

test("does not divide by zero or manufacture a ratio when FDV is absent", () => {
  const result = assessPoolLiquidityRisk({ liquidityUsd: 20000, fdvUsd: 0, volume24hUsd: 1000 });
  assert.equal(result.liquidityToFdvRatio, null);
  assert.equal(result.volumeToLiquidity24h, 0.05);
});

test("returns unavailable rather than a clean bill of health when all pool metrics are missing", () => {
  const result = assessPoolLiquidityRisk({});
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.level, "UNAVAILABLE");
  assert.deepEqual(result.flags, []);
  assert.equal(result.liquidityUsd, null);
});

test("accepts numeric API strings but rejects null values as zero", () => {
  const result = assessPoolLiquidityRisk({ liquidityUsd: "12000", fdvUsd: "600000", volume24hUsd: null });
  assert.equal(result.liquidityUsd, 12000);
  assert.equal(result.liquidityToFdvRatio, 0.02);
  assert.equal(result.volume24hUsd, null);
  assert.equal(result.volumeToLiquidity24h, null);
});
