export const DASHBOARD_ROW_LIMIT = 5;

export function dashboardRows<T>(rows: T[]): T[] {
  return rows.slice(0, DASHBOARD_ROW_LIMIT);
}
