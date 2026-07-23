export type ExpiryRecordRef = {
  endDate: string;
  issuedDate: string;
  startDate: string;
  organization: string;
  documentType: string;
  number: string;
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
