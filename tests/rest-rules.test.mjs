import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRestIssues,
  DAILY_REST_MINUTES,
  isSundayDate,
  SPLIT_REST_MINUTES,
  WEEKLY_REST_MINUTES,
} from "../app/rest-rules.ts";

const time = (value) => new Date(value).getTime();

test("periodic-training calendar recognizes Sunday", () => {
  assert.equal(isSundayDate("2026-07-26"), true);
  assert.equal(isSundayDate("2026-07-27"), false);
});

test("daily control reports rest below 12 hours", () => {
  const issues = calculateRestIssues([
    { shiftId: "one", personId: "pilot", date: "2026-07-20", start: time("2026-07-20T08:00:00"), end: time("2026-07-20T20:00:00") },
    { shiftId: "two", personId: "pilot", date: "2026-07-21", start: time("2026-07-21T07:00:00"), end: time("2026-07-21T15:00:00") },
  ], []);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "daily");
  assert.equal(issues[0].requiredMinutes, DAILY_REST_MINUTES);
  assert.equal(issues[0].actualMinutes, 11 * 60);
});

test("weekly control requires 42 hours after six work days", () => {
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return {
      shiftId: `day-${day}`,
      personId: "pilot",
      date: `2026-07-${day}`,
      start: time(`2026-07-${day}T08:00:00`),
      end: time(`2026-07-${day}T17:00:00`),
    };
  });
  const issues = calculateRestIssues(days, []);
  const weekly = issues.find((issue) => issue.kind === "weekly");
  assert.ok(weekly);
  assert.equal(weekly.shiftId, "day-07");
  assert.equal(weekly.requiredMinutes, WEEKLY_REST_MINUTES);
  assert.equal(weekly.actualMinutes, 15 * 60);
});

test("48 hours are required after two consecutive split shifts", () => {
  const issues = calculateRestIssues([], [
    { shiftId: "split-one", personId: "pilot", date: "2026-07-01", start: time("2026-07-01T08:00:00"), end: time("2026-07-01T12:00:00"), split: true },
    { shiftId: "split-two", personId: "pilot", date: "2026-07-02", start: time("2026-07-02T08:00:00"), end: time("2026-07-02T12:00:00"), split: true },
    { shiftId: "next", personId: "pilot", date: "2026-07-03", start: time("2026-07-03T08:00:00"), end: time("2026-07-03T16:00:00"), split: false },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "split");
  assert.equal(issues[0].shiftId, "next");
  assert.equal(issues[0].requiredMinutes, SPLIT_REST_MINUTES);
  assert.equal(issues[0].actualMinutes, 20 * 60);
});

test("overlapping work intervals are not shown as rest violations", () => {
  const issues = calculateRestIssues([
    { shiftId: "one", personId: "pilot", date: "2026-07-20", start: time("2026-07-20T08:00:00"), end: time("2026-07-21T12:00:00") },
    { shiftId: "two", personId: "pilot", date: "2026-07-21", start: time("2026-07-21T10:00:00"), end: time("2026-07-21T18:00:00") },
  ], []);
  assert.deepEqual(issues, []);
});
