import assert from "node:assert/strict";
import test from "node:test";
import { getExpiryState } from "../app/personal-files-rules.ts";

const today = new Date(2026, 6, 23);
const record = (endDate) => ({
  endDate,
  issuedDate: "",
  startDate: "",
  organization: "",
  documentType: "",
  number: "",
});

test("personal files split expiry warnings into up to 14 days and 15–45 days", () => {
  assert.equal(getExpiryState(record("2026-08-06"), today).level, "alert14");
  assert.equal(getExpiryState(record("2026-08-07"), today).level, "alert45");
  assert.equal(getExpiryState(record("2026-09-06"), today).level, "alert45");
  assert.equal(getExpiryState(record("2026-09-07"), today).level, "valid");
});
