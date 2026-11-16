import test from "node:test";
import assert from "node:assert/strict";
import { decodeRaydiumV4LpMint, RAYDIUM_AMM_V4 } from "../functions/lib/raydium-lp.js";

test("decodes the LP mint only from a correctly sized Raydium AMM v4 state", () => {
  const data = new Uint8Array(752);
  data[464] = 1;
  const result = decodeRaydiumV4LpMint({ programOwner: RAYDIUM_AMM_V4, data });
  assert.equal(result.status, "DECODED");
  assert.equal(result.offset, 464);
  assert.equal(result.lpMint, "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM");
});

test("does not decode a pool owned by another program", () => {
  const result = decodeRaydiumV4LpMint({ programOwner: "OtherProgram", data: new Uint8Array(752) });
  assert.equal(result.status, "UNSUPPORTED");
  assert.equal(result.lpMint, undefined);
});

test("rejects a pool state with the wrong byte length", () => {
  const result = decodeRaydiumV4LpMint({ programOwner: RAYDIUM_AMM_V4, data: new Uint8Array(751) });
  assert.equal(result.status, "UNAVAILABLE");
});

test("rejects an empty LP mint field", () => {
  const result = decodeRaydiumV4LpMint({ programOwner: RAYDIUM_AMM_V4, data: new Uint8Array(752) });
  assert.equal(result.status, "UNAVAILABLE");
});
