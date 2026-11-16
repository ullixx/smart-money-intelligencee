import test from "node:test";
import assert from "node:assert/strict";
import { isValidSolanaAddress } from "../functions/lib/solana-address.js";
test("accepts canonical 32-byte Solana public keys",()=>{assert.equal(isValidSolanaAddress("11111111111111111111111111111111"),true);assert.equal(isValidSolanaAddress("So11111111111111111111111111111111111111112"),true);});
test("rejects Base58 strings with wrong decoded byte length",()=>{assert.equal(isValidSolanaAddress("1111111111111111111111111111111"),false);assert.equal(isValidSolanaAddress("111111111111111111111111111111111"),false);assert.equal(isValidSolanaAddress("1111111111111111111111111111111!"),false);assert.equal(isValidSolanaAddress(""),false);assert.equal(isValidSolanaAddress(null),false);});
