import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeLockedCpLiquidityState,
  decodeLockedClmmPositionState,
  decodeLockProgramAccount,
  RAYDIUM_LOCK_PROGRAM,
  CP_DISCRIMINATOR,
  CLMM_DISCRIMINATOR
} from "../functions/lib/raydium-lock.js";

const key = "2" + "1".repeat(31);

test("decodes a Raydium CPMM Burn & Earn state with pool and locked LP amount", () => {
  const data = new Uint8Array(256);
  data.set(CP_DISCRIMINATOR, 0);
  data[8] = 7;
  data[64] = 1;
  const result = decodeLockedCpLiquidityState({ programOwner: RAYDIUM_LOCK_PROGRAM, data });
  assert.equal(result.status, "VERIFIED_LOCK_STATE");
  assert.equal(result.lockedLpAmountRaw, "7");
  assert.equal(result.poolId, key);
  assert.equal(result.lockModel, "BURN_AND_EARN_PERMANENT_LOCK");
  assert.equal(result.unlockAt, null);
});

test("decodes a Raydium CLMM locked position state", () => {
  const data = new Uint8Array(241);
  data.set(CLMM_DISCRIMINATOR, 0);
  data[41] = 1;
  data[8] = 3;
  const result = decodeLockedClmmPositionState({ programOwner: RAYDIUM_LOCK_PROGRAM, data });
  assert.equal(result.status, "VERIFIED_LOCK_STATE");
  assert.equal(result.bump, 3);
  assert.equal(result.poolId, key);
  assert.equal(result.lockModel, "BURN_AND_EARN_PERMANENT_LOCK");
});

test("rejects a lock state owned by a different program", () => {
  const result = decodeLockedCpLiquidityState({ programOwner: "OtherProgram", data: new Uint8Array(256) });
  assert.equal(result.status, "UNSUPPORTED");
});

test("rejects a mismatched pool reference", () => {
  const data = new Uint8Array(256);
  data.set(CP_DISCRIMINATOR, 0);
  data[64] = 1;
  const result = decodeLockProgramAccount({ programOwner: RAYDIUM_LOCK_PROGRAM, data, poolId: "DifferentPool", poolType: "CPMM" });
  assert.equal(result.status, "UNAVAILABLE");
});
