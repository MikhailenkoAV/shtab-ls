export const JOURNAL_COLUMNS = [
  { id: "date", label: "Дата", width: 112, min: 88 },
  { id: "person", label: "Сотрудник", width: 216, min: 128 },
  { id: "activity", label: "Занятость", width: 216, min: 112 },
  { id: "flight", label: "Полётное время", width: 144, min: 104 },
  { id: "aircraft", label: "ВС / кресло", width: 168, min: 100 },
  { id: "purpose", label: "Цель", width: 80, min: 64 },
  { id: "work", label: "Рабочее", width: 136, min: 100 },
  { id: "night", label: "Ночь / посадки", width: 148, min: 112, className: "journal-night-col" },
  { id: "rest", label: "Отдых", width: 180, min: 120 },
  { id: "note", label: "Примечание", width: 210, min: 100, className: "journal-note-col" },
  { id: "actions", label: "Действия", width: 132, min: 112, className: "journal-actions-col" },
] as const;

export type JournalColumnId = typeof JOURNAL_COLUMNS[number]["id"];
export type JournalColumnWidths = Record<JournalColumnId, number>;
export const JOURNAL_COLUMN_WIDTHS_KEY = "shtab-ls.journal-column-widths.v1";
export const MAX_JOURNAL_COLUMN_WIDTH = 900;

export function columnWidth(id: JournalColumnId, value: unknown): number {
  const column = JOURNAL_COLUMNS.find((item) => item.id === id)!;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_JOURNAL_COLUMN_WIDTH, Math.max(column.min, Math.round(value)))
    : column.width;
}

export function journalColumnWidths(value?: unknown): JournalColumnWidths {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(JOURNAL_COLUMNS.map((column) => [column.id, columnWidth(column.id, record[column.id])])) as JournalColumnWidths;
}
