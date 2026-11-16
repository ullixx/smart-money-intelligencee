export function parseHistoryWindow(url) {
  const params = url instanceof URL ? url.searchParams : new URL(url, "https://local.invalid").searchParams;
  const requested = Number.parseInt(params.get("limit") || "50", 10);
  const pageSize = Number.isFinite(requested) ? Math.max(1, Math.min(50, requested)) : 50;
  const before = (params.get("before") || "").trim() || null;
  return { pageSize, rpcLimit: pageSize + 1, before };
}

export function buildHistoryPagination(signatures, pageSize, before = null) {
  const rows = Array.isArray(signatures) ? signatures : [];
  const page = rows.slice(0, pageSize);
  const hasMore = rows.length > pageSize;
  return {
    pageSize,
    cursorApplied: Boolean(before),
    hasMore,
    nextBefore: hasMore && page.length ? page[page.length - 1].signature : null,
    status: hasMore ? "MORE_HISTORY_AVAILABLE" : "RPC_PAGE_EXHAUSTED",
    scope: "CURRENT_PAGE_ONLY"
  };
}
