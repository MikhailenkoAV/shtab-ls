import test from "node:test";
import assert from "node:assert/strict";
import { aircraftUsageSummary, readinessSummary, workloadSummary } from "../app/dashboard-infographics.ts";

test("readiness summary counts active employees only", () => {
  const people = [{ id: "1", name: "A", active: true }, { id: "2", name: "B", active: true }, { id: "3", name: "C", active: false }];
  assert.deepEqual(readinessSummary(people, { 1: { status: "allowed" }, 2: { status: "not_allowed" }, 3: { status: "restricted" } }), {
    allowed: 1, restricted: 0, notAllowed: 1, undetermined: 0, total: 2,
  });
});

test("workload summary aggregates and orders without changing source data", () => {
  const people = [{ id: "1", name: "A", active: true }, { id: "2", name: "B", active: true }];
  const shifts = [
    { personId: "1", activity: "flight", workMinutes: 120, segments: [{ aircraft: "RA-1", flightMinutes: 40 }] },
    { personId: "2", activity: "office", workMinutes: 180, segments: [] },
  ];
  assert.deepEqual(workloadSummary(people, shifts).map((row) => [row.name, row.workMinutes, row.flightMinutes]), [["B", 180, 0], ["A", 120, 40]]);
});

test("aircraft usage combines segments by registration number", () => {
  const shifts = [
    { personId: "1", activity: "flight", workMinutes: 100, segments: [{ aircraft: "RA-1", flightMinutes: 30 }, { aircraft: "RA-2", flightMinutes: 20 }] },
    { personId: "2", activity: "flight", workMinutes: 100, segments: [{ aircraft: "RA-1", flightMinutes: 40 }] },
  ];
  assert.deepEqual(aircraftUsageSummary(shifts).map((row) => [row.aircraft, row.flightMinutes, row.shiftCount]), [["RA-1", 70, 2], ["RA-2", 20, 1]]);
});
