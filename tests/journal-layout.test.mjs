import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("journal columns use semantic classes independent of merged date cells", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const journal = page.slice(page.indexOf("function ShiftsView("), page.indexOf("function RestCell("));
  assert.ok(journal.includes("rowSpan={dateCells[rowIndex].rowSpan}"));
  assert.equal((journal.match(/className="note-cell journal-note-col"/g) ?? []).length, 3);
  assert.equal((journal.match(/className="journal-actions-col"/g) ?? []).length, 4);
  assert.ok(journal.includes('className="journal-night-col"'));
  assert.ok(css.includes(".journal-table .journal-night-col"));
  assert.equal(/\.journal-table[^{}]*(?:nth-child|nth-last-child|last-child)/.test(css), false);
});

test("backup import opens preview and saves a checkpoint before replacement", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const importFunction = page.slice(page.indexOf("function importBackup("), page.indexOf("async function confirmBackupRestore("));
  assert.ok(importFunction.includes("setBackupPreview("));
  assert.equal(importFunction.includes("setData(restored)"), false);
  const confirmFunction = page.slice(page.indexOf("async function confirmBackupRestore("), page.indexOf("const cloudPending="));
  assert.ok(confirmFunction.indexOf("await saveCheckpoints(") < confirmFunction.indexOf("await saveData(restored)"));
  assert.ok(confirmFunction.indexOf("await saveData(restored)") < confirmFunction.indexOf("setData(restored)"));
});
