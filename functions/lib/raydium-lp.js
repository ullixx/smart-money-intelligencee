const RAYDIUM_AMM_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const LP_MINT_OFFSET = 464;
const ACCOUNT_LENGTH = 752;

function encodeBase58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return "1".repeat(zeros) + digits.reverse().map(d => alphabet[d]).join("");
}

export function decodeRaydiumV4LpMint({ programOwner, data } = {}) {
  if (programOwner !== RAYDIUM_AMM_V4) return { status: "UNSUPPORTED", reason: "Pool gehört nicht zum verifizierten Raydium-AMM-v4-Programm." };
  if (!(data instanceof Uint8Array) || data.length !== ACCOUNT_LENGTH) {
    return { status: "UNAVAILABLE", reason: "Pool-State hat nicht die erwartete Raydium-v4-Länge von 752 Bytes." };
  }
  const lpMintBytes = data.slice(LP_MINT_OFFSET, LP_MINT_OFFSET + 32);
  if (lpMintBytes.every(byte => byte === 0)) return { status: "UNAVAILABLE", reason: "LP-Mint-Feld ist leer." };
  return { status: "DECODED", lpMint: encodeBase58(lpMintBytes), layout: "Raydium LIQUIDITY_STATE_LAYOUT_V4", offset: LP_MINT_OFFSET };
}

export { RAYDIUM_AMM_V4 };
