import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkTimeImport,
  mergeImportedWorkTime,
  personMatchKey,
} from "../app/work-time-import-rules.ts";

const day = (hours, minutes = 0) => (hours * 60 + minutes) / 1_440;
const headers = ["Цель полета", "Бортовой №", "Дата", "Начало", "Полетное", "Рабочее", "Конец", "Ночь", "Отдых", "Разделение смены", "Примечание"];

test("work-time import matches full names to sheet initials and expands merged flight cells", () => {
  const people = [{
    id: "pronin",
    name: "Пронин Александр Константинович",
    position: "Командир ВС, Пилот-инструктор",
    aircraftTypes: ["BO105"],
    qualifications: [{ aircraftTypes: ["BO105"], seats: ["Командир ВС", "Пилот-инструктор"] }],
    active: true,
  }];
  const result = buildWorkTimeImport([{
    name: "Пронин А.К.",
    rows: [
      ["Пронин А.К.", null, null, "Полетная смена", null, null, null, 1, null, null, "Примечание"],
      headers,
      ["АОН", "RA-2991G", 46205, day(8, 30), day(1, 10), day(3, 57), day(12, 27), null, null, null, "ПИ Федоров"],
      [null, null, null, day(12, 10), day(1, 5), day(2, 47), day(14, 57), null, null, null, "ПИ Пронин"],
    ],
    merges: [
      { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } },
      { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } },
      { s: { r: 2, c: 2 }, e: { r: 3, c: 2 } },
    ],
  }], people, "2026-07-01");

  assert.equal(personMatchKey("Пронин А.К."), personMatchKey("Пронин Александр Константинович"));
  assert.equal(result.records.length, 1);
  assert.equal(result.flightSegments, 2);
  assert.equal(result.records[0].date, "2026-07-02");
  assert.equal(result.records[0].segments[0].aircraftType, "BO105");
  assert.equal(result.records[0].segments[0].seat, "КВС");
  assert.equal(result.records[0].segments[1].seat, "Пилот-инструктор");
});

test("RA-01619 imports as Bell407 and repeat import does not create duplicates", () => {
  const people = [{
    id: "levochkin",
    name: "Левочкин Виктор Викторович",
    position: "Командир ВС",
    aircraftTypes: ["Bell407"],
    qualifications: [{ aircraftTypes: ["Bell407"], seats: ["Командир ВС"] }],
    active: true,
  }];
  const result = buildWorkTimeImport([{
    name: "RA-01619",
    rows: [
      ["Левочкин В.В.", null, null, "Полетная смена", null, null, null, 1, null, null],
      headers.slice(0, 10),
      ["АОН", "RA-01619", 46224, day(10), day(1), day(2, 40), day(12, 40), null, null, null],
    ],
    merges: [],
  }], people, "2026-07-01");

  assert.equal(result.records[0].segments[0].aircraftType, "Bell407");
  const first = mergeImportedWorkTime([], result.records);
  const second = mergeImportedWorkTime(first.shifts, result.records);
  assert.equal(first.addedSegments, 1);
  assert.equal(first.addedRows, 1);
  assert.equal(second.addedSegments, 0);
  assert.equal(second.addedRows, 0);
  assert.equal(second.addedShifts, 0);
  assert.equal(second.duplicateRows, 1);
});

test("source duplicates are removed and untimed training is imported from the note column", () => {
  const people = [{
    id: "pronin",
    name: "Пронин Александр Константинович",
    position: "Командир ВС",
    aircraftTypes: ["BO105"],
    qualifications: [{ aircraftTypes: ["BO105"], seats: ["Командир ВС"] }],
    active: true,
  }];
  const sameFlight = ["КВП", "RA-02549", 46224, day(7), day(1), day(3), day(10), null, null, null, null];
  const result = buildWorkTimeImport([{
    name: "Пронин А.К.",
    rows: [
      ["Пронин А.К.", null, null, "Полетная смена"],
      headers,
      sameFlight,
      sameFlight,
      [null, null, 46225, null, null, null, null, null, null, null, "Учеба в АУЦ"],
    ],
    merges: [],
  }], people, "2026-07-01");

  const merged = mergeImportedWorkTime([], result.records);
  assert.equal(result.nonFlightRecords, 1);
  assert.equal(merged.addedSegments, 1);
  assert.equal(merged.addedRows, 2);
  assert.equal(merged.duplicateRows, 1);
  assert.equal(merged.shifts.find((shift) => shift.activity === "periodic_training")?.start, "");
});
