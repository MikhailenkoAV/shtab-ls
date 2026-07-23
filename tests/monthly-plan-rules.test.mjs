import assert from "node:assert/strict";
import test from "node:test";
import { aircraftNumbersByType } from "../app/aircraft-rules.ts";
import {
  aircraftTypeForNumber,
  assignmentBlockReason,
  availablePeopleForAssignment,
  busyBlockReason,
  datesInRange,
  isPersonBusyOnDate,
  monthDates,
} from "../app/monthly-plan-rules.ts";

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
