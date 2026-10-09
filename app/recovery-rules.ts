export type RecoveryCheckpoint<T> = {
  id: string;
  createdAt: string;
  sections: string[];
  snapshot: T;
};

export type TrashKind = "person" | "shift" | "shiftSnapshot" | "certification" | "baseline" | "externalFlight" | "registry" | "medicalReferral" | "planAssignment" | "planBusy";

export type TrashEntry = {
  id: string;
  kind: TrashKind;
  label: string;
  deletedAt: string;
  payload: unknown;
};

export const sectionLabels: Record<string, string> = {
  people: "Сотрудники",
  shifts: "Полётные смены",
  certifications: "Личные дела",
  planAssignments: "Месячный план",
  planBusyEntries: "Занятость",
  settings: "Настройки предприятия",
  aircraftFleet: "Парк ВС",
  documentRegistry: "Реестр документов",
  medicalReferrals: "Медицинские направления",
  documentProfiles: "Анкетные данные",
  documentSettings: "Справочники документов",
  flightBookBaselines: "Исходный налёт",
  externalFlightRecords: "Налёт по справкам",
  personalProfiles: "Карточки сотрудников",
  personalDocumentDefinitions: "Библиотека документов",
  trash: "Корзина",
};

export function backupRestoreSummary(previous: Record<string, unknown>, next: Record<string, unknown>) {
  return Object.keys(sectionLabels).filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key])).map((key) => {
    const before = previous[key];
    const after = next[key];
    const count = (value: unknown) => Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : null;
    const beforeCount = count(before);
    const afterCount = count(after);
    const beforeMap = Array.isArray(before) ? new Map(before.filter((item) => item?.id).map((item) => [item.id, item])) : null;
    const afterMap = Array.isArray(after) ? new Map(after.filter((item) => item?.id).map((item) => [item.id, item])) : null;
    return {
      key, label: sectionLabels[key], beforeCount, afterCount,
      added: beforeMap && afterMap ? [...afterMap.keys()].filter((id) => !beforeMap.has(id)).length : null,
      removed: beforeMap && afterMap ? [...beforeMap.keys()].filter((id) => !afterMap.has(id)).length : null,
      changed: beforeMap && afterMap ? [...afterMap.keys()].filter((id) => beforeMap.has(id) && JSON.stringify(beforeMap.get(id)) !== JSON.stringify(afterMap.get(id))).length : null,
    };
  });
}

export function changedDataSections(previous: Record<string, unknown>, next: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter((key) => key !== "personalDocumentDefinitionsVersion" && JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
    .map((key) => sectionLabels[key] ?? key);
}

export function backupChecksum(data: unknown): string {
  const text = JSON.stringify(data);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function validateBackupEnvelope(value: unknown): { valid: true; data: Record<string, unknown> } | { valid: false; error: string } {
  if (!value || typeof value !== "object") return { valid: false, error: "Файл не содержит базу данных" };
  const envelope = value as { data?: unknown; checksum?: unknown };
  const data = (envelope.data ?? value) as Record<string, unknown>;
  if (!data || typeof data !== "object" || !Array.isArray(data.people) || !Array.isArray(data.shifts)) {
    return { valid: false, error: "В файле отсутствуют сотрудники или полётные смены" };
  }
  if (typeof envelope.checksum === "string" && backupChecksum(data) !== envelope.checksum) {
    return { valid: false, error: "Контрольная сумма не совпадает: файл повреждён или изменён" };
  }
  return { valid: true, data };
}
