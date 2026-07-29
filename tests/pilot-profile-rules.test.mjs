import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDocumentEndDate,
  DEFAULT_PERSONAL_DOCUMENT_DEFINITIONS,
  EMPTY_PILOT_PERSONAL_PROFILE,
  migratePersonalDocumentDefinitions,
  normalizePilotPersonalProfile,
  PERSONAL_DOCUMENT_DEFINITIONS_VERSION,
  periodicMedicalDates,
} from "../app/pilot-profile-rules.ts";

test("personal profile migration fills newly added nested fields", () => {
  const profile = normalizePilotPersonalProfile({
    division: "Лётная служба",
    medical: { medicalClass: "1" },
  });
  assert.equal(profile.division, "Лётная служба");
  assert.equal(profile.medical.medicalClass, "1");
  assert.equal(profile.medical.periodicIntervalMonths, 6);
  assert.deepEqual(profile.medical.periodicChecks, []);
  assert.deepEqual(profile.personalInfo, EMPTY_PILOT_PERSONAL_PROFILE.personalInfo);
});

test("periodic medical dates stop before the medical expiry date", () => {
  assert.deepEqual(periodicMedicalDates({
    medicalClass: "1",
    seriesNumber: "123",
    examinationDate: "2026-01-01",
    expiryDate: "2027-01-01",
    periodicIntervalMonths: 3,
    periodicChecks: [],
  }), ["2026-04-01", "2026-07-01", "2026-10-01"]);
});

test("six-month periodic medical check produces one intermediate date", () => {
  assert.deepEqual(periodicMedicalDates({
    medicalClass: "1",
    seriesNumber: "123",
    examinationDate: "2026-01-01",
    expiryDate: "2027-01-01",
    periodicIntervalMonths: 6,
    periodicChecks: [],
  }), ["2026-07-01"]);
});

test("document library contains the approved training and licence names", () => {
  const names = DEFAULT_PERSONAL_DOCUMENT_DEFINITIONS.map((item) => item.name);
  [
    "Авиационная безопасность",
    "Английский язык",
    "АСП вода",
    "АСП суша (на типе)",
    "КПК на типе ВС",
    "Опасные грузы",
    "Человеческий фактор",
    "Квалификационная проверка КВС",
    "Квалификационная проверка Пилот-инструктор",
    "Тренаж в кабине ВС",
    "Тренажерная подготовка",
    "Свидетельство частного пилота",
    "Свидетельство коммерческого пилота",
    "Свидетельство линейного пилота",
    "Валидация",
  ].forEach((name) => assert.ok(names.includes(name), `missing definition: ${name}`));
});

test("training validity is calculated from issue date", () => {
  const byId = Object.fromEntries(DEFAULT_PERSONAL_DOCUMENT_DEFINITIONS.map((item) => [item.id, item]));
  assert.equal(calculateDocumentEndDate("2026-01-31", byId["periodic-aviation-security"]), "2029-01-31");
  assert.equal(calculateDocumentEndDate("2026-01-31", byId["flight-cabin"]), "2026-05-01");
  assert.equal(calculateDocumentEndDate("2026-02-28", byId["flight-simulator"]), "2026-09-28");
  assert.equal(calculateDocumentEndDate("2026-07-01", byId["periodic-type"], "КВП"), "2027-07-01");
  assert.equal(calculateDocumentEndDate("2026-07-01", byId["periodic-type"], "АОН"), "2031-07-01");
  assert.equal(DEFAULT_PERSONAL_DOCUMENT_DEFINITIONS.some((item) => item.name === "ВЛЭК"), false);
});

test("legacy document library is upgraded while custom rows are preserved", () => {
  const migrated = migratePersonalDocumentDefinitions([
    { id: "flight-proficiency", name: "Квалификационная проверка", category: "Лётная подготовка", group: "flight_training" },
    { id: "custom-row", name: "Собственный документ", category: "Допуск", group: "other" },
  ], 0);
  assert.ok(migrated.some((item) => item.name === "Квалификационная проверка КВС"));
  assert.ok(migrated.some((item) => item.id === "custom-row"));
  assert.equal(migrated.some((item) => item.id === "flight-proficiency"), false);

  const current = migratePersonalDocumentDefinitions(
    [{ id: "custom-only", name: "Оставить как есть", category: "Своя", group: "other" }],
    PERSONAL_DOCUMENT_DEFINITIONS_VERSION,
  );
  assert.deepEqual(current.map((item) => item.id), ["custom-only"]);
});
