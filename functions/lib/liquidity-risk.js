export function assessPoolLiquidityRisk({ liquidityUsd, fdvUsd, volume24hUsd } = {}) {
  const liquidity = Number.isFinite(Number(liquidityUsd)) && liquidityUsd !== null && liquidityUsd !== undefined ? Number(liquidityUsd) : null;
  const fdv = Number.isFinite(Number(fdvUsd)) && fdvUsd !== null && fdvUsd !== undefined ? Number(fdvUsd) : null;
  const volume = Number.isFinite(Number(volume24hUsd)) && volume24hUsd !== null && volume24hUsd !== undefined ? Number(volume24hUsd) : null;
  const liquidityToFdvRatio = liquidity !== null && fdv > 0 ? liquidity / fdv : null;
  const volumeToLiquidity24h = liquidity > 0 && volume !== null ? volume / liquidity : null;
  const flags = [];
  if (liquidity !== null && liquidity < 10000) flags.push("LOW_POOL_LIQUIDITY_UNDER_10K_USD");
  else if (liquidity !== null && liquidity < 25000) flags.push("LIMITED_POOL_LIQUIDITY_UNDER_25K_USD");
  if (liquidityToFdvRatio !== null && liquidityToFdvRatio < 0.02) flags.push("LOW_LIQUIDITY_TO_FDV_UNDER_2_PERCENT");
  if (volumeToLiquidity24h !== null && volumeToLiquidity24h > 10) flags.push("HIGH_24H_VOLUME_TO_LIQUIDITY_RATIO");
  const status = liquidity === null && fdv === null && volume === null ? "UNAVAILABLE" : "PARTIAL";
  const level = liquidity !== null && liquidity < 10000 ? "ELEVATED" : flags.length ? "WATCH" : status === "UNAVAILABLE" ? "UNAVAILABLE" : "NO_SIGNAL";
  return { status, liquidityUsd: liquidity, fdvUsd: fdv, volume24hUsd: volume, liquidityToFdvRatio, volumeToLiquidity24h, flags, level };
}
