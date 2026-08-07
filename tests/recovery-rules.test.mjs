import assert from "node:assert/strict";
import test from "node:test";
import { backupChecksum, changedDataSections, validateBackupEnvelope } from "../app/recovery-rules.ts";

test("recovery history names only changed data sections", () => {
  assert.deepEqual(changedDataSections({ people: [], shifts: [] }, { people: [{ id: "1" }], shifts: [] }), ["Сотрудники"]);
});

test("backup integrity check accepts an intact envelope and rejects changed data", () => {
  const data = { people: [], shifts: [], certifications: [] };
  const checksum = backupChecksum(data);
  assert.equal(validateBackupEnvelope({ version: 16, data, checksum }).valid, true);
  assert.deepEqual(validateBackupEnvelope({ version: 16, data: { ...data, people: [{ id: "changed" }] }, checksum }), {
    valid: false,
    error: "Контрольная сумма не совпадает: файл повреждён или изменён",
  });
});
