import assert from "node:assert/strict";
import test from "node:test";
import { employeeReadiness, readinessBlockReason, readinessForOperator } from "../app/readiness-rules.ts";

const profile = (medicalExpiry = "", override = "auto") => ({
  medical: { expiryDate: medicalExpiry, examinationDate: "2026-01-01", seriesNumber: "1" },
  readiness: { override, reason: override === "auto" ? "" : "Ограничение начальника штаба", until: "2026-09-01" },
});
const record = (endDate) => ({ id: "doc-1", personId: "p1", category: "Подготовка", certificationType: "Квалификационная проверка КВС", aircraftType: "AW139", organization: "", issuedDate: "2026-01-01", startDate: "2026-01-01", endDate, documentType: "Справка", grade: "", series: "", number: "", documentAvailable: "", note: "", source: "manual", sourceFile: "", importedAt: "" });

test("readiness blocks a pilot when a current controlled document is expired", () => {
  const result = employeeReadiness([record("2026-07-01")], profile("2027-01-01"), new Date("2026-08-07T12:00:00"));
  assert.equal(result.status, "not_allowed");
  assert.match(readinessBlockReason(result), /Квалификационная проверка КВС/);
});

test("readiness warns before expiry and accepts a manual override", () => {
  const warning = employeeReadiness([record("2026-08-30")], profile("2027-01-01"), new Date("2026-08-07T12:00:00"));
  assert.equal(warning.status, "restricted");
  const manual = employeeReadiness([record("2027-08-30")], profile("2027-01-01", "not_allowed"), new Date("2026-08-07T12:00:00"));
  assert.equal(manual.status, "not_allowed");
  assert.equal(manual.manual, true);
});

test("readiness stays undetermined until a dated control point exists", () => {
  assert.equal(employeeReadiness([], profile(""), new Date("2026-08-07T12:00:00")).status, "undetermined");
});

test("simulator and cabin training restrict KVP but do not block an AON assignment", () => {
  const simulator = { ...record("2026-07-01"), certificationType: "Тренажерная подготовка" };
  const result = employeeReadiness([simulator], profile("2027-01-01"), new Date("2026-08-07T12:00:00"));
  assert.equal(result.status, "not_allowed");
  assert.equal(readinessForOperator(result, "КВП").status, "not_allowed");
  assert.equal(readinessForOperator(result, "АОН").status, "allowed");
});

test("a type-specific expired document blocks only its own aircraft type", () => {
  const asp = { ...record("2026-07-01"), certificationType: "АСП суша (на типе)", aircraftType: "R66" };
  const result = employeeReadiness([asp], profile("2027-01-01"), new Date("2026-08-07T12:00:00"));
  assert.equal(readinessForOperator(result, "АОН", "R66").status, "not_allowed");
  assert.equal(readinessForOperator(result, "АОН", "R44").status, "allowed");
});

test("a document valid for another 36 days is a warning, not a flight block", () => {
  const asp = { ...record("2026-09-12"), certificationType: "АСП суша (на типе)", aircraftType: "R66" };
  const result = employeeReadiness([asp], profile("2027-01-01"), new Date("2026-08-07T12:00:00"));
  assert.equal(readinessForOperator(result, "АОН", "R66").status, "restricted");
  assert.equal(readinessBlockReason(readinessForOperator(result, "АОН", "R66")), null);
});
