function parseRawAmount(balance) {
  const token = balance?.uiTokenAmount;
  const decimals = token?.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new TypeError("Ungültige Token-Dezimalstellen in RPC-Metadaten");
  }
  const raw = token?.amount;
  if (raw === undefined || raw === null || !/^\d+$/.test(String(raw))) {
    throw new TypeError("Ungültiger Raw-Tokenbetrag in RPC-Metadaten");
  }
  return { raw: BigInt(String(raw)), decimals };
}

function toUiAmount(raw, decimals) {
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = (absolute / scale).toString();
  const fraction = decimals
    ? (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "")
    : "";
  const value = Number((negative ? "-" : "") + whole + (fraction ? "." + fraction : ""));
  if (!Number.isFinite(value)) throw new RangeError("Tokenbetrag außerhalb des darstellbaren Zahlenbereichs");
  return value;
}

/**
 * Aggregates all of a wallet's token accounts by mint before calculating deltas.
 * Raw integer token amounts are summed with BigInt; conversion to Number happens
 * only once per mint at the API boundary because existing consumers use numbers.
 */
export function aggregateWalletTokenBalanceChanges(preTokenBalances = [], postTokenBalances = [], wallet) {
  if (typeof wallet !== "string" || !wallet) throw new TypeError("Wallet-Adresse fehlt");
  const byMint = new Map();
  const add = (balances, side) => {
    for (const balance of Array.isArray(balances) ? balances : []) {
      if (balance?.owner !== wallet) continue;
      if (typeof balance.mint !== "string" || !balance.mint) {
        throw new TypeError("Token-Mint fehlt in RPC-Metadaten");
      }
      const { raw, decimals } = parseRawAmount(balance);
      let item = byMint.get(balance.mint);
      if (!item) {
        item = { mint: balance.mint, decimals, pre: 0n, post: 0n };
        byMint.set(balance.mint, item);
      } else if (item.decimals !== decimals) {
        throw new TypeError("Widersprüchliche Token-Dezimalstellen für dieselbe Mint-Adresse");
      }
      item[side] += raw;
    }
  };
  add(preTokenBalances, "pre");
  add(postTokenBalances, "post");
  return [...byMint.values()].map(item => {
    const rawAmount = item.post - item.pre;
    return {
      mint: item.mint,
      amount: toUiAmount(rawAmount, item.decimals),
      rawAmount: rawAmount.toString(),
      decimals: item.decimals
    };
  }).filter(item => item.rawAmount !== "0");
}
