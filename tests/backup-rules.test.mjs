import assert from "node:assert/strict";
import test from "node:test";
import { backupFileName } from "../app/backup-rules.ts";

test("backup filename contains the BaseShtab prefix, local date and local time", () => {
  const date = new Date(2026, 6, 28, 9, 5, 7);
  assert.equal(backupFileName(date), "BaseShtab_2026-07-28_09-05-07.json");
});
