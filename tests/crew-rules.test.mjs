import assert from "node:assert/strict";
import test from "node:test";
import { crewDutyMinutes, expandLinkedCrewShifts, linkedCrewShiftId } from "../app/crew-rules.ts";

test("time marked as excluded is removed from counted working time", () => {
  assert.equal(crewDutyMinutes([{
    dutyStart: "08:00",
    dutyEnd: "16:00",
    excludedWorkMinutes: 90,
  }]), 390);
});

test("an instructor flight creates one linked commander journal shift without duplicating the stored shift", () => {
  const shifts = [{
    id: "shared",
    personId: "instructor",
    date: "2026-07-19",
    activity: "flight",
    start: "08:00",
    workMinutes: 480,
    segments: [{
      id: "flight",
      seat: "Пилот-инструктор",
      commanderPersonId: "commander",
      dutyStart: "08:00",
      dutyEnd: "16:00",
      flightMinutes: 120,
    }],
  }];
  const expanded = expandLinkedCrewShifts(shifts);

  assert.equal(shifts.length, 1);
  assert.equal(expanded.length, 2);
  assert.equal(expanded[0].personId, "instructor");
  assert.equal(expanded[1].id, linkedCrewShiftId("shared", "commander"));
  assert.equal(expanded[1].personId, "commander");
  assert.equal(expanded[1].segments[0].seat, "КВС");
  assert.equal(expanded[1].workMinutes, 8 * 60);
  assert.equal(expanded[1].linkedSourceShiftId, "shared");
});

test("the same commander receives one linked shift with all assigned segments", () => {
  const expanded = expandLinkedCrewShifts([{
    id: "shared",
    personId: "instructor",
    activity: "flight",
    segments: [
      { id: "one", seat: "Пилот-инструктор", commanderPersonId: "commander", dutyStart: "08:00", dutyEnd: "12:00" },
      { id: "two", seat: "Пилот-инструктор", commanderPersonId: "commander", dutyStart: "13:00", dutyEnd: "17:00" },
    ],
  }]);

  assert.equal(expanded.length, 2);
  assert.equal(expanded[1].segments.length, 2);
  assert.equal(expanded[1].workMinutes, 8 * 60);
});
