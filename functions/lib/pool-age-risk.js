const DAY_MS = 24 * 60 * 60 * 1000;

export function assessPoolAgeRisk({ pairCreatedAt, now = Date.now() } = {}) {
  const createdAt = Number(pairCreatedAt);
  const checkedAt = Number(now);
  if (!Number.isFinite(createdAt) || createdAt <= 0 || !Number.isFinite(checkedAt) || checkedAt <= 0) {
    return { status: "UNAVAILABLE", createdAt: null, ageMs: null, ageHours: null, ageDays: null, flags: [] };
  }
  const ageMs = checkedAt - createdAt;
  if (ageMs < 0) {
    return { status: "UNAVAILABLE", createdAt, ageMs: null, ageHours: null, ageDays: null, flags: [], reason: "Pool-Erstellungszeit liegt in der Zukunft; Zeitstempel wird nicht bewertet." };
  }
  const flags = [];
  if (ageMs < DAY_MS) flags.push("NEW_POOL_UNDER_24H");
  else if (ageMs < 7 * DAY_MS) flags.push("NEW_POOL_UNDER_7D");
  return {
    status: "PARTIAL",
    createdAt: new Date(createdAt).toISOString(),
    ageMs,
    ageHours: ageMs / (60 * 60 * 1000),
    ageDays: ageMs / DAY_MS,
    flags
  };
}
