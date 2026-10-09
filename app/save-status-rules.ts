export type SaveStatusInput = {
  localSaved: boolean;
  localError: boolean;
  cloudPhase: string;
  cloudPending: boolean;
  cloudSaving: boolean;
  lastCloudSavedAt: string | null;
};

export function workspaceSaveStatus(input: SaveStatusInput) {
  const local = input.localError ? "Ошибка сохранения на устройстве" : input.localSaved ? "На устройстве сохранено" : "Сохраняю на устройстве…";
  const cloud = input.cloudPhase === "conflict" ? "Нужен выбор версии"
    : input.cloudSaving ? "Сохраняю в облаке…"
    : input.cloudPhase === "offline" ? "Нет подключения к облаку"
    : input.cloudPhase === "error" ? "Ошибка синхронизации"
    : input.cloudPending ? "Ожидает отправки в облако"
    : input.lastCloudSavedAt ? "В облаке сохранено"
    : "Проверяю облачную копию…";
  const tone = input.localError || ["error", "conflict"].includes(input.cloudPhase) ? "error"
    : !input.localSaved || input.cloudPending || input.cloudSaving || input.cloudPhase !== "ready" ? "saving" : "saved";
  return { local, cloud, tone };
}
