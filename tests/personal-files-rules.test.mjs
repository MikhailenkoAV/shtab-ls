import assert from "node:assert/strict";
import test from "node:test";
import { getExpiryState, isExpiryAttention } from "../app/personal-files-rules.ts";

const today = new Date(2026, 6, 23);
const record = (endDate) => ({
  endDate,
  issuedDate: "",
  startDate: "",
  organization: "",
  documentType: "",
  number: "",
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
