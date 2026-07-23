export type PlanRole = "primary" | "reserve";

export type PlanAssignment = {
  id: string;
  date: string;
  aircraft: string;
  role: PlanRole;
  personId: string;
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

export const planBusyActivities = Object.keys(planBusyLabels) as PlanBusyActivity[];

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
  const assignedPeople = new Set(assignments
    .filter((assignment) =>
      assignment.date === date
      && assignment.aircraft === aircraft
      && assignment.id !== currentAssignmentId)
    .map((assignment) => assignment.personId));
  return people.filter((person) =>
    person.active
    && person.aircraftTypes.includes(aircraftType)
    && !assignedPeople.has(person.id)
    && !isPersonBusyOnDate(person.id, date, busyEntries, actualBusy));
}
