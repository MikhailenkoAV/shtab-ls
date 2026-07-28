import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_PILOT_PERSONAL_PROFILE,
  normalizePilotPersonalProfile,
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
