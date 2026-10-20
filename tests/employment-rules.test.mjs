import assert from "node:assert/strict";
import test from "node:test";
import { changeEmploymentStatus, isEmployedOnDate } from "../app/employment-rules.ts";
import { assignmentBlockReason, automaticPlanActivityKey, buildAutomaticPlanActivityMap, isMonthlyPlanPerson, monthlyPlanPeople } from "../app/monthly-plan-rules.ts";
import { buildMonthlyPlanMatrix } from "../app/monthly-plan-export.ts";
import { buildControlRows } from "../app/control-journal-rules.ts";
import { buildFlightReport, buildEmploymentReport } from "../app/monthly-report.ts";
import { buildFlightBook } from "../app/flight-book-rules.ts";
import { backupChecksum, validateBackupEnvelope } from "../app/recovery-rules.ts";

const person = () => ({ id: "pilot", name: "Тестовый Иван Иванович", active: true, position: "КВС", monthlyPlanEnabled: true, aircraftTypes: ["R44"], qualifications: [{ aircraftTypes: ["R44"], nightAircraftTypes: ["R44"] }] });
const event = (kind, date, id = `${kind}-${date}`) => ({ id, kind, date, orderNumber: "  12-к  ", recordedAt: "2026-10-20T08:00:00.000Z" });
const dismissed = () => changeEmploymentStatus(person(), event("dismissed", "2026-10-10"), "2026-10-20");
const shift = { id: "flight", personId: "pilot", date: "2026-10-05", start: "06:00", activity: "flight", workMinutes: 180, note: "", segments: [{ id: "segment", aircraftType: "R44", aircraft: "RA-04186", seat: "КВС", purpose: "АОН", flightMinutes: 75, nightMinutes: 20, dayLandings: 2, nightLandings: 3 }] };
const assignment = { id: "assignment", personId: "pilot", date: "2026-10-05", aircraft: "RA-04186", role: "primary" };

test("archiving and rehire retain identity, qualifications and planning preference without mutating the original", () => {
  const original = person();
  const archived = changeEmploymentStatus(original, event("dismissed", "2026-10-10"), "2026-10-20");
  assert.equal(archived.active, false);
  assert.equal(original.active, true);
  assert.equal(original.employmentHistory, undefined);
  const rehired = changeEmploymentStatus(archived, event("rehired", "2026-10-20"), "2026-10-20");
  assert.equal(rehired.active, true);
  assert.equal(rehired.id, original.id);
  assert.deepEqual(rehired.qualifications, original.qualifications);
  assert.equal(rehired.monthlyPlanEnabled, true);
  assert.deepEqual(rehired.employmentHistory.map(e => e.kind), ["dismissed", "rehired"]);
  assert.equal(rehired.employmentHistory[0].orderNumber, "12-к");
});

test("repeated employment cycles retain every event and disabled monthly planning stays disabled", () => {
  let current = { ...person(), monthlyPlanEnabled: false };
  for (const e of [event("dismissed", "2026-09-10"), event("rehired", "2026-09-20"), event("dismissed", "2026-10-01"), event("rehired", "2026-10-20")]) current = changeEmploymentStatus(current, e, "2026-10-20");
  assert.equal(current.employmentHistory.length, 4);
  assert.equal(current.monthlyPlanEnabled, false);
  assert.equal(isMonthlyPlanPerson(current), false);
});

test("invalid, future, duplicate and out-of-order employment changes are rejected", () => {
  for (const date of ["", "2026-02-30", "2026-10-21"]) assert.throws(() => changeEmploymentStatus(person(), event("dismissed", date), "2026-10-20"));
  assert.throws(() => changeEmploymentStatus(dismissed(), event("rehired", "2026-10-09"), "2026-10-20"));
  assert.throws(() => changeEmploymentStatus(dismissed(), event("dismissed", "2026-10-10"), "2026-10-20"));
  assert.throws(() => changeEmploymentStatus(person(), event("rehired", "2026-10-20"), "2026-10-20"));
});

test("the last working day is included, and the gap before rehire is excluded", () => {
  const current = changeEmploymentStatus(dismissed(), event("rehired", "2026-10-20"), "2026-10-20");
  assert.equal(isEmployedOnDate(current, "2026-10-09"), true);
  assert.equal(isEmployedOnDate(current, "2026-10-10"), true);
  assert.equal(isEmployedOnDate(current, "2026-10-11"), false);
  assert.equal(isEmployedOnDate(current, "2026-10-19"), false);
  assert.equal(isEmployedOnDate(current, "2026-10-20"), true);
  assert.equal(isEmployedOnDate({ active: false }, "2026-10-20"), false);
  assert.equal(isEmployedOnDate(person(), "2026-10-20"), true);
});

test("archives are unavailable for new flight assignments, and rehire does not allow assignments in the employment gap", () => {
  const input = { assignments: [], busyEntries: [], actualBusy: [], date: "2026-10-15", aircraftType: "R44", aircraft: "RA-04186" };
  assert.equal(isMonthlyPlanPerson(dismissed()), false);
  assert.ok(assignmentBlockReason({ ...input, person: dismissed() }));
  const rehired = changeEmploymentStatus(dismissed(), event("rehired", "2026-10-20"), "2026-10-20");
  assert.ok(assignmentBlockReason({ ...input, person: rehired }));
  assert.equal(assignmentBlockReason({ ...input, date: "2026-10-20", person: rehired }), null);
});

test("archived names remain in stored plans and Excel, without returning to empty future months", () => {
  const people = [dismissed()];
  assert.equal(monthlyPlanPeople(people, "2026-10", [assignment], [], [shift]).length, 1);
  assert.equal(monthlyPlanPeople(people, "2026-11", [assignment], [], [shift]).length, 0);
  const matrix = buildMonthlyPlanMatrix("2026-10", people, [shift], [assignment], []);
  assert.ok(JSON.stringify(matrix).includes("Тестовый И.И."));
});

test("automatic standby and days off are not generated during dismissal gaps", () => {
  const rehired = changeEmploymentStatus(dismissed(), event("rehired", "2026-10-20"), "2026-10-20");
  const dates = ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-19", "2026-10-20"];
  const activities = buildAutomaticPlanActivityMap([rehired], dates, [], [], []);
  assert.ok(activities.has(automaticPlanActivityKey("pilot", "2026-10-10")));
  assert.equal(activities.has(automaticPlanActivityKey("pilot", "2026-10-11")), false);
  assert.equal(activities.has(automaticPlanActivityKey("pilot", "2026-10-19")), false);
  assert.equal(activities.get(automaticPlanActivityKey("pilot", "2026-10-20")), "standby");
});

test("expired documents disappear from current control during archive and return after rehire", () => {
  const record = { id: "medical", personId: "pilot", certificationType: "ВЛЭК", category: "Медицина", aircraftType: "", endDate: "2026-09-01" };
  assert.equal(buildControlRows([dismissed()], [shift], [record], "2026-10-20").length, 0);
  const rehired = changeEmploymentStatus(dismissed(), event("rehired", "2026-10-20"), "2026-10-20");
  assert.ok(buildControlRows([rehired], [shift], [record], "2026-10-20").some(row => row.status === "expired"));
});

test("flight and employment reports include the archived person with historical entries", () => {
  const people = [dismissed()];
  const flight = buildFlightReport("2026-10-01", "2026-10-20", people, [shift]);
  const employment = buildEmploymentReport("2026-10-01", "2026-10-20", people, [shift]);
  assert.ok(JSON.stringify(flight).includes(people[0].name));
  assert.ok(JSON.stringify(employment).includes(people[0].name));
  const before = buildFlightBook("pilot", [shift], [], ["R44"]);
  assert.equal(before.total.totalMinutes, 75);
});

test("backup roundtrip retains archived identity, full employment history and linked data", () => {
  const data = { people: [dismissed()], shifts: [shift], certifications: [{ id: "doc", personId: "pilot" }], personalProfiles: { pilot: { contact: "kept" } } };
  const envelope = JSON.parse(JSON.stringify({ version: 16, data, checksum: backupChecksum(data) }));
  const restored = validateBackupEnvelope(envelope);
  assert.equal(restored.valid, true);
  assert.deepEqual(restored.data, data);
});
