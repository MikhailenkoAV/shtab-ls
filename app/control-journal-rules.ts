import { aircraftNumbersByType } from "./aircraft-rules.ts";
import { getExpiryState } from "./personal-files-rules.ts";

export type ControlStatus = "expired" | "alert14" | "alert45" | "valid" | "undated" | "incomplete";
export type ControlKind = "type" | "night" | "certification";

export type ControlPersonRef = {
  id: string;
  name: string;
  active: boolean;
  qualifications: {
    aircraftTypes: string[];
    nightAircraftTypes?: string[];
  }[];
};

export type ControlShiftRef = {
  personId: string;
  date: string;
  activity: string;
  segments: {
    aircraft: string;
    aircraftType?: string;
    flightMinutes: number;
    nightMinutes: number;
  }[];
};

export type ControlCertificationRef = {
  id: string;
  personId: string;
  category: string;
  certificationType: string;
  aircraftType: string;
  issuedDate: string;
  startDate: string;
  endDate: string;
  organization: string;
  documentType: string;
  number: string;
};

export type ControlRow = {
  id: string;
  kind: ControlKind;
  personId: string;
  personName: string;
  subject: string;
  aircraftType: string;
  referenceDate: string;
  dueDate: string;
  daysLeft: number | null;
  status: ControlStatus;
  statusLabel: string;
};

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function parseIso(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
}

export function addDays(value: string, days: number): string {
  const date = parseIso(value);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function daysBetween(from: string, to: string): number | null {
  const start = parseIso(from);
  const end = parseIso(to);
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function statusForDueDate(dueDate: string, today: string): Pick<ControlRow, "daysLeft" | "status" | "statusLabel"> {
  const daysLeft = daysBetween(today, dueDate);
  if (daysLeft === null) return { daysLeft: null, status: "incomplete", statusLabel: "Проверьте дату" };
  if (daysLeft < 0) return { daysLeft, status: "expired", statusLabel: `Просрочено ${Math.abs(daysLeft)} дн.` };
  if (daysLeft <= 14) return { daysLeft, status: "alert14", statusLabel: daysLeft === 0 ? "Истекает сегодня" : `Осталось ${daysLeft} дн.` };
  if (daysLeft <= 45) return { daysLeft, status: "alert45", statusLabel: `Осталось ${daysLeft} дн.` };
  return { daysLeft, status: "valid", statusLabel: `Осталось ${daysLeft} дн.` };
}

function aircraftTypeForSegment(segment: ControlShiftRef["segments"][number]): string {
  if (segment.aircraftType) return segment.aircraftType;
  return Object.entries(aircraftNumbersByType)
    .find(([, numbers]) => numbers.includes(segment.aircraft))?.[0] ?? "";
}

function lastFlightDate(
  shifts: ControlShiftRef[],
  personId: string,
  aircraftType: string,
  nightOnly: boolean,
): string {
  return shifts
    .filter((shift) => shift.personId === personId && shift.activity === "flight")
    .flatMap((shift) => shift.segments.map((segment) => ({ date: shift.date, segment })))
    .filter(({ segment }) =>
      aircraftTypeForSegment(segment) === aircraftType
      && segment.flightMinutes > 0
      && (!nightOnly || segment.nightMinutes > 0))
    .map(({ date }) => date)
    .sort()
    .at(-1) ?? "";
}

function flightControlRow(
  kind: "type" | "night",
  person: ControlPersonRef,
  aircraftType: string,
  shifts: ControlShiftRef[],
  today: string,
): ControlRow {
  const referenceDate = lastFlightDate(shifts, person.id, aircraftType, kind === "night");
  const dueDate = referenceDate ? addDays(referenceDate, 90) : "";
  const status = dueDate
    ? statusForDueDate(dueDate, today)
    : { daysLeft: null, status: "incomplete" as const, statusLabel: kind === "night" ? "Нет ночного полёта" : "Нет полёта на типе" };
  return {
    id: `${kind}-${person.id}-${aircraftType}`,
    kind,
    personId: person.id,
    personName: person.name,
    subject: kind === "type" ? "Поддержание допуска на типе" : "Поддержание ночного допуска",
    aircraftType,
    referenceDate,
    dueDate,
    ...status,
  };
}

export function buildControlRows(
  people: ControlPersonRef[],
  shifts: ControlShiftRef[],
  certifications: ControlCertificationRef[],
  today: string,
): ControlRow[] {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const flightRows = people.filter((person) => person.active).flatMap((person) => {
    const aircraftTypes = [...new Set(person.qualifications.flatMap((qualification) => qualification.aircraftTypes))];
    const nightAircraftTypes = [...new Set(person.qualifications.flatMap((qualification) => qualification.nightAircraftTypes ?? []))];
    return [
      ...aircraftTypes.map((aircraftType) => flightControlRow("type", person, aircraftType, shifts, today)),
      ...nightAircraftTypes
        .filter((aircraftType) => aircraftTypes.includes(aircraftType))
        .map((aircraftType) => flightControlRow("night", person, aircraftType, shifts, today)),
    ];
  });
  const todayDate = parseIso(today) ?? new Date();
  const certificationRows = certifications.flatMap((record): ControlRow[] => {
    const person = peopleById.get(record.personId);
    if (!person?.active) return [];
    const state = getExpiryState(record, new Date(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate()));
    return [{
      id: `certification-${record.id}`,
      kind: "certification",
      personId: record.personId,
      personName: person.name,
      subject: record.certificationType || record.category || "Сертификация",
      aircraftType: record.aircraftType,
      referenceDate: record.startDate || record.issuedDate,
      dueDate: record.endDate,
      daysLeft: state.days,
      status: state.level,
      statusLabel: state.label,
    }];
  });
  return [...flightRows, ...certificationRows].sort((left, right) =>
    left.personName.localeCompare(right.personName, "ru-RU")
    || left.kind.localeCompare(right.kind)
    || left.aircraftType.localeCompare(right.aircraftType, "ru-RU")
    || left.subject.localeCompare(right.subject, "ru-RU"));
}

export function isControlAttention(row: ControlRow): boolean {
  return ["expired", "alert14", "alert45", "incomplete"].includes(row.status);
}

export function isControlJournalVisible(row: ControlRow, kind: ControlKind): boolean {
  return row.kind === kind && (kind !== "certification" || isControlAttention(row));
}

export function compareAttentionDates(leftDate: string, rightDate: string, today: string): number {
  const rank = (value: string): [number, number] => {
    const days = daysBetween(today, value);
    if (days === null) return [2, Number.MAX_SAFE_INTEGER];
    if (days < 0) return [0, Math.abs(days)];
    return [1, days];
  };
  const left = rank(leftDate);
  const right = rank(rightDate);
  return left[0] - right[0] || left[1] - right[1];
}
