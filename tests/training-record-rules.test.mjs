import assert from "node:assert/strict";
import test from "node:test";
import { canonicalTrainingDocumentName, normalizeTrainingRecord, trainingNameForAircraft } from "../app/training-record-rules.ts";

test("legacy aircraft names in training records use canonical types", () => {
  assert.equal(normalizeTrainingRecord({ aircraftType: "BO-105", certificationType: "КПК на типе ВС" }).aircraftType, "BO105");
  assert.equal(normalizeTrainingRecord({ aircraftType: "AS350 B3", certificationType: "КПК на типе ВС" }).aircraftType, "AS350");
  assert.equal(normalizeTrainingRecord({ aircraftType: "Robinson 66", certificationType: "КПК на типе ВС" }).aircraftType, "R66");
  assert.equal(normalizeTrainingRecord({ aircraftType: "Robinson 44", certificationType: "КПК на типе ВС" }).aircraftType, "R44");
});

test("R44 uses simulator training while other aircraft use cabin training", () => {
  assert.equal(trainingNameForAircraft("Robinson 44", "Тренаж в кабине ВС"), "Тренажерная подготовка");
  assert.equal(trainingNameForAircraft("R66", "Тренажерная подготовка"), "Тренаж в кабине ВС");
  assert.equal(trainingNameForAircraft("AS350 B3", "Тренажерная подготовка"), "Тренаж в кабине ВС");
});

test("legacy qualification check names use the official library names", () => {
  assert.equal(canonicalTrainingDocumentName("Квалификационная проверка"), "Квалификационная проверка КВС");
  assert.equal(canonicalTrainingDocumentName("Квалификац. проверка инструктор"), "Квалификационная проверка Пилот-инструктор");
});
