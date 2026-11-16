export const RAYDIUM_LOCK_PROGRAM = "LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE";
export const RAYDIUM_CPMM_PROGRAM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";
export const RAYDIUM_CLMM_PROGRAM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";

const CP_DISCRIMINATOR = [25, 10, 238, 197, 207, 234, 73, 22];
const CLMM_DISCRIMINATOR = [52, 23, 5, 7, 170, 90, 108, 213];

export function encodeBase58(bytes) {
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

function readU64LE(data, offset) {
  let value = 0n;
  for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(data[offset + i]);
  return value.toString();
}

function readPubkey(data, offset) {
  return encodeBase58(data.slice(offset, offset + 32));
}

function bytesFromBase64(value) {
  if (typeof value !== "string") return null;
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function decodeLockedCpLiquidityState({ programOwner, data } = {}) {
  if (programOwner !== RAYDIUM_LOCK_PROGRAM) return { status: "UNSUPPORTED", reason: "Account gehört nicht zum verifizierten Raydium-Lock-Programm." };
  if (!(data instanceof Uint8Array) || data.length < 256) return { status: "UNAVAILABLE", reason: "Locked-CP-Liquidity-State ist zu kurz." };
  if (!CP_DISCRIMINATOR.every((byte, index) => data[index] === byte)) return { status: "UNAVAILABLE", reason: "Account-Discriminator stimmt nicht mit LockedCpLiquidityState überein." };
  return {
    status: "VERIFIED_LOCK_STATE",
    lockedLpAmountRaw: readU64LE(data, 8),
    claimedLpAmountRaw: readU64LE(data, 16),
    unclaimedLpAmountRaw: readU64LE(data, 24),
    lastLpRaw: readU64LE(data, 32),
    recentEpoch: readU64LE(data, 56),
    poolId: readPubkey(data, 64),
    feeNftMint: readPubkey(data, 96),
    lockedOwner: readPubkey(data, 128),
    lockedLpMint: readPubkey(data, 160),
    lockModel: "BURN_AND_EARN_PERMANENT_LOCK",
    unlockAt: null
  };
}

export function decodeLockedClmmPositionState({ programOwner, data } = {}) {
  if (programOwner !== RAYDIUM_LOCK_PROGRAM) return { status: "UNSUPPORTED", reason: "Account gehört nicht zum verifizierten Raydium-Lock-Programm." };
  if (!(data instanceof Uint8Array) || data.length < 241) return { status: "UNAVAILABLE", reason: "Locked-CLMM-Position-State ist zu kurz." };
  if (!CLMM_DISCRIMINATOR.every((byte, index) => data[index] === byte)) return { status: "UNAVAILABLE", reason: "Account-Discriminator stimmt nicht mit LockedClmmPositionState überein." };
  return {
    status: "VERIFIED_LOCK_STATE",
    bump: data[8],
    positionOwner: readPubkey(data, 9),
    poolId: readPubkey(data, 41),
    positionId: readPubkey(data, 73),
    lockedNftAccount: readPubkey(data, 105),
    feeNftMint: readPubkey(data, 137),
    recentEpoch: readU64LE(data, 169),
    lockModel: "BURN_AND_EARN_PERMANENT_LOCK",
    unlockAt: null
  };
}

export function decodeLockProgramAccount({ programOwner, data, poolId, poolType } = {}) {
  const bytes = data instanceof Uint8Array ? data : bytesFromBase64(data);
  const decoded = poolType === "CPMM"
    ? decodeLockedCpLiquidityState({ programOwner, data: bytes })
    : poolType === "CLMM"
      ? decodeLockedClmmPositionState({ programOwner, data: bytes })
      : { status: "UNSUPPORTED", reason: "Pool-Typ wird vom Raydium-Lock-Decoder nicht unterstützt." };
  if (decoded.status !== "VERIFIED_LOCK_STATE") return decoded;
  if (decoded.poolId !== poolId) return { status: "UNAVAILABLE", reason: "Lock-State verweist auf eine andere Pool-Adresse." };
  return decoded;
}

export { CP_DISCRIMINATOR, CLMM_DISCRIMINATOR };
