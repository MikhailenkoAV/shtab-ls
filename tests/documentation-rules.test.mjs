import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DEFAULT_TRAINING_PROGRAMS,
  normalizeDocumentSettings,
  nextRegistryNumber,
  splitPersonName,
} from "../app/documentation-rules.ts";

const seed = JSON.parse(fs.readFileSync(new URL("../app/document-registry-seed.json", import.meta.url), "utf8"));

test("current personnel registry is preloaded from the supplied workbook", () => {
  assert.equal(seed.length, 167);
  assert.ok(seed.some((record) => record.kind === "order" && record.number === "13/24-ЛС"));
  assert.ok(seed.some((record) => record.kind === "certificate" && record.number === "33-ЛС"));
});

test("AUC program library is populated with program kind and hours", () => {
  const settings = normalizeDocumentSettings({});
  assert.equal(DEFAULT_TRAINING_PROGRAMS.length, 28);
  const program = "Подготовка членов летных экипажей в области человеческого фактора и управления ресурсами экипажа в кабине воздушного судна";
  assert.deepEqual(settings.trainingProgramHours[program], ["40", "16"]);
  assert.equal(settings.trainingProgramKinds[program], "Первоначальное обучение / Повышение квалификации");
});

test("next registry number uses the selected section and year", () => {
  const records = [
    { id: "1", kind: "certificate", number: "31-ЛС", date: "2026-06-01", subject: "", createdAt: "" },
    { id: "2", kind: "certificate", number: "33-ЛС", date: "2026-07-03", subject: "", createdAt: "" },
    { id: "3", kind: "certificate", number: "99-ЛС", date: "2025-07-03", subject: "", createdAt: "" },
  ];
  assert.equal(nextRegistryNumber(records, "certificate", "2026-07-28"), "34-ЛС");
  assert.equal(nextRegistryNumber(records, "protocol", "2026-07-28"), "1/ЛС");
});

test("pilot name is split for the bilingual licence appendix", () => {
  assert.deepEqual(splitPersonName("Пронин Александр Константинович"), {
    lastName: "Пронин",
    firstName: "Александр",
    patronymic: "Константинович",
  });
});
