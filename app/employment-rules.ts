export type EmploymentEvent = {
  id: string;
  kind: "dismissed" | "rehired";
  date: string;
  orderNumber: string;
  recordedAt: string;
};

export type EmploymentPerson = {
  active: boolean;
  employmentHistory?: EmploymentEvent[];
};

export function changeEmploymentStatus<T extends EmploymentPerson>(person: T, event: EmploymentEvent, today: string): T {
  const parsed = new Date(`${event.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== event.date) throw new Error("Укажите корректную дату.");
  if (event.date > today) throw new Error("Укажите фактическую дату не позднее сегодняшней.");
  const history = person.employmentHistory ?? [];
  if (history.some((item) => item.id === event.id)) throw new Error("Это изменение уже сохранено.");
  if (history.length && event.date < history.at(-1)!.date) throw new Error("Дата не может быть раньше последнего увольнения или повторного приёма.");
  if (event.kind === "dismissed" && !person.active) throw new Error("Сотрудник уже находится в архиве.");
  if (event.kind === "rehired" && person.active) throw new Error("Сотрудник уже числится работающим.");
  return { ...person, active: event.kind === "rehired", employmentHistory: [...history, { ...event, orderNumber: event.orderNumber.trim() }] };
}

/** The dismissal date remains the last working day. Older cards need no migration. */
export function isEmployedOnDate(person: EmploymentPerson, date: string): boolean {
  const history = person.employmentHistory ?? [];
  if (!history.length) return person.active;
  let employed = history[0].kind === "dismissed";
  for (const event of history) {
    if (event.kind === "rehired" && date >= event.date) employed = true;
    if (event.kind === "dismissed" && date > event.date) employed = false;
  }
  return employed;
}

/** Keep stored plans visible after dismissal without offering the person for new assignments. */
export function hasStoredMonthlyHistory(personId: string, month: string, assignments: { personId: string; date: string }[], busy: { personId: string; dateFrom: string; dateTo: string }[], shifts: { personId: string; date: string }[]): boolean {
  const from = `${month}-01`;
  const to = `${month}-31`;
  return assignments.some((entry) => entry.personId === personId && entry.date.startsWith(month))
    || busy.some((entry) => entry.personId === personId && entry.dateFrom <= to && entry.dateTo >= from)
    || shifts.some((entry) => entry.personId === personId && entry.date.startsWith(month));
}
