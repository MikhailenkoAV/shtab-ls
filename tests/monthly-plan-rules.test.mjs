import assert from "node:assert/strict";
import test from "node:test";
import { aircraftNumbersByType } from "../app/aircraft-rules.ts";
import {
  aircraftTypeForNumber,
  assignmentDateWarning,
  assignmentBlockReason,
  automaticPlanActivityKey,
  availablePeopleForAssignment,
  buildAutomaticPlanActivityMap,
  busyBlockReason,
  datesInRange,
  isPersonBusyOnDate,
  monthDates,
  planBusyActivities,
} from "../app/monthly-plan-rules.ts";
import { buildMonthlyPlanMatrix } from "../app/monthly-plan-export.ts";

test("monthly plan builds every calendar date, including leap February", () => {
  assert.equal(monthDates("2026-07").length, 31);
  assert.equal(monthDates("2028-02").length, 29);
  assert.equal(monthDates("2028-02").at(-1), "2028-02-29");
});

test("employment range supports one day and selectively generated periods", () => {
  assert.deepEqual(datesInRange("2026-07-15", "2026-07-15"), ["2026-07-15"]);
  assert.deepEqual(datesInRange("2026-07-30", "2026-08-02"), [
    "2026-07-30",
    "2026-07-31",
    "2026-08-01",
    "2026-08-02",
  ]);
});

test("aircraft registration resolves to its aircraft type", () => {
  assert.equal(aircraftTypeForNumber("RA-01902", aircraftNumbersByType), "AW109");
  assert.equal(aircraftTypeForNumber("RA-2991G", aircraftNumbersByType), "BO105");
});

test("vacation and periodic training block flight-plan assignment", () => {
  const busyEntries = [
    { id: "vacation", personId: "one", dateFrom: "2026-07-10", dateTo: "2026-07-20", activity: "vacation", note: "" },
  ];
  const actualBusy = [
    { personId: "two", date: "2026-07-15", activity: "periodic_training" },
  ];
  assert.equal(isPersonBusyOnDate("one", "2026-07-15", busyEntries, actualBusy), true);
  assert.equal(isPersonBusyOnDate("two", "2026-07-15", busyEntries, actualBusy), true);
  assert.equal(isPersonBusyOnDate("three", "2026-07-15", busyEntries, actualBusy), false);
});

test("assignment list keeps only free pilots with the required aircraft type", () => {
  const people = [
    { id: "one", aircraftTypes: ["AW109"], active: true },
    { id: "two", aircraftTypes: ["AW109"], active: true },
    { id: "three", aircraftTypes: ["R44"], active: true },
  ];
  const available = availablePeopleForAssignment(
    people,
    [{ id: "existing", personId: "one", date: "2026-07-15", aircraft: "RA-07701", role: "primary" }],
    [],
    [],
    "2026-07-15",
    "AW109",
    "RA-07701",
  );
  assert.deepEqual(available.map((person) => person.id), ["two"]);
});

test("a qualified pilot may be assigned to another aircraft on the same date", () => {
  const people = [
    { id: "one", aircraftTypes: ["AW109"], active: true },
    { id: "two", aircraftTypes: ["AW109"], active: true },
  ];
  const assignments = [
    { id: "existing", personId: "one", date: "2026-07-15", aircraft: "RA-01902", role: "primary" },
  ];
  const available = availablePeopleForAssignment(
    people,
    assignments,
    [],
    [],
    "2026-07-15",
    "AW109",
    "RA-OTHER",
  );
  assert.deepEqual(available.map((person) => person.id), ["one", "two"]);
  assert.match(
    assignmentDateWarning(assignments, "one", "2026-07-15", ["RA-OTHER"]) ?? "",
    /RA-01902 · Основной/,
  );
});

test("automatic distribution counts actual work and inserts a day off after six days", () => {
  const people = [
    { id: "pilot", aircraftTypes: ["AW109"], active: true },
    { id: "inactive", aircraftTypes: ["AW109"], active: false },
  ];
  const actualWork = datesInRange("2026-07-13", "2026-07-18")
    .map((date) => ({ personId: "pilot", date, activity: "office" }));
  const automatic = buildAutomaticPlanActivityMap(
    people,
    ["2026-07-19", "2026-07-20"],
    [],
    [],
    actualWork,
  );
  assert.equal(automatic.get(automaticPlanActivityKey("pilot", "2026-07-19")), "dayoff");
  assert.equal(automatic.get(automaticPlanActivityKey("pilot", "2026-07-20")), "standby");
  assert.equal(automatic.has(automaticPlanActivityKey("inactive", "2026-07-19")), false);
});

test("a day off returns a specific blocking reason for a flight", () => {
  const reason = assignmentBlockReason({
    person: { id: "one", aircraftTypes: ["AW109"], active: true },
    assignments: [],
    busyEntries: [{ id: "off", personId: "one", dateFrom: "2026-07-15", dateTo: "2026-07-15", activity: "dayoff", note: "" }],
    actualBusy: [],
    date: "2026-07-15",
    aircraftType: "AW109",
    aircraft: "RA-01902",
  });
  assert.equal(reason, "На эту дату уже указано: Выходной.");
});

test("non-flight employment cannot replace an existing aircraft assignment", () => {
  const reason = busyBlockReason(
    "one",
    "2026-07-15",
    [{ id: "flight", personId: "one", date: "2026-07-15", aircraft: "RA-01902", role: "primary" }],
    [],
    [],
  );
  assert.equal(reason, "На эту дату уже назначен полёт на RA-01902.");
});

test("manual standby stays on an aircraft while automatic standby has its own export row", () => {
  assert.equal(planBusyActivities.includes("standby"), false);
  const matrix = buildMonthlyPlanMatrix(
    "2026-07",
    [{ id: "one", name: "Иванов Иван Иванович", aircraftTypes: ["AW109"], active: true }],
    [],
    [{ id: "standby", personId: "one", date: "2026-07-15", aircraft: "RA-01902", role: "primary", activity: "standby" }],
    [],
  );
  const aircraftRow = matrix.rows.find((row) => row.aircraft === "RA-01902" && row.role === "primary");
  assert.match(aircraftRow?.cells[14] ?? "", /Ожидание/);
  assert.equal(matrix.rows.filter((row) => row.kind === "busy" && row.activity === "standby").length, 1);
});

test("monthly plan export alternates automatic standby with a day off after six work days", () => {
  const matrix = buildMonthlyPlanMatrix(
    "2026-07",
    [{ id: "one", name: "Иванов Иван Иванович", aircraftTypes: ["AW109"], active: true }],
    [],
    [],
    [],
  );
  const dayOffRow = matrix.rows.find((row) => row.kind === "busy" && row.activity === "dayoff");
  const standbyRow = matrix.rows.find((row) => row.kind === "busy" && row.activity === "standby");
  assert.match(standbyRow?.cells[0] ?? "", /Иванов И\.И\./);
  assert.match(dayOffRow?.cells[4] ?? "", /Иванов И\.И\./);
});
