import assert from "node:assert/strict";
import test from "node:test";
import { JOURNAL_COLUMNS, MAX_JOURNAL_COLUMN_WIDTH, columnWidth, journalColumnWidths } from "../app/journal-column-rules.ts";

test("saved widths restore all columns while unknown and missing keys keep safe defaults", () => {
  const restored = journalColumnWidths({ person: 320, note: 450, unknown: 777 });
  assert.equal(restored.person, 320);
  assert.equal(restored.note, 450);
  assert.equal(restored.actions, 132);
  assert.equal(Object.keys(restored).length, JOURNAL_COLUMNS.length);
  assert.deepEqual(journalColumnWidths(JSON.parse(JSON.stringify(restored))), restored);
});

test("invalid saved preferences never produce missing, negative or unbounded columns", () => {
  for (const value of [undefined, null, [], "bad", 25]) assert.deepEqual(journalColumnWidths(value), journalColumnWidths());
  assert.equal(columnWidth("person", -1000), 128);
  assert.equal(columnWidth("note", 100000), MAX_JOURNAL_COLUMN_WIDTH);
  for (const value of [NaN, Infinity, null, "200"]) assert.equal(columnWidth("note", value), 210);
  assert.equal(columnWidth("person", 251.4), 251);
});
