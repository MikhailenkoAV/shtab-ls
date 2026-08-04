import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_ROW_LIMIT,
  dashboardRows,
  isCurrentMonthDate,
} from "../app/dashboard-rules.ts";

test("dashboard control and recent records are both limited to five rows", () => {
  const rows = Array.from({ length: 8 }, (_, index) => index + 1);
  assert.equal(DASHBOARD_ROW_LIMIT, 5);
  assert.deepEqual(dashboardRows(rows), [1, 2, 3, 4, 5]);
});

test("rest warnings are limited to the current calendar month", () => {
  assert.equal(isCurrentMonthDate("2026-08-01", "2026-08-04"), true);
  assert.equal(isCurrentMonthDate("2026-07-31", "2026-08-04"), false);
  assert.equal(isCurrentMonthDate("", "2026-08-04"), false);
});
