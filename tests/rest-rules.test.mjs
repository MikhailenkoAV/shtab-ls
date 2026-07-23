import assert from "node:assert/strict";
import test from "node:test";
import {
  activityUsesTime,
  isRestNeutralActivity,
  normalizeActivityTiming,
} from "../app/activity-rules.ts";
import {
  calculateRestIssues,
  DAILY_REST_MINUTES,
  DAY_OFF_REST_MINUTES,
  fixedRestMinutesForActivity,
  isSundayDate,
  SPLIT_REST_MINUTES,
  WEEKLY_REST_MINUTES,
} from "../app/rest-rules.ts";

const time = (value) => new Date(value).getTime();

test("periodic training has no entered time and is neutral for rest control", () => {
  assert.equal(activityUsesTime("periodic_training"), false);
  assert.equal(isRestNeutralActivity("periodic_training"), true);
  assert.deepEqual(normalizeActivityTiming("periodic_training", "08:00", 480), { start: "", workMinutes: 0 });
  assert.deepEqual(normalizeActivityTiming("office", "08:00", 480), { start: "08:00", workMinutes: 480 });
});

test("standby is saved without start and work time", () => {
  assert.equal(activityUsesTime("standby"), false);
  assert.equal(isRestNeutralActivity("standby"), false);
  assert.deepEqual(normalizeActivityTiming("standby", "08:00", 480), { start: "", workMinutes: 0 });
});

test("a recorded day off equals 24 hours of rest", () => {
  assert.equal(DAY_OFF_REST_MINUTES, 24 * 60);
  assert.equal(fixedRestMinutesForActivity("dayoff"), 24 * 60);
  assert.equal(fixedRestMinutesForActivity("vacation"), undefined);
});

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

test("periodic training confirms the rest boundary and resets weekly control", () => {
  const workDays = Array.from({ length: 6 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    return {
      shiftId: `day-${day}`,
      personId: "pilot",
      date: `2026-07-${day}`,
      start: time(`2026-07-${day}T08:00:00`),
      end: time(`2026-07-${day}T17:00:00`),
    };
  });
  const issues = calculateRestIssues([
    ...workDays,
    {
      shiftId: "training",
      personId: "pilot",
      date: "2026-07-07",
      start: time("2026-07-07T00:00:00"),
      end: time("2026-07-07T00:00:00"),
      assumedCompliant: true,
    },
    {
      shiftId: "next-flight",
      personId: "pilot",
      date: "2026-07-08",
      start: time("2026-07-08T08:00:00"),
      end: time("2026-07-08T16:00:00"),
    },
  ], []);
  assert.deepEqual(issues, []);
});

test("periodic training resets the 48-hour split-shift sequence", () => {
  const issues = calculateRestIssues([], [
    { shiftId: "split-one", personId: "pilot", date: "2026-07-01", start: time("2026-07-01T08:00:00"), end: time("2026-07-01T12:00:00"), split: true },
    { shiftId: "split-two", personId: "pilot", date: "2026-07-02", start: time("2026-07-02T08:00:00"), end: time("2026-07-02T12:00:00"), split: true },
    { shiftId: "training", personId: "pilot", date: "2026-07-03", start: time("2026-07-03T00:00:00"), end: time("2026-07-03T00:00:00"), split: false, assumedCompliant: true },
    { shiftId: "next-flight", personId: "pilot", date: "2026-07-03", start: time("2026-07-03T08:00:00"), end: time("2026-07-03T16:00:00"), split: false },
  ]);
  assert.deepEqual(issues, []);
});

test("overlapping work intervals are not shown as rest violations", () => {
  const issues = calculateRestIssues([
    { shiftId: "one", personId: "pilot", date: "2026-07-20", start: time("2026-07-20T08:00:00"), end: time("2026-07-21T12:00:00") },
    { shiftId: "two", personId: "pilot", date: "2026-07-21", start: time("2026-07-21T10:00:00"), end: time("2026-07-21T18:00:00") },
  ], []);
  assert.deepEqual(issues, []);
});
