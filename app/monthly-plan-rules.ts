export type PlanRole = "primary" | "reserve";

export type PlanAssignment = {
  id: string;
  date: string;
  aircraft: string;
  role: PlanRole;
  personId: string;
  activity?: "flight" | "standby";
};

export type PlanBusyActivity =
  | "trip"
  | "office"
  | "periodic_training"
  | "ground_training"
  | "auc_work"
  | "auc_study"
  | "standby"
  | "vacation"
  | "dayoff";

export type PlanBusyEntry = {
  id: string;
  personId: string;
  dateFrom: string;
  dateTo: string;
  activity: PlanBusyActivity;
  note: string;
};

export const planRoleLabels: Record<PlanRole, string> = {
  primary: "Основной",
  reserve: "Резерв",
};

export const planBusyLabels: Record<PlanBusyActivity, string> = {
  dayoff: "Выходной",
  periodic_training: "Периодическая подготовка",
  trip: "Командировка",
  ground_training: "Наземная подготовка",
  auc_work: "Работа в АУЦ",
  auc_study: "Учёба в АУЦ",
  standby: "Ожидание полёта",
  office: "Работа в офисе",
  vacation: "Отпуск",
};

export const planBusyActivities = (Object.keys(planBusyLabels) as PlanBusyActivity[])
  .filter((activity) => activity !== "standby");

export type PlanPersonInput = {
  id: string;
  aircraftTypes: string[];
  active: boolean;
};

export type ActualBusyInput = {
  personId: string;
  date: string;
  activity: string;
};

export type AutomaticPlanActivity = "standby" | "dayoff";

export type AssignmentBlockReasonInput = {
  person: PlanPersonInput | undefined;
  assignments: PlanAssignment[];
  busyEntries: PlanBusyEntry[];
  actualBusy: ActualBusyInput[];
  date: string;
  aircraftType: string;
  aircraft: string;
  currentAssignmentId?: string;
};

export function monthDates(month: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: lastDay }, (_, index) =>
    `${month}-${String(index + 1).padStart(2, "0")}`);
}

export function aircraftTypeForNumber(
  aircraftNumber: string,
  numbersByType: Readonly<Record<string, readonly string[]>>,
): string {
  return Object.entries(numbersByType)
    .find(([, numbers]) => numbers.includes(aircraftNumber))?.[0] ?? "";
}

export function dateInPlanEntry(date: string, entry: PlanBusyEntry): boolean {
  return date >= entry.dateFrom && date <= entry.dateTo;
}

export function datesInRange(dateFrom: string, dateTo: string): string[] {
  if (!dateFrom || !dateTo || dateTo < dateFrom) return [];
  const dates: string[] = [];
  const cursor = new Date(`${dateFrom}T12:00:00`);
  const end = new Date(`${dateTo}T12:00:00`);
  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    dates.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function planPersonShortName(name: string): string {
  const [surname = "", first = "", middle = ""] = name.trim().split(/\s+/);
  const initials = [first, middle].filter(Boolean).map((part) => `${part[0]}.`).join("");
  return initials ? `${surname} ${initials}` : surname;
}

export function isPersonBusyOnDate(
  personId: string,
  date: string,
  busyEntries: PlanBusyEntry[],
  actualBusy: ActualBusyInput[],
): boolean {
  return busyEntries.some((entry) =>
    entry.personId === personId && dateInPlanEntry(date, entry))
    || actualBusy.some((entry) =>
      entry.personId === personId && entry.date === date && entry.activity !== "flight");
}

function isNonWorkingActivity(activity: string): boolean {
  return activity === "dayoff" || activity === "vacation";
}

function mondayOnOrBeforeYearStart(year: number): Date {
  const yearStart = new Date(year, 0, 1, 12, 0, 0);
  const daysSinceMonday = (yearStart.getDay() + 6) % 7;
  yearStart.setDate(yearStart.getDate() - daysSinceMonday);
  return yearStart;
}

function localDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function automaticPlanActivityKey(personId: string, date: string): string {
  return `${personId}\u0001${date}`;
}

export function buildAutomaticPlanActivityMap<T extends PlanPersonInput>(
  people: T[],
  dates: string[],
  assignments: Array<Pick<PlanAssignment, "personId" | "date">>,
  busyEntries: Array<{ personId: string; dateFrom: string; dateTo: string; activity: string }>,
  actualEntries: ActualBusyInput[],
): Map<string, AutomaticPlanActivity> {
  const requestedDates = [...new Set(dates)].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const result = new Map<string, AutomaticPlanActivity>();
  if (!requestedDates.length) return result;
  const endDate = requestedDates.at(-1)!;
  const earliestRelevant = [
    requestedDates[0],
    ...assignments.filter((item) => item.date <= endDate).map((item) => item.date),
    ...busyEntries.filter((item) => item.dateFrom <= endDate).map((item) => item.dateFrom),
    ...actualEntries.filter((item) => item.date <= endDate).map((item) => item.date),
  ].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()[0] ?? requestedDates[0];
  const start = mondayOnOrBeforeYearStart(Number(earliestRelevant.slice(0, 4)));
  const end = new Date(`${endDate}T12:00:00`);
  const requested = new Set(requestedDates);

  people.filter((person) => person.active).forEach((person) => {
    let consecutiveWorkDays = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const date = localDateValue(cursor);
      const actual = actualEntries.filter((entry) => entry.personId === person.id && entry.date === date);
      const plannedBusy = busyEntries.find((entry) =>
        entry.personId === person.id && date >= entry.dateFrom && date <= entry.dateTo);
      const assigned = assignments.some((assignment) =>
        assignment.personId === person.id && assignment.date === date);

      if (actual.length) {
        consecutiveWorkDays = actual.some((entry) => !isNonWorkingActivity(entry.activity))
          ? consecutiveWorkDays + 1
          : 0;
      } else if (plannedBusy) {
        consecutiveWorkDays = isNonWorkingActivity(plannedBusy.activity)
          ? 0
          : consecutiveWorkDays + 1;
      } else if (assigned) {
        consecutiveWorkDays += 1;
      } else {
        const activity: AutomaticPlanActivity = consecutiveWorkDays >= 6 ? "dayoff" : "standby";
        if (requested.has(date)) result.set(automaticPlanActivityKey(person.id, date), activity);
        consecutiveWorkDays = activity === "dayoff" ? 0 : consecutiveWorkDays + 1;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  });
  return result;
}

export function automaticDayOffPersonIds<T extends PlanPersonInput>(
  people: T[],
  date: string,
  assignments: PlanAssignment[],
  busyEntries: PlanBusyEntry[],
  actualEntries: ActualBusyInput[],
): string[] {
  const activities = buildAutomaticPlanActivityMap(
    people,
    [date],
    assignments,
    busyEntries,
    actualEntries,
  );
  return people
    .filter((person) => activities.get(automaticPlanActivityKey(person.id, date)) === "dayoff")
    .map((person) => person.id);
}

export function assignmentDateWarning(
  assignments: PlanAssignment[],
  personId: string,
  date: string,
  selectedAircraft: string[] = [],
): string | null {
  const existing = assignments.filter((assignment) =>
    assignment.personId === personId
    && assignment.date === date
    && !selectedAircraft.includes(assignment.aircraft));
  if (!existing.length) return null;
  const details = existing.map((assignment) =>
    `${assignment.aircraft} · ${planRoleLabels[assignment.role]}${assignment.activity === "standby" ? " · ожидание полёта" : ""}`);
  return `Уже запланировано: ${details.join("; ")}. Назначение на другой борт разрешено.`;
}

export function assignmentBlockReason({
  person,
  assignments,
  busyEntries,
  actualBusy,
  date,
  aircraftType,
  aircraft,
  currentAssignmentId,
}: AssignmentBlockReasonInput): string | null {
  if (!person) return "Выберите сотрудника.";
  if (!person.active) return "Сотрудник неактивен.";
  if (!person.aircraftTypes.includes(aircraftType)) return `Нет допуска на тип ВС ${aircraftType}.`;
  const plannedBusy = busyEntries.find((entry) =>
    entry.personId === person.id && dateInPlanEntry(date, entry));
  if (plannedBusy) return `На эту дату уже указано: ${planBusyLabels[plannedBusy.activity]}.`;
  const actual = actualBusy.find((entry) =>
    entry.personId === person.id && entry.date === date && entry.activity !== "flight");
  if (actual) return `В журнале уже указано: ${planBusyLabels[actual.activity as PlanBusyActivity] ?? "другая занятость"}.`;
  const sameAircraft = assignments.find((assignment) =>
    assignment.personId === person.id
    && assignment.date === date
    && assignment.aircraft === aircraft
    && assignment.id !== currentAssignmentId);
  if (sameAircraft) return `Сотрудник уже назначен на ${aircraft} в этот день.`;
  return null;
}

export function busyBlockReason(
  personId: string,
  date: string,
  assignments: PlanAssignment[],
  busyEntries: PlanBusyEntry[],
  actualBusy: ActualBusyInput[],
  currentEntryId?: string,
): string | null {
  const assignment = assignments.find((item) => item.personId === personId && item.date === date);
  if (assignment) return `На эту дату уже назначен полёт на ${assignment.aircraft}.`;
  const plannedBusy = busyEntries.find((entry) =>
    entry.id !== currentEntryId && entry.personId === personId && dateInPlanEntry(date, entry));
  if (plannedBusy) return `На эту дату уже указано: ${planBusyLabels[plannedBusy.activity]}.`;
  const actual = actualBusy.find((entry) => entry.personId === personId && entry.date === date);
  if (actual) return actual.activity === "flight"
    ? "На эту дату в журнале уже есть полётная смена."
    : `В журнале уже указано: ${planBusyLabels[actual.activity as PlanBusyActivity] ?? "другая занятость"}.`;
  return null;
}

export function availablePeopleForAssignment<T extends PlanPersonInput>(
  people: T[],
  assignments: PlanAssignment[],
  busyEntries: PlanBusyEntry[],
  actualBusy: ActualBusyInput[],
  date: string,
  aircraftType: string,
  aircraft: string,
  currentAssignmentId?: string,
): T[] {
  return people.filter((person) =>
    !assignmentBlockReason({
      person,
      assignments,
      busyEntries,
      actualBusy,
      date,
      aircraftType,
      aircraft,
      currentAssignmentId,
    }));
}
