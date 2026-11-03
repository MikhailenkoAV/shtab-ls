import assert from "node:assert/strict";
import test from "node:test";
import { workTimeDashboardRows } from "../app/work-time-dashboard-rules.ts";
import { expandLinkedCrewShifts } from "../app/crew-rules.ts";

const person = { id: "p", name: "Пилот", active: true };
const time = (value) => new Date(value).getTime();
function day(date, from = "08:00", to = "17:00", extra = {}) {
  return { shiftId: date, personId: "p", date, start: time(`${date}T${from}:00`), end: time(`${date}T${to}:00`), ...extra };
}
function input(days, intervals = []) {
  return { days, intervals, records: days.filter((d) => !d.assumedCompliant).map((d) => ({
    id: d.shiftId, personId: d.personId, date: d.date, activity: "office", workMinutes: (d.end - d.start) / 60_000, startTime: d.start,
  })) };
}
const rowAt = (data, now) => workTimeDashboardRows([person], data, new Date(now))[0];

test("work-time panel counts month and seven calendar days across a month boundary, excluding future and inactive staff", () => {
  const data = input([day("2026-10-27"), day("2026-10-28"), day("2026-11-01"), day("2026-11-03"), day("2026-11-04")]);
  data.records.push({ id: "leave", personId: "p", date: "2026-11-02", activity: "vacation", workMinutes: 480, startTime: null });
  const rows = workTimeDashboardRows([person, { id: "archived", name: "Архив", active: false }], data, new Date("2026-11-03T18:00:00"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].monthMinutes, 18 * 60);
  assert.equal(rows[0].sevenDayMinutes, 27 * 60);
});

test("weekly countdown carries working days from the previous month and clears exactly after 42 hours", () => {
  const data = input(["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"].map((date) => day(date)));
  const due = rowAt(data, "2026-11-03T18:00:00");
  assert.equal(due.cycleDays, 6);
  assert.equal(due.daysUntilWeeklyRest, 0);
  assert.equal(due.severity, "danger");
  assert.equal(due.restKind, "weekly");
  assert.equal(due.restUntil, time("2026-11-05T11:00:00"));
  const complete = rowAt(data, "2026-11-05T11:00:00");
  assert.equal(complete.cycleDays, 0);
  assert.equal(complete.daysUntilWeeklyRest, 6);
  assert.equal(complete.restUntil, null);
  assert.equal(complete.severity, "normal");
});

test("panel warns three working days before weekly rest, including a calendar gap shorter than 42 hours", () => {
  const data = input([day("2026-10-30", "14:00", "23:00"), day("2026-11-01"), day("2026-11-02")]);
  const row = rowAt(data, "2026-11-03T06:00:00");
  assert.equal(row.cycleDays, 3);
  assert.equal(row.daysUntilWeeklyRest, 3);
  assert.equal(row.restUntil, null);
  assert.equal(row.severity, "warning");
});

test("away-from-base daily deadline is 10 hours, ordinary deadline 12 hours, and an overnight boundary is preserved", () => {
  const ordinary = day("2026-11-02", "18:00", "23:00");
  const away = { ...ordinary, dailyRestMinutesAfter: 600 };
  assert.equal(rowAt(input([ordinary]), "2026-11-03T08:00:00").restUntil, time("2026-11-03T11:00:00"));
  assert.equal(rowAt(input([away]), "2026-11-03T08:00:00").restUntil, time("2026-11-03T09:00:00"));
  assert.equal(rowAt(input([away]), "2026-11-03T09:00:00").restUntil, null);
  const overnight = { ...ordinary, end: time("2026-11-03T02:00:00") };
  assert.equal(rowAt(input([overnight]), "2026-11-03T01:00:00").onDuty, true);
  assert.equal(rowAt(input([overnight]), "2026-11-03T03:00:00").restUntil, time("2026-11-03T14:00:00"));
});

test("48-hour split rest is not shortened to daily or weekly rest", () => {
  const days = ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"].map((date) => day(date, "08:00", "17:00", { dailyRestMinutesAfter: 600 }));
  const intervals = days.map((d, index) => ({ ...d, split: index >= 4 }));
  const row = rowAt(input(days, intervals), "2026-11-03T18:00:00");
  assert.equal(row.restKind, "split");
  assert.equal(row.requiredRestMinutes, 48 * 60);
  assert.equal(row.restUntil, time("2026-11-05T17:00:00"));
});

test("periodic-training boundary resets rest tracking and never adds fictitious work hours", () => {
  const days = [day("2026-11-01"), day("2026-11-02"), day("2026-11-03", "00:00", "00:00", { assumedCompliant: true })];
  const row = rowAt(input(days, days.map((d) => ({ ...d, split: !d.assumedCompliant }))), "2026-11-03T12:00:00");
  assert.equal(row.cycleDays, 0);
  assert.equal(row.daysUntilWeeklyRest, null);
  assert.equal(row.restUntil, null);
  assert.equal(row.monthMinutes, 18 * 60);
});

test("missing shift times keep recorded hours but never produce an invented rest deadline", () => {
  const data = { days: [], intervals: [], records: [{ id: "untimed", personId: "p", date: "2026-11-03", activity: "office", workMinutes: 480, startTime: null }] };
  const row = rowAt(data, "2026-11-03T12:00:00");
  assert.equal(row.monthMinutes, 480);
  assert.equal(row.hasUntimedWork, true);
  assert.equal(row.restUntil, null);
  assert.equal(row.daysUntilWeeklyRest, null);
  assert.equal(row.severity, "warning");
});

test("shared crew work is counted for each employee without losing the commander's hours", () => {
  const shifts = expandLinkedCrewShifts([{ id: "crew", personId: "p", date: "2026-11-03", activity: "flight", start: "08:00", workMinutes: 480,
    segments: [{ seat: "Пилот-инструктор", commanderPersonId: "commander", dutyStart: "08:00", dutyEnd: "16:00" }] }]);
  const data = { days: [], intervals: [], records: shifts.map((s) => ({ ...s, startTime: time(`${s.date}T${s.start}:00`) })) };
  const rows = workTimeDashboardRows([person, { id: "commander", name: "Командир", active: true }], data, new Date("2026-11-03T18:00:00"));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.monthMinutes), [480, 480]);
});

test("current-month rest violations remain visible, but previous-month violations and future starts are excluded", () => {
  const data = input([day("2026-10-27", "08:00", "23:00"), day("2026-10-28"), day("2026-11-01", "08:00", "23:00"), day("2026-11-02"), day("2026-11-03", "23:00", "23:30")]);
  const row = rowAt(data, "2026-11-03T18:00:00");
  assert.equal(row.issues.length, 1);
  assert.equal(row.issues[0].date, "2026-11-02");
  assert.equal(row.severity, "danger");
  assert.equal(row.monthMinutes, 24 * 60);
});
