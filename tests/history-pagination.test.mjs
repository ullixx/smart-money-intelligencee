import test from "node:test";
import assert from "node:assert/strict";
import { parseHistoryWindow, buildHistoryPagination } from "../functions/lib/history-pagination.js";

test("uses a safe default history page size", () => {
  assert.deepEqual(parseHistoryWindow("https://app.test/api/performance?address=abc"), {
    pageSize: 50, rpcLimit: 51, before: null
  });
});

test("caps history page size to a bounded batch size", () => {
  assert.equal(parseHistoryWindow("https://app.test/?limit=500").pageSize, 50);
  assert.equal(parseHistoryWindow("https://app.test/?limit=-5").pageSize, 1);
});

test("returns the last included signature as the exclusive next-page cursor", () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({ signature: "sig-" + i }));
  assert.deepEqual(buildHistoryPagination(rows, 3), {
    pageSize: 3, cursorApplied: false, hasMore: true,
    nextBefore: "sig-2", status: "MORE_HISTORY_AVAILABLE", scope: "CURRENT_PAGE_ONLY"
  });
});

test("marks a short page as exhausted by the current RPC index", () => {
  assert.deepEqual(buildHistoryPagination([{ signature: "sig-0" }], 25, "sig-old"), {
    pageSize: 25, cursorApplied: true, hasMore: false,
    nextBefore: null, status: "RPC_PAGE_EXHAUSTED", scope: "CURRENT_PAGE_ONLY"
  });
});
