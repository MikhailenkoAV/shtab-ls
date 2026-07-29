import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlightBook,
  latestFlightBookBaseline,
} from "../app/flight-book-rules.ts";

const baseline = (overrides = {}) => ({
  id: "baseline",
  personId: "pilot",
  date: "2026-06-30",
  source: "Личная лётная книжка",
  note: "",
  createdAt: "2026-07-01T08:00:00.000Z",
  rows: [{
    id: "r44",
    aircraftType: "R44",
    totalMinutes: 600,
    picMinutes: 500,
    secondPilotMinutes: 0,
    instructorMinutes: 100,
    nightMinutes: 50,
    ifrMinutes: 20,
    ifrApproaches: 2,
    note: "",
  }],
  ...overrides,
});

const shift = (overrides = {}) => ({
  id: "shift",
  personId: "pilot",
  date: "2026-07-01",
  activity: "flight",
  segments: [{
    id: "segment",
    aircraft: "RA-04186",
    aircraftType: "R44",
    seat: "КВС",
    purpose: "АОН",
    flightMinutes: 60,
    nightMinutes: 10,
  }],
  ...overrides,
});

test("flight book adds only flights after the latest control point", () => {
  const result = buildFlightBook("pilot", [
    shift({ id: "same-day", date: "2026-06-30" }),
    shift(),
  ], [baseline()], ["R44"]);

  assert.equal(result.total.totalMinutes, 660);
  assert.equal(result.total.picMinutes, 560);
  assert.equal(result.total.instructorMinutes, 100);
  assert.equal(result.total.nightMinutes, 60);
  assert.equal(result.total.ifrMinutes, 20);
  assert.equal(result.total.ifrApproaches, 2);
  assert.equal(result.total.siteMinutes, 60);
  assert.equal(result.entries.length, 1);
});

test("latest control point replaces older accumulated totals", () => {
  const older = baseline({
    id: "older",
    date: "2026-01-01",
    createdAt: "2026-01-01T08:00:00.000Z",
  });
  const newer = baseline({
    id: "newer",
    date: "2026-06-30",
    rows: [{ ...baseline().rows[0], totalMinutes: 900 }],
  });

  assert.equal(latestFlightBookBaseline([older, newer], "pilot")?.id, "newer");
  assert.equal(buildFlightBook("pilot", [], [older, newer]).total.totalMinutes, 900);
});

test("instructor and second-pilot time are assigned by seat", () => {
  const result = buildFlightBook("pilot", [
    shift({
      id: "instructor",
      segments: [{ ...shift().segments[0], id: "one", seat: "Пилот-инструктор", flightMinutes: 90 }],
    }),
    shift({
      id: "second",
      date: "2026-07-02",
      segments: [{ ...shift().segments[0], id: "two", seat: "2П", flightMinutes: 45, nightMinutes: 0 }],
    }),
  ], []);

  assert.equal(result.total.totalMinutes, 135);
  assert.equal(result.total.instructorMinutes, 90);
  assert.equal(result.total.secondPilotMinutes, 45);
  assert.equal(result.total.picMinutes, 0);
});

test("without a control point all journal flights are included", () => {
  const result = buildFlightBook("pilot", [
    shift({ date: "2025-12-31" }),
    shift({ id: "other-person", personId: "other" }),
  ], [], ["R44"]);

  assert.equal(result.baseline, null);
  assert.equal(result.total.totalMinutes, 60);
  assert.equal(result.entries.length, 1);
});

test("an imported baseline can add journal flights from July 2026", () => {
  const result = buildFlightBook("pilot", [
    shift({ id: "june", date: "2026-06-30" }),
    shift({ id: "july", date: "2026-07-01" }),
  ], [baseline({ date: "2026-06-30", siteFlightStartDate: "2026-07-01" })]);
  assert.equal(result.total.totalMinutes, 660);
  assert.deepEqual(result.entries.map((item) => item.date), ["2026-07-01"]);
});
