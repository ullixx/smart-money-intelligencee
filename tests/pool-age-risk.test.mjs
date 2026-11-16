import test from "node:test";
import assert from "node:assert/strict";
import { assessPoolAgeRisk } from "../functions/lib/pool-age-risk.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);

test("flags a pool younger than 24 hours", () => {
  const result = assessPoolAgeRisk({ pairCreatedAt: NOW - 3 * 60 * 60 * 1000, now: NOW });
  assert.equal(result.status, "PARTIAL");
  assert.deepEqual(result.flags, ["NEW_POOL_UNDER_24H"]);
  assert.equal(result.ageHours, 3);
});

test("flags a pool between one and seven days old", () => {
  const result = assessPoolAgeRisk({ pairCreatedAt: NOW - 3 * DAY, now: NOW });
  assert.deepEqual(result.flags, ["NEW_POOL_UNDER_7D"]);
  assert.equal(result.ageDays, 3);
});

test("does not flag a pool older than seven days", () => {
  const result = assessPoolAgeRisk({ pairCreatedAt: NOW - 8 * DAY, now: NOW });
  assert.deepEqual(result.flags, []);
});

test("marks missing timestamps unavailable", () => {
  assert.equal(assessPoolAgeRisk({ now: NOW }).status, "UNAVAILABLE");
});

test("rejects future timestamps instead of reporting negative pool age", () => {
  const result = assessPoolAgeRisk({ pairCreatedAt: NOW + DAY, now: NOW });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.ageMs, null);
  assert.ok(result.reason);
});
