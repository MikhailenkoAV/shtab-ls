import assert from "node:assert/strict";
import test from "node:test";
import { buildActualPlanExportMatrix } from "../app/actual-plan-export.ts";

test("actual plan export keeps one employee row, calendar dates and multiple entries in a day", () => {
  const matrix = buildActualPlanExportMatrix(
    "2026-07",
    [{ id: "pilot", name: "Иванов Иван Иванович", active: true }],
    [
      { personId: "pilot", date: "2026-07-10", activity: "flight", start: "08:00", segments: [{ aircraftType: "AW109", aircraft: "RA-01902" }] },
      { personId: "pilot", date: "2026-07-10", activity: "office", start: "15:00", note: "Документы" },
    ],
  );
  assert.equal(matrix.dates.length, 31);
  assert.equal(matrix.people[0].name, "Иванов Иван Иванович");
  assert.equal(matrix.cells[0][9].activity, "mixed");
  assert.match(matrix.cells[0][9].text, /AW109 · RA-01902/);
  assert.match(matrix.cells[0][9].text, /Работа в офисе/);
});
