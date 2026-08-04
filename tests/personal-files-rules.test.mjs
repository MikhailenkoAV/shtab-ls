import assert from "node:assert/strict";
import test from "node:test";
import { getExpiryState, isExpiryAttention, isMedicalCertificationSuperseded, latestCertificationRecords } from "../app/personal-files-rules.ts";

const today = new Date(2026, 6, 23);
const record = (endDate) => ({
  endDate,
  issuedDate: "",
  startDate: "",
  organization: "",
  documentType: "",
  number: "",
});

test("a current medical profile supersedes an older imported VLEK expiry", () => {
  const oldVlek = {
    ...record("2026-08-02"),
    category: "Ограничение",
    certificationType: "ВЛЭК",
    documentType: "Медицинское заключение",
  };
  assert.equal(isMedicalCertificationSuperseded(oldVlek, "2027-01-29"), true);
  assert.equal(isMedicalCertificationSuperseded(oldVlek, "2026-07-29"), false);
  assert.equal(isMedicalCertificationSuperseded({ ...oldVlek, certificationType: "Квалификационная проверка", documentType: "Задание" }, "2027-01-29"), false);
});

test("only the newest document of the same kind and aircraft type participates in warnings", () => {
  const records = [
    { id: "old", ...record("2026-07-01"), startDate: "2025-07-02", certificationType: "Квалификац. проверка инструктор", documentType: "Задание", aircraftType: "AW139" },
    { id: "new", ...record("2027-07-01"), startDate: "2026-07-02", certificationType: "Квалификационная проверка Пилот-инструктор", documentType: "Задание", aircraftType: "AW139" },
    { id: "other-type", ...record("2026-07-01"), startDate: "2025-07-02", certificationType: "Квалификац. проверка инструктор", documentType: "Задание", aircraftType: "AS350" },
  ];
  assert.deepEqual(latestCertificationRecords(records).map((item) => item.id).sort(), ["new", "other-type"]);
});

test("empty Aviabit headings do not increase the personal-file warning badge", () => {
  const emptyId = { ...record(""), issuedDate: "", certificationType: "ID-карта" };
  const emptyInstructorTraining = { ...record(""), issuedDate: "", certificationType: "Подготовка летно-инструкторского состава ГА" };
  assert.equal(getExpiryState(emptyId, today).level, "incomplete");
  assert.equal(isExpiryAttention(emptyId, today), false);
  assert.equal(isExpiryAttention(emptyInstructorTraining, today), false);
  assert.equal(isExpiryAttention(record("2026-08-06"), today), true);
});

test("personal files split expiry warnings into up to 14 days and 15–45 days", () => {
  assert.equal(getExpiryState(record("2026-08-06"), today).level, "alert14");
  assert.equal(getExpiryState(record("2026-08-07"), today).level, "alert45");
  assert.equal(getExpiryState(record("2026-09-06"), today).level, "alert45");
  assert.equal(getExpiryState(record("2026-09-07"), today).level, "valid");
});
