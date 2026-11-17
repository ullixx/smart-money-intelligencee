import test from "node:test";
import assert from "node:assert/strict";
import { aggregateWalletTokenBalanceChanges } from "../functions/lib/token-balance-deltas.js";

const WALLET = "Wallet1111111111111111111111111111111111";
const OTHER = "Other11111111111111111111111111111111111";
const balance = (accountIndex, amount, owner = WALLET, mint = "MintA", decimals = 2) => ({
  accountIndex, owner, mint,
  uiTokenAmount: { amount: String(amount), decimals, uiAmountString: String(Number(amount) / (10 ** decimals)) }
});

test("sums multiple wallet token accounts before and after by mint", () => {
  const result = aggregateWalletTokenBalanceChanges(
    [balance(1, 10000), balance(2, 5000)],
    [balance(1, 8000), balance(2, 7000)],
    WALLET
  );
  assert.deepEqual(result, []);
});

test("detects net changes across multiple token accounts of the same mint", () => {
  const result = aggregateWalletTokenBalanceChanges(
    [balance(1, 10000), balance(2, 5000)],
    [balance(1, 8000), balance(2, 9000)],
    WALLET
  );
  assert.deepEqual(result, [{ mint: "MintA", amount: 20, rawAmount: "2000", decimals: 2 }]);
});

test("handles a closed token account and a newly created token account", () => {
  const result = aggregateWalletTokenBalanceChanges(
    [balance(1, 1200)],
    [balance(3, 1700)],
    WALLET
  );
  assert.deepEqual(result, [{ mint: "MintA", amount: 5, rawAmount: "500", decimals: 2 }]);
});

test("does not include token accounts owned by another wallet", () => {
  const result = aggregateWalletTokenBalanceChanges(
    [balance(1, 10000, OTHER)],
    [balance(1, 20000, OTHER)],
    WALLET
  );
  assert.deepEqual(result, []);
});

test("sums raw integer amounts before converting to UI numbers", () => {
  const result = aggregateWalletTokenBalanceChanges(
    [balance(1, "9007199254740993123456789", WALLET, "MintLarge", 9)],
    [balance(1, "9007199254740993123456790", WALLET, "MintLarge", 9)],
    WALLET
  );
  assert.equal(result[0].rawAmount, "1");
  assert.equal(result[0].amount, 1e-9);
});

test("rejects inconsistent decimals for the same mint instead of returning a false delta", () => {
  assert.throws(() => aggregateWalletTokenBalanceChanges(
    [balance(1, 100, WALLET, "MintA", 2)],
    [balance(2, 100, WALLET, "MintA", 3)],
    WALLET
  ), /Dezimalstellen/);
});
