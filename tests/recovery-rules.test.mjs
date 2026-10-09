import assert from "node:assert/strict";
import test from "node:test";
import { backupChecksum, backupRestoreSummary, changedDataSections, validateBackupEnvelope } from "../app/recovery-rules.ts";

test("recovery history names only changed data sections", () => {
  assert.deepEqual(changedDataSections({ people: [], shifts: [] }, { people: [{ id: "1" }], shifts: [] }), ["Сотрудники"]);
});

test("restore preview distinguishes additions, edits and removals without mutating data", () => {
  const before = { people: [{ id: "old", name: "A" }, { id: "edited", name: "B" }], shifts: [] };
  const after = { people: [{ id: "edited", name: "C" }, { id: "new", name: "D" }], shifts: [] };
  const summary = backupRestoreSummary(before, after);
  assert.equal(summary.length, 1);
  assert.deepEqual(summary[0], { key: "people", label: "Сотрудники", beforeCount: 2, afterCount: 2, added: 1, removed: 1, changed: 1 });
  assert.equal(before.people[0].id, "old");
  assert.deepEqual(backupRestoreSummary(before, before), []);
});

test("legacy backups without checksum remain readable", () => {
  assert.equal(validateBackupEnvelope({ people: [], shifts: [] }).valid, true);
  assert.equal(validateBackupEnvelope({ version: 1, data: { people: [], shifts: [] } }).valid, true);
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
