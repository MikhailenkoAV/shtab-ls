export type GroupedDateCell = {
  showDate: boolean;
  rowSpan: number;
};

export function groupedDateCells<T extends { date: string }>(rows: T[]): GroupedDateCell[] {
  const counts = new Map<string, number>();
  const firstRows = new Map<string, number>();
  rows.forEach((row, index) => {
    counts.set(row.date, (counts.get(row.date) ?? 0) + 1);
    if (!firstRows.has(row.date)) firstRows.set(row.date, index);
  });
  return rows.map((row, index) => ({
    showDate: firstRows.get(row.date) === index,
    rowSpan: counts.get(row.date) ?? 1,
  }));
}
