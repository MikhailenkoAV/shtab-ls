import assert from "node:assert/strict";
import test from "node:test";
import { mergeWorkspaceData } from "../app/cloud-sync.ts";

test("cloud conflict keeps new records from both devices", () => {
  const base = { shifts: [{ id: "old", note: "Базовая" }], settings: { chief: "А" } };
  const local = { shifts: [...base.shifts, { id: "local", note: "Добавлено локально" }], settings: { chief: "А" } };
  const remote = { shifts: [...base.shifts, { id: "remote", note: "Добавлено на другом устройстве" }], settings: { chief: "А" } };
  const merged = mergeWorkspaceData(base, local, remote);
  assert.deepEqual(merged.shifts.map((item) => item.id), ["old", "remote", "local"]);
});

test("three-way merge preserves a deliberate deletion", () => {
  const base = { people: [{ id: "one", name: "Первый" }, { id: "two", name: "Второй" }] };
  const local = { people: [{ id: "two", name: "Второй" }] };
  const remote = structuredClone(base);
  const merged = mergeWorkspaceData(base, local, remote);
  assert.deepEqual(merged.people, [{ id: "two", name: "Второй" }]);
});

test("independent edits of one record are combined", () => {
  const base = { people: [{ id: "pilot", name: "Иванов", division: "", phone: "" }] };
  const local = { people: [{ id: "pilot", name: "Иванов", division: "Лётная служба", phone: "" }] };
  const remote = { people: [{ id: "pilot", name: "Иванов", division: "", phone: "+7" }] };
  const merged = mergeWorkspaceData(base, local, remote);
  assert.deepEqual(merged.people[0], { id: "pilot", name: "Иванов", division: "Лётная служба", phone: "+7" });
});
