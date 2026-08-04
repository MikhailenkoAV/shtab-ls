export type ExpiryRecordRef = {
  endDate: string;
  issuedDate: string;
  startDate: string;
  organization: string;
  documentType: string;
  number: string;
};

export type CertificationHistoryRef = ExpiryRecordRef & {
  id: string;
  category?: string;
  certificationType?: string;
  aircraftType?: string;
};

export type ExpiryState = {
  level: "expired" | "alert14" | "alert45" | "valid" | "undated" | "incomplete";
  label: string;
  days: number | null;
};

export function getExpiryState(record: ExpiryRecordRef, today = new Date()): ExpiryState {
  if (!record.endDate) {
    const hasData = Boolean(record.issuedDate || record.startDate || record.organization || record.documentType || record.number);
    return hasData ? { level: "undated", label: "Без срока", days: null } : { level: "incomplete", label: "Нет данных", days: null };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(record.endDate);
  if (!match) return { level: "incomplete", label: "Проверьте дату", days: null };
  const days = Math.round((Date.UTC(+match[1], +match[2] - 1, +match[3]) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
  if (days < 0) return { level: "expired", label: `Просрочено ${Math.abs(days)} дн.`, days };
  if (days <= 14) return { level: "alert14", label: days === 0 ? "Истекает сегодня" : `Осталось ${days} дн.`, days };
  if (days <= 45) return { level: "alert45", label: `Осталось ${days} дн.`, days };
  return { level: "valid", label: "Действует", days };
}

export function isExpiryAttention(record: ExpiryRecordRef, today = new Date()): boolean {
  if (!record.endDate) return false;
  return ["expired", "alert14", "alert45", "incomplete"].includes(getExpiryState(record, today).level);
}

export function isMedicalCertificationSuperseded(
  record: ExpiryRecordRef & { category?: string; certificationType?: string },
  currentMedicalExpiry: string,
): boolean {
  if (!currentMedicalExpiry) return false;
  const title = `${record.category ?? ""} ${record.certificationType ?? ""} ${record.documentType}`;
  if (!/влэк|медицинск.*заключ/i.test(title)) return false;
  return !record.endDate || currentMedicalExpiry > record.endDate;
}

function normalizedCertificationName(record: CertificationHistoryRef): string {
  const value = `${record.certificationType ?? ""} ${record.documentType ?? ""}`
    .toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
  if (/влэк|медицинск.*заключ/.test(value)) return "medical";
  if (/квалификац.*провер.*инструкт|проверка пилот инструктор/.test(value)) return "qualification-instructor";
  if (/квалификац.*провер/.test(value)) return "qualification-pic";
  if (/асп.*суш/.test(value)) return "asp-land";
  if (/асп.*вод/.test(value)) return "asp-water";
  if (/кпк.*тип/.test(value)) return "type-recurrent";
  if (/человеческ.*фактор|crm/.test(value)) return "human-factor";
  if (/авиацион.*безопас/.test(value)) return "aviation-security";
  if (/опасн.*груз/.test(value)) return "dangerous-goods";
  if (/английск/.test(value)) return "english";
  if (/тренаж.*кабин/.test(value)) return "cabin-training";
  if (/тренажер/.test(value)) return "simulator-training";
  return value || (record.category ?? "").toLocaleLowerCase("ru-RU").trim();
}

export function certificationHistoryKey(record: CertificationHistoryRef): string {
  const aircraft = (record.aircraftType ?? "").toLocaleLowerCase("ru-RU").replace(/\s+/g, "");
  return `${normalizedCertificationName(record)}|${aircraft}`;
}

export function latestCertificationRecords<T extends CertificationHistoryRef>(records: T[]): T[] {
  const latest = new Map<string, T>();
  records.forEach((record) => {
    const key = certificationHistoryKey(record);
    const current = latest.get(key);
    const date = record.startDate || record.issuedDate || record.endDate || "";
    const currentDate = current ? current.startDate || current.issuedDate || current.endDate || "" : "";
    if (!current || `${date}|${record.id}` > `${currentDate}|${current.id}`) latest.set(key, record);
  });
  return [...latest.values()];
}
