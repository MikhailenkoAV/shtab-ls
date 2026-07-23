import assert from "node:assert/strict";
import test from "node:test";
import { groupedDateCells } from "../app/journal-rules.ts";

test("journal displays one merged date cell for every date group", () => {
  const cells = groupedDateCells([
    { date: "2026-07-20" },
    { date: "2026-07-20" },
    { date: "2026-07-20" },
    { date: "2026-07-19" },
  ]);
  assert.deepEqual(cells, [
    { showDate: true, rowSpan: 3 },
    { showDate: false, rowSpan: 3 },
    { showDate: false, rowSpan: 3 },
    { showDate: true, rowSpan: 1 },
  ]);
});
