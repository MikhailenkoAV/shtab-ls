import assert from "node:assert/strict";
import test from "node:test";
import { mergeWorkspaceData, mergeWorkspaceWithConflicts, resolveWorkspaceConflicts } from "../app/cloud-sync.ts";

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

test("simultaneous field edits require a choice while independent fields survive", () => {
  const base = { people: [{ id: "pilot", name: "Иванов", note: "", phone: "" }] };
  const local = { people: [{ ...base.people[0], name: "Локальная версия", note: "На устройстве" }] };
  const remote = { people: [{ ...base.people[0], name: "Облачная версия", phone: "+7" }] };
  const merged = mergeWorkspaceWithConflicts(base, local, remote);
  assert.equal(merged.conflicts.length, 1);
  assert.deepEqual(merged.conflicts[0].path, [{ key: "people" }, { id: "pilot" }, { key: "name" }]);
  const resolved = resolveWorkspaceConflicts(merged.data, merged.conflicts, { [merged.conflicts[0].id]: "remote" });
  assert.deepEqual(resolved.people[0], { id: "pilot", name: "Облачная версия", note: "На устройстве", phone: "+7" });
  assert.equal(local.people[0].name, "Локальная версия");
  assert.equal(merged.data.people[0].name, "Локальная версия");
});

test("no conflicting changes merge without asking for a version", () => {
  const base = { shifts: [{ id: "old", note: "" }] };
  const local = { shifts: [...base.shifts, { id: "local", note: "L" }] };
  const remote = { shifts: [...base.shifts, { id: "remote", note: "R" }] };
  const merged = mergeWorkspaceWithConflicts(base, local, remote);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.data.shifts.length, 3);
});

test("delete versus edit on another device can restore or delete the record", () => {
  const base = { people: [{ id: "one", name: "Before" }] };
  const local = { people: [] };
  const remote = { people: [{ id: "one", name: "Updated" }] };
  const merged = mergeWorkspaceWithConflicts(base, local, remote);
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.conflicts[0].localPresent, false);
  assert.deepEqual(resolveWorkspaceConflicts(merged.data, merged.conflicts, { [merged.conflicts[0].id]: "remote" }), remote);
  assert.deepEqual(resolveWorkspaceConflicts(merged.data, merged.conflicts, { [merged.conflicts[0].id]: "local" }), local);
  const reversed = mergeWorkspaceWithConflicts(base, remote, local);
  assert.deepEqual(resolveWorkspaceConflicts(reversed.data, reversed.conflicts, { [reversed.conflicts[0].id]: "remote" }), local);
});

test("all conflicts must be explicitly resolved", () => {
  const merged = mergeWorkspaceWithConflicts({ settings: { name: "A" } }, { settings: { name: "B" } }, { settings: { name: "C" } });
  assert.throws(() => resolveWorkspaceConflicts(merged.data, merged.conflicts, {}), /Выберите версию/);
});

test("nested flight and operator conflicts preserve unrelated new records", () => {
  const base = { shifts: [{ id: "shift", segments: [{ id: "leg", flightMinutes: 10 }] }], fleet: [{ id: "board", operators: ["АОН"] }] };
  const local = { shifts: [{ id: "shift", segments: [{ id: "leg", flightMinutes: 20 }, { id: "new", flightMinutes: 5 }] }], fleet: [{ id: "board", operators: ["АОН", "КВП"] }] };
  const remote = { shifts: [{ id: "shift", segments: [{ id: "leg", flightMinutes: 30 }] }], fleet: [{ id: "board", operators: ["АОН", "АР"] }] };
  const merged = mergeWorkspaceWithConflicts(base, local, remote);
  assert.equal(merged.conflicts.length, 2);
  const choices = Object.fromEntries(merged.conflicts.map((item) => [item.id, "remote"]));
  const resolved = resolveWorkspaceConflicts(merged.data, merged.conflicts, choices);
  assert.equal(resolved.shifts[0].segments[0].flightMinutes, 30);
  assert.equal(resolved.shifts[0].segments[1].id, "new");
  assert.deepEqual(resolved.fleet[0].operators, ["АОН", "АР"]);
});

test("identical edits and unchanged deletions do not generate false conflicts", () => {
  const base = { people: [{ id: "one", name: "A" }, { id: "two", name: "B" }] };
  const local = { people: [{ id: "one", name: "C" }] };
  const remote = { people: [{ id: "one", name: "C" }, base.people[1]] };
  const merged = mergeWorkspaceWithConflicts(base, local, remote);
  assert.equal(merged.conflicts.length, 0);
  assert.deepEqual(merged.data, local);
});
