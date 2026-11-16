const SWAP_CLASSES = new Set(["BUY_INFERRED", "SELL_INFERRED", "DEX_SWAP_EVIDENCE", "SWAP_CANDIDATE"]);

export function countWalletTradeDirections(transactions = []) {
  const rows = Array.isArray(transactions) ? transactions : [];
  let buys = 0, sells = 0, tokenToTokenSwaps = 0;
  for (const tx of rows) {
    if (!tx || tx.success !== true || !SWAP_CLASSES.has(tx.classification)) continue;
    if (tx.swapDirection === "SOL_TO_TOKEN") buys++;
    else if (tx.swapDirection === "TOKEN_TO_SOL") sells++;
    else if (tx.swapDirection === "TOKEN_TO_TOKEN") tokenToTokenSwaps++;
  }
  return { buys, sells, tokenToTokenSwaps };
}
