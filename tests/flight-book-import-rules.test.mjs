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
