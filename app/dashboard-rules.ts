export const DASHBOARD_ROW_LIMIT = 5;

export function dashboardRows<T>(rows: T[]): T[] {
  return rows.slice(0, DASHBOARD_ROW_LIMIT);
}

export function isCurrentMonthDate(value: string, today: string): boolean {
  return Boolean(value && today && value.slice(0, 7) === today.slice(0, 7));
}
