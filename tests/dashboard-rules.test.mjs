import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_ROW_LIMIT,
  dashboardRows,
} from "../app/dashboard-rules.ts";

test("dashboard control and recent records are both limited to five rows", () => {
  const rows = Array.from({ length: 8 }, (_, index) => index + 1);
  assert.equal(DASHBOARD_ROW_LIMIT, 5);
  assert.deepEqual(dashboardRows(rows), [1, 2, 3, 4, 5]);
});
