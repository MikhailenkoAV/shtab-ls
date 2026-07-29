import test from "node:test";
import assert from "node:assert/strict";
import { importDurationMinutes, parseFlightBookImport } from "../app/flight-book-import-rules.ts";

test("flight-book import recognizes a standard cumulative-hours table", () => {
  const preview = parseFlightBookImport([
    ["По состоянию на: 01.07.2026"],
    ["Тип ВС", "Общий", "КВС", "2-й пилот", "Пилот-инструктор", "Ночь", "ППП", "Заходы ППП"],
    ["AS350", "125:30", "100:00", "15:30", "10:00", "12:10", "4:20", 8],
  ], "Налет.xlsx", ["AS350"]);
  assert.equal(preview.date, "2026-07-01");
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].totalMinutes, 7530);
  assert.equal(preview.rows[0].secondPilotMinutes, 930);
  assert.equal(preview.rows[0].ifrApproaches, 8);
  assert.equal(preview.issues.length, 0);
});

test("flight-book import blocks impossible night time and flags unknown type", () => {
  const preview = parseFlightBookImport([
    ["Тип ВС", "Общий", "КВС", "Ночь"],
    ["Bell429", "1:00", "1:00", "2:00"],
  ], "source.xlsx", ["AS350"]);
  assert.equal(preview.issues.some((item) => item.level === "error"), true);
  assert.equal(preview.issues.some((item) => item.level === "warning"), true);
});

test("duration parser accepts Excel fractions, decimal hours and compact time", () => {
  assert.equal(importDurationMinutes(0.5), 720);
  assert.equal(importDurationMinutes(1.5), 90);
  assert.equal(importDurationMinutes("1230"), 750);
});

test("monthly ELK table aggregates PIC, instructor and night time by aircraft type", () => {
  const preview = parseFlightBookImport([
    [2025, "", "", "", "", "", "2026 (ЦА Солярис)", "", "", "", "", ""],
    ["Месяц", "Тип ВС", "Налет", "в т.ч. ночью", "Вид работ", "В качестве кого летал", "Месяц", "Тип ВС", "Налет", "в т.ч. ночью", "Вид работ", "В качестве кого летал"],
    ["декабрь", "ВО105", "2:30", "0:20", "АОН", "ПИ", "январь", "AS350", "7:57", "", "КВП", "КВС"],
    ["ИТОГО", "", "2:30", "0:20", "", "", "февраль", "AS350", "1:02", "0:15", "АОН", "ПИ"],
  ], "ЭЛК.xlsx", ["BO105", "AS350"]);
  assert.equal(preview.format, "monthly");
  assert.equal(preview.date, "2026-02-28");
  assert.deepEqual(preview.rows.map((row) => ({
    type: row.aircraftType,
    total: row.totalMinutes,
    pic: row.picMinutes,
    instructor: row.instructorMinutes,
    night: row.nightMinutes,
  })), [
    { type: "AS350", total: 539, pic: 477, instructor: 62, night: 15 },
    { type: "BO105", total: 150, pic: 0, instructor: 150, night: 20 },
  ]);
  assert.equal(preview.issues.length, 0);
});
