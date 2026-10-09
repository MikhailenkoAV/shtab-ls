import assert from "node:assert/strict";
import test from "node:test";
import { workspaceSaveStatus } from "../app/save-status-rules.ts";

const saved = { localSaved: true, localError: false, cloudPhase: "ready", cloudPending: false, cloudSaving: false, lastCloudSavedAt: "2026-10-09T10:00:00Z" };
test("cloud status is not confirmed before the response or while new changes wait", () => {
  assert.equal(workspaceSaveStatus({ ...saved, cloudPending: true }).cloud, "Ожидает отправки в облако");
  assert.equal(workspaceSaveStatus({ ...saved, cloudSaving: true }).cloud, "Сохраняю в облаке…");
  assert.equal(workspaceSaveStatus({ ...saved, lastCloudSavedAt: null }).cloud, "Проверяю облачную копию…");
  assert.equal(workspaceSaveStatus(saved).cloud, "В облаке сохранено");
});
test("local save errors stay visible even when cloud succeeded", () => {
  const result = workspaceSaveStatus({ ...saved, localError: true });
  assert.equal(result.tone, "error");
  assert.equal(result.local, "Ошибка сохранения на устройстве");
});
test("offline and conflict states never show successful cloud synchronization", () => {
  assert.equal(workspaceSaveStatus({ ...saved, cloudPhase: "offline" }).cloud, "Нет подключения к облаку");
  assert.equal(workspaceSaveStatus({ ...saved, cloudPhase: "conflict" }).cloud, "Нужен выбор версии");
  assert.equal(workspaceSaveStatus({ ...saved, localSaved: false }).local, "Сохраняю на устройстве…");
});
