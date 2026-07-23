"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { activityUsesTime as usesTime, isRestNeutralActivity, normalizeActivityTiming } from "./activity-rules";
import { aircraftNumbersByType, aircraftNumbersForType, isAircraftNumberAllowed } from "./aircraft-rules";
import { downloadEmploymentReport, downloadFlightReport } from "./monthly-report";
import { MonthlyPlanView, PlanEditRequest } from "./monthly-plan";
import {
  aircraftTypeForNumber,
  datesInRange,
  planBusyLabels,
  planRoleLabels,
  PlanAssignment,
  PlanBusyEntry,
} from "./monthly-plan-rules";
import { CertificationRecord, getExpiryState, ImportAviabitModal, ImportPayload, PersonalFilesView } from "./personal-files";
import {
  calculateRestIssues,
  isSundayDate,
  restMinutesAroundDate,
  RestDayInput,
  RestIntervalInput,
  RestIssue,
} from "./rest-rules";
import { groupedDateCells } from "./journal-rules";

type View = "dashboard" | "shifts" | "people" | "personal" | "planning";
type Activity = "flight" | "trip" | "office" | "periodic_training" | "ground_training" | "standby" | "vacation" | "dayoff";
type Seat = "КВС" | "Пилот-инструктор";

type Qualification = { id: string; operators: string[]; aircraftTypes: string[]; seats: string[] };
type Person = { id: string; name: string; position: string; permissions: string[]; aircraftTypes: string[]; qualifications: Qualification[]; active: boolean };
type Segment = {
  id: string; aircraft: string; aircraftType?: string; seat: Seat; purpose: string;
  dutyStart: string; dutyEnd: string; flightMinutes: number; nightMinutes: number; splitShift: boolean;
  splitGroupId?: string; splitPart?: 1 | 2;
};
type Shift = {
  id: string; personId: string; date: string; activity: Activity; start: string; workMinutes: number;
  segments: Segment[]; note: string; createdAt: string;
  periodId?: string; periodStart?: string; periodEnd?: string;
  periodActivity?: Activity; periodNote?: string;
};
type ShiftDraft = Omit<Shift, "id" | "createdAt" | "periodId" | "periodStart" | "periodEnd" | "periodActivity" | "periodNote"> & { dateTo?: string };
type AppData = {
  people: Person[];
  shifts: Shift[];
  certifications: CertificationRecord[];
  planAssignments: PlanAssignment[];
  planBusyEntries: PlanBusyEntry[];
};

const EMPTY_DATA: AppData = { people: [], shifts: [], certifications: [], planAssignments: [], planBusyEntries: [] };
const DB_NAME = "shtab-ls";
const STORE_NAME = "workspace";
const STATE_KEY = "primary";
const activityLabels: Record<Activity, string> = {
  flight: "Полётная смена",
  trip: "Командировка",
  office: "Работа в офисе",
  periodic_training: "Периодическая подготовка",
  ground_training: "Наземная подготовка",
  standby: "Ожидание полёта",
  vacation: "Отпуск",
  dayoff: "Выходной",
};
const multiDayActivities: Activity[] = ["trip", "vacation", "periodic_training"];
const flightPurposes = ["КВП", "АОН", "АР", "АОН (УТП)"];
const seatOptions: Seat[] = ["КВС", "Пилот-инструктор"];
const positionOptions = ["Командир ВС", "Пилот-инструктор", "Экзаменатор"];
const operatorOptions = ["КВП", "АОН", "АР"];
const aircraftTypeOptions = ["A109", "AW109", "AW139", "AS350", "EC130", "R44", "R66", "BO105"];
const PERIODIC_SUNDAY_NOTE = "Воскресенье в периоде периодической подготовки";
const operationalClocks = [
  { label: "UTC", timeZone: "UTC" },
  { label: "Сочи", timeZone: "Europe/Moscow" },
  { label: "Пермь", timeZone: "Asia/Yekaterinburg" },
  { label: "Магадан", timeZone: "Asia/Magadan" },
];
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function normalizeActivity(value: string): Activity {
  if (value === "duty") return "standby";
  if (value === "training") return "periodic_training";
  return value in activityLabels ? value as Activity : "office";
}

function normalizeShift(shift: Shift): Shift {
  const storedActivity = normalizeActivity(shift.activity);
  const periodActivity = shift.periodActivity
    ? normalizeActivity(shift.periodActivity)
    : shift.periodId || storedActivity === "periodic_training"
      ? storedActivity
      : undefined;
  const periodicTraining = periodActivity === "periodic_training";
  const sundayOff = periodicTraining && isSundayDate(shift.date);
  const periodNote = shift.periodNote ?? (periodActivity ? shift.note.replace(PERIODIC_SUNDAY_NOTE, "").trim() : undefined);
  const activity = sundayOff ? "dayoff" : storedActivity;
  const timing = normalizeActivityTiming(periodicTraining ? "periodic_training" : activity, sundayOff ? "" : shift.start, sundayOff ? 0 : shift.workMinutes);
  const legacyDutyEnd = shift.start && shift.workMinutes ? clockAfterMinutes(shift.start, shift.workMinutes) : "";
  const segments = (shift.segments ?? []).map((segment) => ({
    ...segment,
    seat: segment.seat ?? "КВС",
    dutyStart: segment.dutyStart ?? shift.start ?? "",
    dutyEnd: segment.dutyEnd ?? legacyDutyEnd,
    splitShift: Boolean(segment.splitShift),
    splitPart: segment.splitPart === 1 || segment.splitPart === 2 ? segment.splitPart : undefined,
  }));
  const normalized: Shift = {
    ...shift,
    activity,
    start: timing.start,
    workMinutes: timing.workMinutes,
    segments: sundayOff || periodicTraining ? [] : segments,
    note: sundayOff ? [periodNote, PERIODIC_SUNDAY_NOTE].filter(Boolean).join(" · ") : shift.note,
    periodActivity,
    periodNote,
  };
  delete (normalized as Shift & { status?: unknown }).status;
  return deriveFlightTiming(normalized);
}

function parseStoredPositions(value: string): { selected: string[]; other: string } {
  const selected = new Set<string>();
  const other: string[] = [];
  value.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => {
    const normalized = item.toLocaleLowerCase("ru-RU");
    if (normalized === "квс" || normalized.includes("командир воздушного") || normalized === "командир вс") selected.add("Командир ВС");
    else if (normalized.includes("инструктор")) selected.add("Пилот-инструктор");
    else if (normalized.includes("экзаменатор")) selected.add("Экзаменатор");
    else other.push(item);
  });
  return { selected: [...selected], other: other.join(", ") };
}

function orderedUnique(values: string[], preferredOrder: string[]): string[] {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return [...preferredOrder.filter((value) => unique.includes(value)), ...unique.filter((value) => !preferredOrder.includes(value))];
}

function normalizePerson(person: Person): Person {
  const legacySeats = parseStoredPositions(person.position ?? "").selected;
  const qualifications = person.qualifications?.length ? person.qualifications.map((qualification, index) => ({
    id: qualification.id || `${person.id}-qualification-${index + 1}`,
    operators: orderedUnique(qualification.operators ?? [], operatorOptions),
    aircraftTypes: orderedUnique(qualification.aircraftTypes ?? [], aircraftTypeOptions),
    seats: orderedUnique(qualification.seats ?? [], positionOptions),
  })) : ((person.permissions?.length || person.aircraftTypes?.length || legacySeats.length) ? [{
    id: `${person.id}-legacy-qualification`,
    operators: orderedUnique(person.permissions ?? [], operatorOptions),
    aircraftTypes: orderedUnique(person.aircraftTypes ?? [], aircraftTypeOptions),
    seats: orderedUnique(legacySeats, positionOptions),
  }] : []);
  const operators = orderedUnique(qualifications.flatMap((qualification) => qualification.operators), operatorOptions);
  const aircraftTypes = orderedUnique(qualifications.flatMap((qualification) => qualification.aircraftTypes), aircraftTypeOptions);
  const seats = orderedUnique(qualifications.flatMap((qualification) => qualification.seats), positionOptions);
  return { ...person, position: seats.join(", "), permissions: operators, aircraftTypes, qualifications };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadData(): Promise<AppData> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => {
      const stored = request.result as Partial<AppData> | undefined;
      resolve({
        people: (stored?.people ?? []).map(normalizePerson),
        shifts: (stored?.shifts ?? []).map(normalizeShift),
        certifications: stored?.certifications ?? [],
        planAssignments: stored?.planAssignments ?? [],
        planBusyEntries: stored?.planBusyEntries ?? [],
      });
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function saveData(data: AppData): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(data, STATE_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

function parseDuration(value: string): number {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Math.max(0, Number(hours) * 60 + Number(minutes));
}
function compactTime(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 5);
  return digits.length <= 2 ? digits : `${digits.slice(0, -2)}:${digits.slice(-2)}`;
}
function normalizeTime(value: string, clock = false): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const hours = digits.length <= 2 ? digits : digits.slice(0, -2);
  const minutes = digits.length <= 2 ? "00" : digits.slice(-2);
  const hoursNumber = Number(hours); const minutesNumber = Number(minutes);
  if (!Number.isFinite(hoursNumber) || minutesNumber > 59 || (clock && hoursNumber > 23)) return "";
  return `${String(hoursNumber).padStart(2, "0")}:${String(minutesNumber).padStart(2, "0")}`;
}
function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return "—";
  const sign = minutes < 0 ? "−" : "";
  const absolute = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(absolute / 60)} ч ${String(absolute % 60).padStart(2, "0")} мин`;
}
function durationValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
function clockMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]); const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}
function clockAfterMinutes(value: string, minutesToAdd: number): string {
  const start = clockMinutes(value);
  if (start === null) return "";
  const result = ((start + Math.max(0, minutesToAdd)) % 1_440 + 1_440) % 1_440;
  return `${String(Math.floor(result / 60)).padStart(2, "0")}:${String(result % 60).padStart(2, "0")}`;
}
function segmentMinuteRanges(segments: Segment[]): { segment: Segment; start: number; end: number }[] {
  let dayOffset = 0; let previousClock: number | null = null;
  return segments.flatMap((segment) => {
    const startClock = clockMinutes(segment.dutyStart); const endClock = clockMinutes(segment.dutyEnd);
    if (startClock === null || endClock === null || startClock === endClock) return [];
    if (previousClock !== null && startClock < previousClock) dayOffset += 1;
    const start = dayOffset * 1_440 + startClock;
    const end = dayOffset * 1_440 + endClock + (endClock < startClock ? 1_440 : 0);
    previousClock = startClock;
    return [{ segment, start, end }];
  });
}
function flightDutyIntervals(segments: Segment[]): { start: number; end: number; split: boolean }[] {
  const grouped = new Map<string, { start: number; end: number; split: boolean }>();
  segmentMinuteRanges(segments).forEach(({ segment, start, end }) => {
    const key = segment.splitShift && segment.splitGroupId ? `split:${segment.splitGroupId}` : `segment:${segment.id}`;
    const current = grouped.get(key);
    grouped.set(key, current
      ? { start: Math.min(current.start, start), end: Math.max(current.end, end), split: current.split || segment.splitShift }
      : { start, end, split: segment.splitShift });
  });
  return [...grouped.values()].sort((left, right) => left.start - right.start);
}
function flightEntryCount(segments: Segment[]): number {
  return new Set(segments.map((segment) =>
    segment.splitShift && segment.splitGroupId ? `split:${segment.splitGroupId}` : `segment:${segment.id}`)).size;
}
function segmentDutyMinutes(segment: Segment): number {
  const start = clockMinutes(segment.dutyStart); const end = clockMinutes(segment.dutyEnd);
  if (start === null || end === null || start === end) return 0;
  return end >= start ? end - start : 1_440 - start + end;
}
function flightWorkMinutes(segments: Segment[]): number {
  const ranges = segmentMinuteRanges(segments).map(({ start, end }) => ({ start, end })).sort((left, right) => left.start - right.start);
  if (!ranges.length) return 0;
  let total = 0; let currentStart = ranges[0].start; let currentEnd = ranges[0].end;
  ranges.slice(1).forEach((range) => {
    if (range.start <= currentEnd) currentEnd = Math.max(currentEnd, range.end);
    else { total += currentEnd - currentStart; currentStart = range.start; currentEnd = range.end; }
  });
  return total + currentEnd - currentStart;
}
function deriveFlightTiming(shift: Shift): Shift {
  if (shift.activity !== "flight" || !shift.segments.length) return shift;
  const ranges = segmentMinuteRanges(shift.segments);
  const first = ranges[0];
  return {
    ...shift,
    start: first?.segment.dutyStart ?? shift.start,
    workMinutes: flightWorkMinutes(shift.segments),
  };
}
function shiftStart(shift: Shift): Date | null {
  const firstFlightRange = shift.activity === "flight" ? segmentMinuteRanges(shift.segments)[0] : null;
  const startValue = firstFlightRange?.segment.dutyStart ?? shift.start;
  if (!startValue || !shift.date || (!shift.workMinutes && !firstFlightRange)) return null;
  const date = new Date(`${shift.date}T${startValue}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
function shiftEnd(shift: Shift): Date | null {
  if (shift.activity === "flight") {
    const ranges = segmentMinuteRanges(shift.segments);
    if (!ranges.length || !shift.date) return null;
    const latestEnd = Math.max(...ranges.map((range) => range.end));
    const base = new Date(`${shift.date}T00:00:00`);
    return Number.isNaN(base.getTime()) ? null : new Date(base.getTime() + latestEnd * 60_000);
  }
  const start = shiftStart(shift);
  return start ? new Date(start.getTime() + shift.workMinutes * 60_000) : null;
}
function formatDate(value: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(`${value}T12:00:00`)).replace(" г.", "");
}
function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function enumerateDates(dateFrom: string, dateTo: string): string[] {
  const result: string[] = [];
  const current = new Date(`${dateFrom}T12:00:00`);
  const end = new Date(`${dateTo}T12:00:00`);
  while (current <= end) {
    result.push(localIsoDate(current));
    current.setDate(current.getDate() + 1);
  }
  return result;
}
function shiftEndClock(shift: Shift): string {
  const end = shiftEnd(shift);
  return end ? `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}` : "—";
}
function isWorkActivity(activity: Activity): boolean { return !["vacation", "dayoff"].includes(activity); }

type WorkDay = { date: string; items: Shift[]; start: number; end: number };

function getWorkDays(shifts: Shift[]): Map<string, WorkDay[]> {
  const groups = new Map<string, Map<string, Shift[]>>();
  shifts.filter((shift) => isWorkActivity(shift.activity) && !isRestNeutralActivity(shift.activity) && shiftStart(shift)).forEach((shift) => {
    const personDays = groups.get(shift.personId) ?? new Map<string, Shift[]>();
    personDays.set(shift.date, [...(personDays.get(shift.date) ?? []), shift]);
    groups.set(shift.personId, personDays);
  });
  const result = new Map<string, WorkDay[]>();
  groups.forEach((personDays) => {
    const days = [...personDays.entries()].map(([date, items]) => ({
      date,
      items: [...items].sort((left, right) => (shiftStart(left)?.getTime() ?? 0) - (shiftStart(right)?.getTime() ?? 0)),
      start: Math.min(...items.map((shift) => shiftStart(shift)?.getTime() ?? Number.POSITIVE_INFINITY)),
      end: Math.max(...items.map((shift) => shiftEnd(shift)?.getTime() ?? Number.NEGATIVE_INFINITY)),
    })).sort((a, b) => a.start - b.start);
    const personId = days[0]?.items[0]?.personId;
    if (personId) result.set(personId, days);
  });
  return result;
}

function getRestMap(shifts: Shift[]): Map<string, number> {
  const map = new Map<string, number>();
  const workDays = getWorkDays(shifts);
  workDays.forEach((days) => {
    days.forEach((day, index) => {
      if (!index) return;
      const rest = (day.start - days[index - 1].end) / 60_000;
      day.items.forEach((shift) => map.set(shift.id, rest));
    });
  });
  shifts.filter((shift) => shift.activity === "dayoff").forEach((shift) => {
    const rest = restMinutesAroundDate(shift.date, workDays.get(shift.personId) ?? []);
    if (rest !== undefined) map.set(shift.id, rest);
  });
  return map;
}

function getRestIssues(shifts: Shift[]): RestIssue[] {
  const dayInputs: RestDayInput[] = [...getWorkDays(shifts).entries()].flatMap(([personId, days]) => days.map((day) => ({
    shiftId: day.items[0].id,
    personId,
    date: day.date,
    start: day.start,
    end: day.end,
  })));
  const intervalInputs: RestIntervalInput[] = [];
  shifts.filter((shift) => isWorkActivity(shift.activity)).forEach((shift) => {
    if (isRestNeutralActivity(shift.activity)) {
      const marker = new Date(`${shift.date}T00:00:00`).getTime();
      if (!Number.isNaN(marker)) {
        dayInputs.push({ shiftId: shift.id, personId: shift.personId, date: shift.date, start: marker, end: marker, assumedCompliant: true });
        intervalInputs.push({ shiftId: shift.id, personId: shift.personId, date: shift.date, start: marker, end: marker, split: false, assumedCompliant: true });
      }
      return;
    }
    if (shift.activity === "flight") {
      const base = new Date(`${shift.date}T00:00:00`).getTime();
      if (!Number.isNaN(base)) {
        flightDutyIntervals(shift.segments).forEach(({ start, end, split }) => {
          intervalInputs.push({ shiftId: shift.id, personId: shift.personId, date: shift.date, start: base + start * 60_000, end: base + end * 60_000, split });
        });
      }
    } else {
      const start = shiftStart(shift); const end = shiftEnd(shift);
      if (start && end) intervalInputs.push({ shiftId: shift.id, personId: shift.personId, date: shift.date, start: start.getTime(), end: end.getTime(), split: false });
    }
  });
  return calculateRestIssues(dayInputs, intervalInputs);
}

function getAssumedCompliantRestIds(shifts: Shift[]): Set<string> {
  const result = new Set<string>();
  const neutralDates = new Map<string, string[]>();
  shifts.filter((shift) => isRestNeutralActivity(shift.activity)).forEach((shift) => {
    result.add(shift.id);
    neutralDates.set(shift.personId, [...(neutralDates.get(shift.personId) ?? []), shift.date]);
  });
  getWorkDays(shifts).forEach((days, personId) => {
    const personNeutralDates = [...new Set(neutralDates.get(personId) ?? [])].sort();
    let previousTimedDate: string | null = null;
    days.forEach((day) => {
      const hasNeutralBoundary = personNeutralDates.some((date) =>
        (!previousTimedDate || date >= previousTimedDate) && date <= day.date);
      if (hasNeutralBoundary) day.items.forEach((shift) => result.add(shift.id));
      previousTimedDate = day.date;
    });
  });
  return result;
}

function restIssueTitle(issue: RestIssue, personName: string): string {
  if (issue.kind === "weekly") return `${personName}: еженедельный отдых менее 42 часов`;
  if (issue.kind === "split") return `${personName}: после двух разделённых смен отдых менее 48 часов`;
  return `${personName}: ежедневный отдых менее 12 часов`;
}

function restIssueDetail(issue: RestIssue): string {
  const standard = issue.kind === "daily" ? "ежедневная норма" : issue.kind === "weekly" ? "еженедельная норма" : "отдых после разделённых смен";
  return `${formatDate(issue.date)} · рассчитано ${formatDuration(issue.actualMinutes)} · ${standard} ${formatDuration(issue.requiredMinutes)}`;
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

/*
 * Отрицательный интервал означает пересечение. Такие интервалы намеренно не
 * попадают в контроль: пересечения смен могут быть производственной необходимостью.
 */
function isRestIssueVisible(issue: RestIssue): boolean {
  return issue.actualMinutes >= 0;
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [personModal, setPersonModal] = useState<Person | "new" | null>(null);
  const [shiftModal, setShiftModal] = useState<Shift | "new" | null>(null);
  const [aviabitModal, setAviabitModal] = useState(false);
  const [planEditRequest, setPlanEditRequest] = useState<PlanEditRequest | null>(null);
  const [toast, setToast] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData().then(setData).finally(() => setHydrated(true));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(new URL("sw.js", window.location.href).pathname).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      saveData(data).then(() => setSaveState("saved")).catch(() => setSaveState("error"));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [data, hydrated]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const restMap = useMemo(() => getRestMap(data.shifts), [data.shifts]);
  const assumedCompliantRestIds = useMemo(() => getAssumedCompliantRestIds(data.shifts), [data.shifts]);
  const restIssues = useMemo(() => getRestIssues(data.shifts), [data.shifts]);
  const monthKey = new Date().toISOString().slice(0, 7);
  const monthShifts = useMemo(() => data.shifts.filter((shift) => shift.date.startsWith(monthKey)), [data.shifts, monthKey]);
  const alerts = useMemo(() => {
    const result: { id: string; severity: "danger" | "warning"; title: string; detail: string }[] = [];
    restIssues.filter((issue) => issue.date.startsWith(monthKey) && isRestIssueVisible(issue)).forEach((issue) => {
      const person = data.people.find((item) => item.id === issue.personId);
      result.push({
        id: issue.id,
        severity: "danger",
        title: restIssueTitle(issue, person?.name ?? "Сотрудник"),
        detail: restIssueDetail(issue),
      });
    });
    data.certifications.forEach((record) => {
      const state = getExpiryState(record); const person = data.people.find((item) => item.id === record.personId);
      if (state.level === "expired") result.push({ id: `cert-${record.id}`, severity: "danger", title: `${person?.name ?? "Сотрудник"}: ${record.certificationType || record.category} просрочено`, detail: `Срок закончился ${formatDate(record.endDate)} · ${state.label.toLocaleLowerCase("ru-RU")}` });
      else if (state.level === "alert14" || state.level === "alert30") result.push({ id: `cert-${record.id}`, severity: state.level === "alert14" ? "danger" : "warning", title: `${person?.name ?? "Сотрудник"}: истекает ${record.certificationType || record.category}`, detail: `${formatDate(record.endDate)} · ${state.label.toLocaleLowerCase("ru-RU")}` });
    });
    return result;
  }, [data, restIssues, monthKey]);
  const sortedShifts = useMemo(() => [...data.shifts].sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`)), [data.shifts]);
  const monthSortedShifts = useMemo(() => [...monthShifts].sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`)), [monthShifts]);
  const totalWork = monthShifts.reduce((sum, shift) => sum + shift.workMinutes, 0);
  const totalFlight = monthShifts.reduce((sum, shift) => sum + shift.segments.reduce((inner, segment) => inner + segment.flightMinutes, 0), 0);

  function savePerson(person: Omit<Person, "id" | "active">) {
    if (personModal && personModal !== "new") setData((current) => ({ ...current, people: current.people.map((item) => item.id === personModal.id ? { ...item, ...person } : item) }));
    else setData((current) => ({ ...current, people: [...current.people, { ...person, id: uid(), active: true }] }));
    setPersonModal(null); setToast(personModal === "new" ? "Сотрудник добавлен" : "Данные сотрудника обновлены");
  }
  function deletePerson(person: Person) {
    const related = data.shifts.filter((shift) => shift.personId === person.id).length
      + data.certifications.filter((record) => record.personId === person.id).length
      + data.planAssignments.filter((assignment) => assignment.personId === person.id).length
      + data.planBusyEntries.filter((entry) => entry.personId === person.id).length;
    if (!window.confirm(related ? `Удалить ${person.name} вместе со связанными записями (${related})?` : `Удалить ${person.name} из состава?`)) return;
    setData((current) => ({
      ...current,
      people: current.people.filter((item) => item.id !== person.id),
      shifts: current.shifts.filter((shift) => shift.personId !== person.id),
      certifications: current.certifications.filter((record) => record.personId !== person.id),
      planAssignments: current.planAssignments.filter((assignment) => assignment.personId !== person.id),
      planBusyEntries: current.planBusyEntries.filter((entry) => entry.personId !== person.id),
    }));
    setPersonModal(null); setToast("Сотрудник удалён");
  }
  function saveShift(shift: ShiftDraft) {
    const editing = shiftModal && shiftModal !== "new" ? shiftModal : null;
    const { dateTo, ...base } = shift;
    const hasPeriod = multiDayActivities.includes(shift.activity) && Boolean(dateTo && dateTo > shift.date);
    const dates = hasPeriod ? enumerateDates(shift.date, dateTo!) : [shift.date];
    if (base.activity === "flight") {
      const conflict = data.planBusyEntries.find((entry) =>
        entry.personId === base.personId && dates.some((date) => date >= entry.dateFrom && date <= entry.dateTo));
      if (conflict) {
        setToast(`Полёт не сохранён: на эту дату указано «${planBusyLabels[conflict.activity]}».`);
        return;
      }
    } else {
      const conflict = data.planAssignments.find((assignment) =>
        assignment.personId === base.personId && dates.includes(assignment.date));
      if (conflict) {
        setToast(`Занятость не сохранена: сначала удалите назначение на ${conflict.aircraft} за ${formatDate(conflict.date)}.`);
        return;
      }
    }
    const periodId = hasPeriod ? editing?.periodId ?? uid() : undefined;
    const createdAt = editing?.createdAt ?? new Date().toISOString();
    const records: Shift[] = dates.map((date) => {
      const sundayOff = base.activity === "periodic_training" && isSundayDate(date);
      const timing = normalizeActivityTiming(base.activity, sundayOff ? "" : base.start, sundayOff ? 0 : base.workMinutes);
      return {
        ...base,
        id: dates.length === 1 && editing ? editing.id : uid(),
        date,
        activity: sundayOff ? "dayoff" : base.activity,
        start: timing.start,
        workMinutes: timing.workMinutes,
        segments: sundayOff || base.activity === "periodic_training" ? [] : base.segments,
        note: sundayOff ? [base.note, PERIODIC_SUNDAY_NOTE].filter(Boolean).join(" · ") : base.note,
        createdAt,
        periodId,
        periodStart: periodId ? dates[0] : undefined,
        periodEnd: periodId ? dates.at(-1) : undefined,
        periodActivity: periodId || base.activity === "periodic_training" ? base.activity : undefined,
        periodNote: periodId || base.activity === "periodic_training" ? base.note : undefined,
      };
    });
    setData((current) => {
      const kept = editing ? current.shifts.filter((item) => editing.periodId ? item.periodId !== editing.periodId : item.id !== editing.id) : current.shifts;
      return {
        ...current,
        shifts: [...kept, ...records],
      };
    });
    setShiftModal(null); setToast(hasPeriod ? `Период сохранён: ${dates.length} дн.` : "Запись сохранена");
  }
  function deleteShift(shift: Shift) {
    const periodText = shift.periodId && shift.periodStart && shift.periodEnd ? ` весь период ${formatDate(shift.periodStart)} — ${formatDate(shift.periodEnd)}` : ` запись ${formatDate(shift.date)}`;
    if (!window.confirm(`Удалить${periodText}?`)) return;
    setData((current) => ({ ...current, shifts: current.shifts.filter((item) => shift.periodId ? item.periodId !== shift.periodId : item.id !== shift.id) })); setShiftModal(null); setToast(shift.periodId ? "Период удалён" : "Запись удалена");
  }
  function deleteFlight(shift: Shift, segmentId: string) {
    const selectedSegment = shift.segments.find((segment) => segment.id === segmentId);
    const removedIds = new Set(shift.segments
      .filter((segment) => selectedSegment?.splitGroupId ? segment.splitGroupId === selectedSegment.splitGroupId : segment.id === segmentId)
      .map((segment) => segment.id));
    const remaining = shift.segments.filter((segment) => !removedIds.has(segment.id));
    if (!remaining.length) { deleteShift(shift); return; }
    if (!window.confirm(`${selectedSegment?.splitGroupId ? "Удалить обе части разделённой смены" : "Удалить выбранный полёт"} за ${formatDate(shift.date)}?`)) return;
    setData((current) => ({
      ...current,
      shifts: current.shifts.map((item) => item.id === shift.id
        ? deriveFlightTiming({ ...item, segments: item.segments.filter((segment) => !removedIds.has(segment.id)) })
        : item),
    }));
    setToast(selectedSegment?.splitGroupId ? "Разделённая смена удалена" : "Полёт удалён");
  }
  function importAviabit(payload: ImportPayload) {
    setData((current) => {
      const personId = payload.targetPersonId ?? uid();
      const aircraftTypes = [...new Set(payload.records.map((record) => record.aircraftType).filter(Boolean))];
      const people = payload.targetPersonId ? current.people : [...current.people, {
        id: personId,
        name: payload.personName,
        position: "Командир ВС",
        permissions: [],
        aircraftTypes,
        qualifications: aircraftTypes.length ? [{ id: uid(), operators: [], aircraftTypes, seats: ["Командир ВС"] }] : [],
        active: true,
      }];
      const kept = current.certifications.filter((record) => !(record.personId === personId && record.source === "aviabit"));
      return { ...current, people, certifications: [...kept, ...payload.records.map((record) => ({ ...record, personId }))] };
    });
    setAviabitModal(false); setView("personal"); setToast(`Импортировано записей: ${payload.records.length}`);
  }
  function upsertCertification(record: CertificationRecord) {
    setData((current) => ({ ...current, certifications: current.certifications.some((item) => item.id === record.id) ? current.certifications.map((item) => item.id === record.id ? record : item) : [...current.certifications, record] })); setToast("Запись личного дела сохранена");
  }
  function deleteCertification(recordId: string) { setData((current) => ({ ...current, certifications: current.certifications.filter((record) => record.id !== recordId) })); setToast("Запись удалена"); }
  function savePlanAssignment(assignment: PlanAssignment) {
    setData((current) => ({
      ...current,
      planAssignments: current.planAssignments.some((item) => item.id === assignment.id)
        ? current.planAssignments.map((item) => item.id === assignment.id ? assignment : item)
        : [...current.planAssignments.filter((item) => !(item.date === assignment.date && item.aircraft === assignment.aircraft && item.role === assignment.role)), assignment],
    }));
    setToast("Назначение сохранено");
  }
  function savePlanAssignments(assignments: PlanAssignment[]) {
    setData((current) => {
      const slotKeys = new Set(assignments.map((item) => `${item.date}|${item.aircraft}|${item.role}`));
      return {
        ...current,
        planAssignments: [
          ...current.planAssignments.filter((item) => !slotKeys.has(`${item.date}|${item.aircraft}|${item.role}`)),
          ...assignments,
        ],
      };
    });
    setToast(`Назначения сохранены: ${assignments.length}`);
  }
  function deletePlanAssignment(assignmentId: string) {
    setData((current) => ({ ...current, planAssignments: current.planAssignments.filter((item) => item.id !== assignmentId) }));
    setToast("Назначение удалено");
  }
  function savePlanBusy(entry: PlanBusyEntry) {
    setData((current) => ({
      ...current,
      planBusyEntries: current.planBusyEntries.some((item) => item.id === entry.id)
        ? current.planBusyEntries.map((item) => item.id === entry.id ? entry : item)
        : [...current.planBusyEntries, entry],
    }));
    setToast("Занятость сохранена");
  }
  function savePlanBusyEntries(entries: PlanBusyEntry[]) {
    setData((current) => ({ ...current, planBusyEntries: [...current.planBusyEntries, ...entries] }));
    setToast(`Дни занятости сохранены: ${entries.length}`);
  }
  function deletePlanBusy(entryId: string) {
    setData((current) => ({ ...current, planBusyEntries: current.planBusyEntries.filter((item) => item.id !== entryId) }));
    setToast("Занятость удалена");
  }
  function exportBackup() {
    download(`shtab-ls-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 6, exportedAt: new Date().toISOString(), data }, null, 2));
    setToast("Резервная копия сохранена");
  }
  function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    file.text().then((text) => {
      const parsed = JSON.parse(text) as { data?: AppData } | AppData;
      const restored = "data" in parsed && parsed.data ? parsed.data : parsed as AppData;
      if (!Array.isArray(restored.people) || !Array.isArray(restored.shifts)) throw new Error("Invalid backup");
      setData({
        people: restored.people.map(normalizePerson),
        shifts: restored.shifts.map(normalizeShift),
        certifications: restored.certifications ?? [],
        planAssignments: restored.planAssignments ?? [],
        planBusyEntries: restored.planBusyEntries ?? [],
      }); setToast("Резервная копия восстановлена");
    }).catch(() => setToast("Не удалось прочитать резервную копию"));
    event.target.value = "";
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <defs><filter id="brand-icon-teal"><feColorMatrix type="matrix" values="0 0 0 0 0.067 0 0 0 0 0.435 0 0 0 0 0.412 -0.333 -0.333 -0.333 0 1" /></filter></defs>
          <image href="favicon-32x32.png" width="32" height="32" filter="url(#brand-icon-teal)" />
        </svg>
      </div><div><strong>Штаб ЛС</strong><span>Рабочий контур</span></div></div>
      <nav className="main-nav" aria-label="Основная навигация">
        <NavButton active={view === "dashboard"} onClick={() => setView("dashboard")} label="Главная" glyph="⌂" />
        <NavButton active={view === "shifts"} onClick={() => setView("shifts")} label="Полётные смены" glyph="◷" />
        <NavButton active={view === "people"} onClick={() => setView("people")} label="Личный состав" glyph="◎" />
        <NavButton active={view === "personal"} onClick={() => setView("personal")} label="Личные дела" glyph="▤" />
        <NavButton active={view === "planning"} onClick={() => setView("planning")} label="Месячный план" glyph="▦" />
      </nav>
      <div className="local-card"><span className="status-dot" /><div><strong>Локальная база</strong><span>Данные только на этом устройстве</span></div></div>
      <div className="sidebar-actions"><button className="text-button" onClick={exportBackup}>Скачать резервную копию</button><button className="text-button" onClick={() => importRef.current?.click()}>Восстановить из файла</button><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={importBackup} /></div>
      <div className="company-logo">
        {/* The public asset must stay relative so it also works under the GitHub Pages repository path. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="solaris-logo.png" alt="Центр авиации «Солярис»" />
      </div>
    </aside>
    <main className="workspace" style={{ backgroundImage: 'linear-gradient(180deg, rgba(242, 245, 246, .62), rgba(242, 245, 246, .82)), url("solaris-berassom-bg.jpeg")' }}>
      <header className="topbar"><div className="topbar-title"><p className="eyebrow current-date">{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</p><h1>{view === "dashboard" ? "Оперативная информация" : view === "shifts" ? "Полётные смены" : view === "people" ? "Личный состав" : view === "personal" ? "Личные дела" : "Месячный план"}</h1></div>
        <WorldClocks />
        <div className="top-actions"><span className={`save-state ${saveState}`}>{saveState === "saved" ? "Сохранено" : saveState === "saving" ? "Сохраняю…" : "Ошибка сохранения"}</span></div>
      </header>
      {!hydrated ? <Loading /> : view === "dashboard"
        ? <Dashboard people={data.people} shifts={monthSortedShifts} alerts={alerts} totalWork={totalWork} totalFlight={totalFlight} restMap={restMap} assumedCompliantRestIds={assumedCompliantRestIds} onAddPerson={() => setPersonModal("new")} onAddShift={() => setShiftModal("new")} />
        : view === "shifts"
          ? <ShiftsView
            people={data.people}
            shifts={sortedShifts}
            assignments={data.planAssignments}
            busyEntries={data.planBusyEntries}
            restMap={restMap}
            assumedCompliantRestIds={assumedCompliantRestIds}
            onAdd={() => setShiftModal("new")}
            onEdit={setShiftModal}
            onDelete={deleteShift}
            onDeleteFlight={deleteFlight}
            onEditPlan={(request) => { setPlanEditRequest(request); setView("planning"); }}
            onDeletePlanAssignment={deletePlanAssignment}
            onDeletePlanBusy={deletePlanBusy}
            onNotify={setToast}
          />
          : view === "people"
            ? <PeopleView people={data.people} shifts={data.shifts} onAdd={() => setPersonModal("new")} onEdit={setPersonModal} onOpenPersonal={() => setView("personal")} />
            : view === "personal"
              ? <PersonalFilesView people={data.people} shifts={data.shifts} records={data.certifications} onImportClick={() => setAviabitModal(true)} onUpsert={upsertCertification} onDelete={deleteCertification} />
              : <MonthlyPlanView
                people={data.people}
                shifts={data.shifts}
                assignments={data.planAssignments}
                busyEntries={data.planBusyEntries}
                onSaveAssignment={savePlanAssignment}
                onSaveAssignments={savePlanAssignments}
                onDeleteAssignment={deletePlanAssignment}
                onSaveBusy={savePlanBusy}
                onSaveBusyEntries={savePlanBusyEntries}
                onDeleteBusy={deletePlanBusy}
                onNotify={setToast}
                editRequest={planEditRequest}
                onEditRequestHandled={() => setPlanEditRequest(null)}
              />}
    </main>
    {personModal && <PersonModal person={personModal === "new" ? null : personModal} onClose={() => setPersonModal(null)} onSubmit={savePerson} onDelete={personModal === "new" ? undefined : () => deletePerson(personModal)} />}
    {shiftModal && <ShiftModal people={data.people} shift={shiftModal === "new" ? null : shiftModal} onClose={() => setShiftModal(null)} onSubmit={saveShift} onDelete={shiftModal === "new" ? undefined : () => deleteShift(shiftModal)} />}
    {aviabitModal && <ImportAviabitModal people={data.people} onClose={() => setAviabitModal(false)} onSubmit={importAviabit} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function NavButton({ active, onClick, label, glyph }: { active: boolean; onClick: () => void; label: string; glyph: string }) { return <button className={active ? "active" : ""} onClick={onClick}><span>{glyph}</span>{label}</button>; }
function Loading() { return <div className="loading"><span /><p>Открываю локальную базу…</p></div>; }

function WorldClocks() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="world-clocks" aria-label="Текущее время">{operationalClocks.map((clock) => <div className="clock-card" key={clock.timeZone}><span>{clock.label}</span><strong>{now ? new Intl.DateTimeFormat("ru-RU", { timeZone: clock.timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now) : "--:--:--"}</strong></div>)}</div>;
}

function Dashboard({ people, shifts, alerts, totalWork, totalFlight, restMap, assumedCompliantRestIds, onAddPerson, onAddShift }: { people: Person[]; shifts: Shift[]; alerts: { id: string; severity: "danger" | "warning"; title: string; detail: string }[]; totalWork: number; totalFlight: number; restMap: Map<string, number>; assumedCompliantRestIds: Set<string>; onAddPerson: () => void; onAddShift: () => void }) {
  if (!people.length) return <section className="empty-start"><div className="empty-visual"><span>01</span><i /></div><p className="eyebrow">Начало работы</p><h2>Создайте первую карточку сотрудника</h2><p>После этого можно вносить смены, а система начнёт автоматически считать рабочее время и отдых.</p><button className="primary-button" onClick={onAddPerson}>Добавить сотрудника</button></section>;
  return <><section className="metric-grid"><Metric label="Активный состав" value={String(people.filter((person) => person.active).length)} detail="сотрудников в базе" tone="blue" /><Metric label="Рабочее время" value={formatDuration(totalWork)} detail="в текущем месяце" tone="navy" /><Metric label="Полётное время" value={formatDuration(totalFlight)} detail="в текущем месяце" tone="teal" /><Metric label="Полётные смены" value={String(shifts.filter((shift) => shift.activity === "flight").reduce((sum, shift) => sum + flightEntryCount(shift.segments), 0))} detail="в текущем месяце" tone="violet" /><Metric label="Требует внимания" value={String(alerts.length)} detail={alerts.length ? "открытых предупреждений" : "нарушений не выявлено"} tone={alerts.length ? "red" : "green"} /></section>
    <section className="content-grid"><article className="panel alerts-panel"><div className="panel-heading"><div><p className="eyebrow">Контроль</p><h2>Требует внимания</h2></div><span className="count-badge">{alerts.length}</span></div><div className="control-rules"><strong>Нормы отдыха · приказ № 381</strong><span>12 ч ежедневно · 42 ч после 6 рабочих дней · 48 ч после двух разделённых смен</span></div>{!alerts.length ? <div className="good-state"><span>✓</span><div><strong>Критических замечаний нет</strong><p>Новые предупреждения появятся после расчёта смен.</p></div></div> : alerts.slice(0, 5).map((alert) => <div className={`alert-row ${alert.severity}`} key={alert.id}><span className="alert-icon">!</span><div><strong>{alert.title}</strong><p>{alert.detail}</p></div></div>)}</article>
      <article className="panel recent-panel"><div className="panel-heading"><div><p className="eyebrow">Последние записи</p><h2>Недавние смены</h2></div><button className="link-button" onClick={onAddShift}>Добавить</button></div>{!shifts.length ? <div className="panel-empty">Смен пока нет</div> : shifts.slice(0, 5).map((shift) => { const person = people.find((item) => item.id === shift.personId); const rest = restMap.get(shift.id); const assumedCompliant = assumedCompliantRestIds.has(shift.id); return <div className="shift-row" key={shift.id}><div className="date-tile"><strong>{shift.date.slice(8, 10)}</strong><span>{new Intl.DateTimeFormat("ru-RU", { month: "short" }).format(new Date(`${shift.date}T12:00:00`)).replace(".", "")}</span></div><div className="shift-main"><strong>{person?.name ?? "Сотрудник"}</strong><span>{activityLabels[shift.activity]} · {shift.start || "без времени"}</span></div><div className="shift-meta"><strong>{shift.workMinutes ? formatDuration(shift.workMinutes) : "—"}</strong><span>{assumedCompliant ? "отдых по норме" : rest === undefined ? "первая смена" : `отдых ${formatDuration(rest)}`}</span></div></div>; })}</article></section></>;
}
function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <article className={`metric ${tone}`}><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>; }

function ShiftsView({
  people,
  shifts,
  assignments,
  busyEntries,
  restMap,
  assumedCompliantRestIds,
  onAdd,
  onEdit,
  onDelete,
  onDeleteFlight,
  onEditPlan,
  onDeletePlanAssignment,
  onDeletePlanBusy,
  onNotify,
}: {
  people: Person[];
  shifts: Shift[];
  assignments: PlanAssignment[];
  busyEntries: PlanBusyEntry[];
  restMap: Map<string, number>;
  assumedCompliantRestIds: Set<string>;
  onAdd: () => void;
  onEdit: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
  onDeleteFlight: (shift: Shift, segmentId: string) => void;
  onEditPlan: (request: PlanEditRequest) => void;
  onDeletePlanAssignment: (assignmentId: string) => void;
  onDeletePlanBusy: (entryId: string) => void;
  onNotify: (message: string) => void;
}) {
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  const [personId, setPersonId] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const filtered = shifts.filter((shift) => (!dateFrom || shift.date >= dateFrom) && (!dateTo || shift.date <= dateTo) && (!personId || shift.personId === personId));
  const journalRows = filtered.flatMap<{ shift: Shift; segment: Segment | null; segmentIndex: number }>((shift) => shift.activity === "flight" && shift.segments.length
    ? shift.segments.map((segment, segmentIndex) => ({ shift, segment, segmentIndex }))
    : [{ shift, segment: null, segmentIndex: 0 }]);
  const dateCells = groupedDateCells(journalRows.map(({ shift }) => ({ date: shift.date })));
  const plannedRows = [
    ...assignments
      .filter((assignment) => (!dateFrom || assignment.date >= dateFrom) && (!dateTo || assignment.date <= dateTo) && (!personId || assignment.personId === personId))
      .map((assignment) => ({ kind: "assignment" as const, date: assignment.date, personId: assignment.personId, assignment })),
    ...busyEntries.flatMap((entry) => datesInRange(entry.dateFrom, entry.dateTo)
      .filter((date) => (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo) && (!personId || entry.personId === personId))
      .map((date) => ({ kind: "busy" as const, date, personId: entry.personId, entry }))),
  ].sort((left, right) => right.date.localeCompare(left.date)
    || people.find((item) => item.id === left.personId)?.name.localeCompare(people.find((item) => item.id === right.personId)?.name ?? "", "ru-RU") || 0);
  const plannedDateCells = groupedDateCells(plannedRows.map((row) => ({ date: row.date })));
  function showCurrentMonth() {
    setDateFrom(localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
    setDateTo(localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  }
  function showToday() {
    const value = localIsoDate(today);
    setDateFrom(value); setDateTo(value);
  }
  return <><section className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">Единый журнал</p><h2>Смены за выбранный период</h2></div><div className="journal-heading-actions"><button className="secondary-button pdf-button" disabled={!people.length} onClick={() => setReportOpen(true)}>Отчёт PDF</button><button className="primary-button" disabled={!people.length} onClick={onAdd}>+ Новая смена</button></div></div>
    <div className="journal-filters"><Field label="Период с"><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></Field><Field label="Период по"><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></Field><Field label="Сотрудник"><select value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Все сотрудники</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field><div className="quick-filters"><button className="secondary-button" onClick={showToday}>Сегодня</button><button className="secondary-button" onClick={showCurrentMonth}>Текущий месяц</button></div></div>
    <div className="journal-summary">Показано строк: <strong>{journalRows.length}</strong>{dateFrom === dateTo ? ` · ${formatDate(dateFrom)}` : ` · ${formatDate(dateFrom)} — ${formatDate(dateTo)}`}</div>
    {!journalRows.length ? <div className="panel-empty tall">За выбранный период смен нет.</div> : <div className="table-scroll"><table><thead><tr><th>Дата</th><th>Сотрудник</th><th>Занятость</th><th>Начало–конец</th><th>ВС / кресло</th><th>Цель</th><th>Рабочее</th><th>Полётное / ночь</th><th>Отдых</th><th>Примечание</th><th>Действия</th></tr></thead><tbody>{journalRows.map(({ shift, segment, segmentIndex }, rowIndex) => {
      const rest = segmentIndex === 0 ? restMap.get(shift.id) : undefined;
      const assumedCompliant = segmentIndex === 0 && assumedCompliantRestIds.has(shift.id);
      const flight = segment?.flightMinutes ?? 0; const night = segment?.nightMinutes ?? 0;
      return <tr key={segment ? `${shift.id}-${segment.id}` : shift.id}>{dateCells[rowIndex].showDate && <td className="journal-date-cell" rowSpan={dateCells[rowIndex].rowSpan}>{formatDate(shift.date)}</td>}<td><strong>{people.find((item) => item.id === shift.personId)?.name ?? "—"}</strong></td><td><span className="journal-activity">{activityLabels[shift.activity]}{segment?.splitShift && <span className="split-pill active">Разделённая · часть {segment.splitPart ?? 1}</span>}</span></td><td>{segment ? `${segment.dutyStart || "—"}–${segment.dutyEnd || "—"}` : shift.start ? `${shift.start}–${shiftEndClock(shift)}` : "—"}</td><td>{segment ? <span className="aircraft-cell"><strong>{[segment.aircraftType, segment.aircraft].filter(Boolean).join(" · ") || "—"}</strong><small>{segment.seat}</small></span> : "—"}</td><td>{segment?.purpose || "—"}</td><td>{segment ? formatDuration(segmentDutyMinutes(segment)) : shift.workMinutes ? formatDuration(shift.workMinutes) : "—"}</td><td>{segment ? <span className="flight-cell"><strong>{flight ? formatDuration(flight) : "—"}</strong>{night > 0 && <small>ночь {formatDuration(night)}</small>}</span> : "—"}</td><td><span className={assumedCompliant ? "success-text" : rest !== undefined && rest >= 0 && rest < 720 ? "danger-text" : rest !== undefined && rest >= 2520 ? "success-text" : ""}>{assumedCompliant ? "по норме" : rest === undefined ? "—" : rest < 0 ? "пересечение" : formatDuration(rest)}</span></td><td className="note-cell">{shift.note || "—"}</td><td><div className="row-actions"><button onClick={() => onEdit(shift)}>Изменить</button><button className="delete" onClick={() => segment ? onDeleteFlight(shift, segment.id) : onDelete(shift)}>Удалить</button></div></td></tr>;
    })}</tbody></table></div>}
    <section className="planned-journal">
      <div className="planned-journal-heading"><div><strong>Занятость из месячного плана</strong><span>Показывается здесь сразу после записи в плане; фактическое время вносится отдельной сменой.</span></div><b>{plannedRows.length}</b></div>
      {!plannedRows.length ? <div className="panel-empty">В выбранном периоде запланированной занятости нет.</div> : <div className="table-scroll"><table className="planned-journal-table"><thead><tr><th>Дата</th><th>Сотрудник</th><th>Занятость</th><th>ВС / роль</th><th>Примечание</th><th>Действия</th></tr></thead><tbody>{plannedRows.map((row, rowIndex) => {
        const person = people.find((item) => item.id === row.personId);
        if (row.kind === "assignment") {
          const aircraftType = aircraftTypeForNumber(row.assignment.aircraft, aircraftNumbersByType);
          return <tr key={`assignment-${row.assignment.id}`}>{plannedDateCells[rowIndex].showDate && <td className="journal-date-cell" rowSpan={plannedDateCells[rowIndex].rowSpan}>{formatDate(row.date)}</td>}<td><strong>{person?.name ?? "—"}</strong></td><td><span className="journal-activity">Полётная смена</span></td><td><span className="aircraft-cell"><strong>{[aircraftType, row.assignment.aircraft].filter(Boolean).join(" · ")}</strong><small>{planRoleLabels[row.assignment.role]}</small></span></td><td className="note-cell">Назначение из месячного плана</td><td><div className="row-actions"><button onClick={() => onEditPlan({ kind: "assignment", id: row.assignment.id })}>Изменить</button><button className="delete" onClick={() => { if (window.confirm(`Удалить назначение ${person?.name ?? "сотрудника"} на ${row.assignment.aircraft} за ${formatDate(row.date)}?`)) onDeletePlanAssignment(row.assignment.id); }}>Удалить</button></div></td></tr>;
        }
        return <tr key={`busy-${row.entry.id}-${row.date}`}>{plannedDateCells[rowIndex].showDate && <td className="journal-date-cell" rowSpan={plannedDateCells[rowIndex].rowSpan}>{formatDate(row.date)}</td>}<td><strong>{person?.name ?? "—"}</strong></td><td><span className="journal-activity">{planBusyLabels[row.entry.activity]}</span></td><td>—</td><td className="note-cell">{row.entry.note || "—"}</td><td><div className="row-actions"><button onClick={() => onEditPlan({ kind: "busy", id: row.entry.id })}>Изменить</button><button className="delete" onClick={() => { if (window.confirm(`Удалить занятость «${planBusyLabels[row.entry.activity]}» за ${formatDate(row.date)}?`)) onDeletePlanBusy(row.entry.id); }}>Удалить</button></div></td></tr>;
      })}</tbody></table></div>}
    </section>
  </section>{reportOpen && <FlightReportModal people={people} shifts={shifts} onClose={() => setReportOpen(false)} onNotify={onNotify} />}</>;
}

function FlightReportModal({ people, shifts, onClose, onNotify }: { people: Person[]; shifts: Shift[]; onClose: () => void; onNotify: (message: string) => void }) {
  const today = new Date();
  const [reportType, setReportType] = useState<"flight" | "employment">("flight");
  const [dateFrom, setDateFrom] = useState(localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  const [personId, setPersonId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dateFrom || !dateTo || dateFrom > dateTo) { setError("Проверьте даты периода отчёта."); return; }
    setExporting(true); setError("");
    try {
      if (reportType === "flight") await downloadFlightReport(dateFrom, dateTo, people, shifts, personId || null);
      else await downloadEmploymentReport(dateFrom, dateTo, people, shifts, personId || null);
      onNotify("PDF-отчёт сформирован"); onClose();
    } catch {
      setError("Не удалось сформировать PDF. Попробуйте ещё раз.");
    } finally {
      setExporting(false);
    }
  }
  return <Modal title="Формирование отчёта" subtitle="Произвольный период и состав отчёта" onClose={onClose}><form className="form-stack" onSubmit={submit}><Field label="Вид отчёта"><select value={reportType} onChange={(event) => setReportType(event.target.value as "flight" | "employment")}><option value="flight">Отчёт о налёте</option><option value="employment">Месячный отчёт</option></select></Field><div className="form-grid two"><Field label="Период с"><input required type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></Field><Field label="Период по"><input required type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></Field></div><Field label="Состав отчёта"><select value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Все сотрудники — общий отчёт</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field><div className="report-scope-note">{reportType === "flight" ? "Отчёт показывает налёт в разрезе кресла, типа ВС и цели полёта; для общего состава добавляется сводная часть." : "Для каждого сотрудника будут показаны все календарные дни периода, вид занятости, тип ВС, рабочее, полётное, инструкторское и ночное время."}</div>{error && <div className="form-error">{error}</div>}<div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button" disabled={exporting}>{exporting ? "Формирую…" : "Скачать PDF"}</button></div></form></Modal>;
}

function PeopleView({ people, shifts, onAdd, onEdit, onOpenPersonal }: { people: Person[]; shifts: Shift[]; onAdd: () => void; onEdit: (person: Person) => void; onOpenPersonal: () => void }) {
  return <section className="panel people-panel">
    <div className="panel-heading"><div><p className="eyebrow">Реестр</p><h2>Сотрудники</h2></div><button className="primary-button" onClick={onAdd}>+ Добавить</button></div>
    {!people.length ? <div className="panel-empty tall">Карточки сотрудников ещё не созданы.</div> : <div className="people-grid">{people.map((person) => {
      const personShifts = shifts.filter((shift) => shift.personId === person.id);
      return <article className="person-card" key={person.id}>
        <div className="person-avatar">{person.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div>
        <div className="person-body">
          <strong>{person.name}</strong>
          <span>{person.position || "Кресла не указаны"}</span>
          <div className="person-qualification-list">{person.qualifications.length ? person.qualifications.map((qualification) => <div key={qualification.id}>
            <b>{qualification.operators.join(", ") || "Эксплуатант не указан"}</b>
            <span>{qualification.aircraftTypes.join(", ") || "Тип ВС не указан"}</span>
            <small>{qualification.seats.join(", ") || "Кресла не указаны"}</small>
          </div>) : <div><span>Наборы допуска не указаны</span></div>}</div>
          <div className="person-card-actions"><button onClick={onOpenPersonal}>Личное дело</button><button onClick={() => onEdit(person)}>Изменить</button></div>
        </div>
        <div className="person-stat"><strong>{personShifts.length}</strong><span>смен</span></div>
      </article>;
    })}</div>}
  </section>;
}

function PersonModal({ person, onClose, onSubmit, onDelete }: { person: Person | null; onClose: () => void; onSubmit: (person: Omit<Person, "id" | "active">) => void; onDelete?: () => void }) {
  const [name, setName] = useState(person?.name ?? "");
  const [qualifications, setQualifications] = useState<Qualification[]>(person?.qualifications ?? []);
  const [operators, setOperators] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [seats, setSeats] = useState<string[]>([]);
  const [editingQualificationId, setEditingQualificationId] = useState<string | null>(null);
  const [error, setError] = useState("");

  function resetQualificationDraft() {
    setOperators([]); setTypes([]); setSeats([]); setEditingQualificationId(null); setError("");
  }

  function saveQualification() {
    if (!operators.length || !types.length || !seats.length) {
      setError("Для набора выберите эксплуатанта, тип ВС и хотя бы одно занимаемое кресло.");
      return;
    }
    const qualification: Qualification = {
      id: editingQualificationId ?? uid(),
      operators: orderedUnique(operators, operatorOptions),
      aircraftTypes: orderedUnique(types, aircraftTypeOptions),
      seats: orderedUnique(seats, positionOptions),
    };
    setQualifications((current) => editingQualificationId
      ? current.map((item) => item.id === editingQualificationId ? qualification : item)
      : [...current, qualification]);
    resetQualificationDraft();
  }

  function editQualification(qualification: Qualification) {
    setOperators(qualification.operators); setTypes(qualification.aircraftTypes); setSeats(qualification.seats);
    setEditingQualificationId(qualification.id); setError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("Укажите Ф. И. О. сотрудника."); return; }
    if (operators.length || types.length || seats.length || editingQualificationId) { setError("Сначала добавьте или сохраните заполненный набор допуска."); return; }
    if (!qualifications.length) { setError("Добавьте хотя бы один набор допуска сотрудника."); return; }
    if (qualifications.some((qualification) => !qualification.operators.length || !qualification.aircraftTypes.length || !qualification.seats.length)) {
      setError("Отредактируйте неполный набор: эксплуатант, тип ВС и кресла обязательны."); return;
    }
    const permissions = orderedUnique(qualifications.flatMap((qualification) => qualification.operators), operatorOptions);
    const aircraftTypes = orderedUnique(qualifications.flatMap((qualification) => qualification.aircraftTypes), aircraftTypeOptions);
    const position = orderedUnique(qualifications.flatMap((qualification) => qualification.seats), positionOptions).join(", ");
    onSubmit({ name: name.trim(), position, permissions, aircraftTypes, qualifications });
  }
  return <Modal title={person ? "Редактирование сотрудника" : "Новый сотрудник"} subtitle="Эксплуатант → тип ВС → занимаемые кресла" onClose={onClose} wide>
    <form onSubmit={submit} className="form-stack person-form">
      <Field label="Ф. И. О."><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="Иванов Иван Иванович" /></Field>
      <section className="qualification-builder">
        <div className="qualification-builder-heading"><div><strong>{editingQualificationId ? "Изменение набора допуска" : "Новый набор допуска"}</strong><span>Последовательно выберите данные и добавьте набор в карточку сотрудника.</span></div>{editingQualificationId && <button type="button" className="link-button" onClick={resetQualificationDraft}>Отменить изменение набора</button>}</div>
        <div className="qualification-step"><span>1</span><CheckboxGroup label="Эксплуатант" options={operatorOptions} values={operators} onChange={setOperators} /></div>
        <div className="qualification-step"><span>2</span><CheckboxGroup label="Тип ВС" options={aircraftTypeOptions} values={types} onChange={setTypes} columns={4} /></div>
        <div className="qualification-step"><span>3</span><CheckboxGroup label="Занимаемые кресла" options={positionOptions} values={seats} onChange={setSeats} /></div>
        <div className="qualification-add"><button type="button" className="secondary-button" onClick={saveQualification}>{editingQualificationId ? "Сохранить набор" : "+ Добавить набор"}</button></div>
      </section>
      {qualifications.length > 0 && <section className="qualification-list"><div className="section-label"><strong>Добавленные наборы</strong><span>{qualifications.length}</span></div>{qualifications.map((qualification, index) => <article className={editingQualificationId === qualification.id ? "editing" : ""} key={qualification.id}>
        <div className="qualification-index">{index + 1}</div>
        <div><small>Эксплуатант</small><strong>{qualification.operators.join(", ") || "Не указан"}</strong></div>
        <div><small>Тип ВС</small><strong>{qualification.aircraftTypes.join(", ") || "Не указан"}</strong></div>
        <div><small>Кресла</small><strong>{qualification.seats.join(", ") || "Не указаны"}</strong></div>
        <div className="qualification-actions"><button type="button" onClick={() => editQualification(qualification)}>Изменить</button><button type="button" className="delete" onClick={() => { setQualifications((current) => current.filter((item) => item.id !== qualification.id)); if (editingQualificationId === qualification.id) resetQualificationDraft(); }}>Удалить</button></div>
      </article>)}</section>}
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions split">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>Удалить сотрудника</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">{person ? "Подтвердить изменения" : "Добавить сотрудника"}</button></div>
    </form>
  </Modal>;
}

type SegmentDraft = {
  id: string;
  aircraft: string;
  aircraftType: string;
  seat: Seat;
  purpose: string;
  dutyStart: string;
  dutyEnd: string;
  flight: string;
  night: string;
  splitShift: boolean;
  splitGroupId?: string;
  splitPart?: 1 | 2;
};

function createSegmentDraft(aircraftType: string, dutyStart = "08:00"): SegmentDraft {
  return {
    id: uid(),
    aircraft: "",
    aircraftType,
    seat: "КВС",
    purpose: "АОН",
    dutyStart,
    dutyEnd: clockAfterMinutes(dutyStart, 480),
    flight: "00:00",
    night: "00:00",
    splitShift: false,
  };
}

function splitSecondPart(first: SegmentDraft, groupId: string): SegmentDraft {
  const dutyStart = clockAfterMinutes(first.dutyEnd, 240) || first.dutyEnd;
  return {
    ...first,
    id: uid(),
    dutyStart,
    dutyEnd: clockAfterMinutes(dutyStart, 240),
    flight: "00:00",
    night: "00:00",
    splitShift: true,
    splitGroupId: groupId,
    splitPart: 2,
  };
}

function initializeSegmentDrafts(shift: Shift | null, defaultAircraftType: string): SegmentDraft[] {
  if (!shift?.segments.length) return [createSegmentDraft(defaultAircraftType)];
  const drafts: SegmentDraft[] = shift.segments.map((item) => ({
    id: item.id,
    aircraft: item.aircraft,
    aircraftType: item.aircraftType ?? defaultAircraftType,
    seat: item.seat ?? "КВС",
    purpose: item.purpose || "АОН",
    dutyStart: item.dutyStart || shift.start || "08:00",
    dutyEnd: item.dutyEnd || clockAfterMinutes(shift.start || "08:00", shift.workMinutes || 480),
    flight: durationValue(item.flightMinutes),
    night: durationValue(item.nightMinutes),
    splitShift: Boolean(item.splitShift),
    splitGroupId: item.splitGroupId,
    splitPart: item.splitPart,
  }));
  const result: SegmentDraft[] = [];
  const handledGroups = new Set<string>();
  drafts.forEach((draft) => {
    if (!draft.splitShift) {
      result.push({ ...draft, splitGroupId: undefined, splitPart: undefined });
      return;
    }
    const groupId = draft.splitGroupId ?? uid();
    if (handledGroups.has(groupId)) return;
    handledGroups.add(groupId);
    const storedParts = draft.splitGroupId
      ? drafts.filter((item) => item.splitGroupId === draft.splitGroupId).sort((left, right) => (left.splitPart ?? 1) - (right.splitPart ?? 1))
      : [draft];
    const first = { ...storedParts[0], splitShift: true, splitGroupId: groupId, splitPart: 1 as const };
    const second = storedParts[1]
      ? { ...storedParts[1], splitShift: true, splitGroupId: groupId, splitPart: 2 as const }
      : splitSecondPart(first, groupId);
    result.push(first, second);
  });
  return result;
}

function groupSegmentDrafts(segments: SegmentDraft[]): SegmentDraft[][] {
  const result: SegmentDraft[][] = [];
  const handledGroups = new Set<string>();
  segments.forEach((segment) => {
    if (!segment.splitGroupId) {
      result.push([segment]);
      return;
    }
    if (handledGroups.has(segment.splitGroupId)) return;
    handledGroups.add(segment.splitGroupId);
    result.push(segments
      .filter((item) => item.splitGroupId === segment.splitGroupId)
      .sort((left, right) => (left.splitPart ?? 1) - (right.splitPart ?? 1)));
  });
  return result;
}

function ShiftModal({ people, shift, onClose, onSubmit, onDelete }: { people: Person[]; shift: Shift | null; onClose: () => void; onSubmit: (shift: ShiftDraft) => void; onDelete?: () => void }) {
  const initialDate = shift?.periodStart ?? shift?.date ?? localIsoDate(new Date());
  const [personId, setPersonId] = useState(shift?.personId ?? "");
  const [date, setDate] = useState(initialDate);
  const [dateTo, setDateTo] = useState(shift?.periodEnd ?? initialDate);
  const [activity, setActivity] = useState<Activity>(shift?.periodActivity ?? shift?.activity ?? "flight");
  const [start, setStart] = useState(shift?.start ?? "08:00");
  const [work, setWork] = useState(shift ? durationValue(shift.workMinutes) : "08:00");
  const [note, setNote] = useState(shift?.periodNote ?? shift?.note ?? "");
  const [error, setError] = useState("");
  const selectedAircraftTypes = people.find((person) => person.id === personId)?.aircraftTypes ?? [];
  const defaultAircraftType = selectedAircraftTypes.length === 1 ? selectedAircraftTypes[0] : "";
  const [segments, setSegments] = useState<SegmentDraft[]>(() => initializeSegmentDrafts(shift, defaultAircraftType));
  const supportsPeriod = multiDayActivities.includes(activity);
  const segmentGroups = groupSegmentDrafts(segments);

  function changePerson(nextPersonId: string) {
    const availableTypes = people.find((person) => person.id === nextPersonId)?.aircraftTypes ?? [];
    const nextAircraftType = availableTypes.length === 1 ? availableTypes[0] : "";
    setPersonId(nextPersonId);
    setSegments((current) => current.map((item) => ({ ...item, aircraftType: nextAircraftType, aircraft: "" })));
    setError("");
  }

  function updateSegment(segmentId: string, patch: Partial<SegmentDraft>) {
    setSegments((current) => current.map((item) => item.id === segmentId ? { ...item, ...patch } : item));
  }

  function toggleSplit(segmentId: string, checked: boolean) {
    setSegments((current) => {
      const segment = current.find((item) => item.id === segmentId);
      if (!segment) return current;
      if (checked && !segment.splitShift) {
        const groupId = uid();
        const first = { ...segment, splitShift: true, splitGroupId: groupId, splitPart: 1 as const };
        const second = splitSecondPart(first, groupId);
        const index = current.findIndex((item) => item.id === segmentId);
        return [...current.slice(0, index), first, second, ...current.slice(index + 1)];
      }
      if (!checked && segment.splitShift) {
        const groupId = segment.splitGroupId;
        const parts = groupId ? current.filter((item) => item.splitGroupId === groupId) : [segment];
        const first = { ...(parts.find((item) => item.splitPart === 1) ?? parts[0]), splitShift: false, splitGroupId: undefined, splitPart: undefined };
        const firstIndex = Math.min(...parts.map((part) => current.findIndex((item) => item.id === part.id)));
        const kept = current.filter((item) => !parts.some((part) => part.id === item.id));
        return [...kept.slice(0, firstIndex), first, ...kept.slice(firstIndex)];
      }
      return current;
    });
  }

  function removeSegmentGroup(segment: SegmentDraft) {
    setSegments((current) => current.filter((item) =>
      segment.splitGroupId ? item.splitGroupId !== segment.splitGroupId : item.id !== segment.id));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!personId) { setError("Выберите сотрудника."); return; }
    if (supportsPeriod && (!dateTo || dateTo < date)) { setError("Дата окончания периода не может быть раньше даты начала."); return; }
    const safeStart = usesTime(activity) && activity !== "flight" ? normalizeTime(start, true) : "";
    const safeWork = usesTime(activity) && activity !== "flight" ? normalizeTime(work) : "";
    if (usesTime(activity) && activity !== "flight" && (!safeStart || !safeWork)) { setError("Проверьте время: минуты должны быть от 00 до 59."); return; }
    if (activity === "flight" && !selectedAircraftTypes.length) { setError("Сначала укажите типы ВС в карточке выбранного сотрудника."); return; }
    if (activity === "flight" && segments.some((item) => !item.aircraftType || !selectedAircraftTypes.includes(item.aircraftType))) { setError("Выберите тип ВС из допусков выбранного сотрудника."); return; }
    if (activity === "flight" && segments.some((item) => aircraftNumbersForType(item.aircraftType).length > 0 && !isAircraftNumberAllowed(item.aircraftType, item.aircraft))) { setError("Выберите бортовой номер из списка для указанного типа ВС."); return; }
    if (activity === "flight" && segments.some((item) => {
      const dutyStart = normalizeTime(item.dutyStart, true); const dutyEnd = normalizeTime(item.dutyEnd, true);
      return !dutyStart || !dutyEnd || dutyStart === dutyEnd;
    })) { setError("Проверьте начало и окончание каждой смены: время должно быть заполнено и отличаться."); return; }
    if (activity === "flight" && segments.some((item) => (item.flight && !normalizeTime(item.flight)) || (item.night && !normalizeTime(item.night)))) { setError("Проверьте полётное и ночное время."); return; }
    const safeSegments: Segment[] = activity === "flight" ? segments.map((item) => ({
      id: item.id,
      aircraft: item.aircraft.trim(),
      aircraftType: item.aircraftType.trim(),
      seat: item.seat,
      purpose: item.purpose,
      dutyStart: normalizeTime(item.dutyStart, true),
      dutyEnd: normalizeTime(item.dutyEnd, true),
      flightMinutes: parseDuration(normalizeTime(item.flight) || "00:00"),
      nightMinutes: parseDuration(normalizeTime(item.night) || "00:00"),
      splitShift: item.splitShift,
      splitGroupId: item.splitGroupId,
      splitPart: item.splitPart,
    })) : [];
    if (activity === "flight") {
      const splitGroupIds = [...new Set(safeSegments.filter((item) => item.splitShift).map((item) => item.splitGroupId).filter(Boolean))] as string[];
      const invalidSplit = splitGroupIds.some((groupId) => {
        const parts = safeSegments.filter((item) => item.splitGroupId === groupId).sort((left, right) => (left.splitPart ?? 1) - (right.splitPart ?? 1));
        const ranges = segmentMinuteRanges(parts);
        return parts.length !== 2 || ranges.length !== 2 || ranges[1].start <= ranges[0].end;
      });
      if (invalidSplit) { setError("Во второй части разделённой смены начало должно быть позже окончания первой части."); return; }
    }
    onSubmit({
      personId,
      date,
      dateTo: supportsPeriod ? dateTo : date,
      activity,
      start: activity === "flight" ? safeSegments[0]?.dutyStart ?? "" : safeStart,
      workMinutes: activity === "flight" ? flightWorkMinutes(safeSegments) : safeWork ? parseDuration(safeWork) : 0,
      segments: safeSegments,
      note,
    });
  }

  return <Modal title={shift ? "Редактирование записи" : "Новая запись"} subtitle={shift?.periodId ? "Изменения применятся ко всему связанному периоду" : "Данные о выполненной занятости"} onClose={onClose} wide>
    <form onSubmit={submit} className="form-stack">
      <Field label="Сотрудник"><select required value={personId} onChange={(event) => changePerson(event.target.value)}><option value="">Выберите сотрудника</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
      <Field label="Вид занятости"><div className="activity-grid">{Object.entries(activityLabels).map(([key, label]) => <button type="button" key={key} className={activity === key ? "selected" : ""} onClick={() => { setActivity(key as Activity); setError(""); }}>{label}</button>)}</div></Field>
      {supportsPeriod ? <div className="form-grid two"><Field label="Период с"><input required type="date" value={date} onChange={(event) => { setDate(event.target.value); if (dateTo < event.target.value) setDateTo(event.target.value); }} /></Field><Field label="Период по" hint="Каждый календарный день"><input required type="date" min={date} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></Field></div> : <Field label="Дата"><input required type="date" value={date} onChange={(event) => { setDate(event.target.value); setDateTo(event.target.value); }} /></Field>}
      {usesTime(activity) && activity !== "flight" && <div className="form-grid two"><Field label="Начало" hint="Например, 0830 → 08:30"><TimeEntry required clock value={start} onChange={setStart} /></Field><Field label="Рабочее время" hint="Например, 800 → 08:00"><TimeEntry required value={work} onChange={setWork} /></Field></div>}
      {activity === "flight" && <div className="segments">
        <div className="section-label"><strong>Полёты внутри смены</strong><button type="button" className="link-button" onClick={() => setSegments((current) => {
          const dutyStart = current.at(-1)?.dutyEnd || "08:00";
          return [...current, createSegmentDraft(defaultAircraftType, dutyStart)];
        })}>+ Добавить полёт</button></div>
        {segmentGroups.map((group, index) => {
          const first = group[0];
          return <div className={`segment-row ${first.splitShift ? "split-entry" : ""}`} key={first.splitGroupId ?? first.id}>
            <span className="segment-number">{index + 1}</span>
            <div className="segment-content">
              <div className="flight-entry-heading">
                <div><strong>Полёт {index + 1}</strong>{first.splitShift && <span>две части с раздельным вводом данных</span>}</div>
                <label className="split-shift-checkbox"><input type="checkbox" checked={first.splitShift} onChange={(event) => toggleSplit(first.id, event.target.checked)} /><span>Разделённая смена</span></label>
              </div>
              <div className={first.splitShift ? "split-parts-grid" : ""}>
                {group.map((segment) => <SegmentDraftFields
                  key={segment.id}
                  segment={segment}
                  partLabel={first.splitShift ? `${segment.splitPart === 2 ? "2-я" : "1-я"} часть смены` : undefined}
                  personSelected={Boolean(personId)}
                  selectedAircraftTypes={selectedAircraftTypes}
                  onChange={(patch) => updateSegment(segment.id, patch)}
                />)}
              </div>
            </div>
            {segmentGroups.length > 1 && <button type="button" className="remove-segment" aria-label="Удалить полёт" onClick={() => removeSegmentGroup(first)}>×</button>}
          </div>;
        })}
      </div>}
      {supportsPeriod && <div className="report-scope-note">{activity === "periodic_training" ? "Время начала и рабочее время не указываются. Отдых между периодической подготовкой и полётной сменой принимается соответствующим установленным нормам. Каждое воскресенье внутри периода будет автоматически отмечено как «Выходной». " : ""}Запись будет показана отдельно за каждый календарный день периода. Редактирование или удаление одного дня откроет весь связанный период.</div>}
      {error && <div className="form-error">{error}</div>}
      <Field label="Примечание"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Проверка, тренаж, особые обстоятельства…" /></Field>
      <div className="form-actions split">{onDelete && <button type="button" className="danger-button" onClick={onDelete}>{shift?.periodId ? "Удалить период" : "Удалить запись"}</button>}<span /><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button">{supportsPeriod ? "Сохранить период" : "Сохранить запись"}</button></div>
    </form>
  </Modal>;
}

function SegmentDraftFields({
  segment,
  partLabel,
  personSelected,
  selectedAircraftTypes,
  onChange,
}: {
  segment: SegmentDraft;
  partLabel?: string;
  personSelected: boolean;
  selectedAircraftTypes: string[];
  onChange: (patch: Partial<SegmentDraft>) => void;
}) {
  return <section className={partLabel ? "split-part-card" : ""}>
    {partLabel && <div className="split-part-heading"><strong>{partLabel}</strong><span>{segment.splitPart === 1 ? "до перерыва" : "после перерыва"}</span></div>}
    <div className="segment-field-grid">
      <Field label="Начало смены" hint="0830 → 08:30"><TimeEntry required clock value={segment.dutyStart} onChange={(value) => onChange({ dutyStart: value })} /></Field>
      <Field label="Конец смены" hint="1630 → 16:30"><TimeEntry required clock value={segment.dutyEnd} onChange={(value) => onChange({ dutyEnd: value })} /></Field>
      <Field label="Кресло"><select value={segment.seat} onChange={(event) => onChange({ seat: event.target.value as Seat })}>{seatOptions.map((seat) => <option key={seat}>{seat}</option>)}</select></Field>
      <Field label="Тип ВС"><select required disabled={!personSelected || !selectedAircraftTypes.length} value={segment.aircraftType} onChange={(event) => onChange({ aircraftType: event.target.value, aircraft: "" })}><option value="">{!personSelected ? "Сначала выберите сотрудника" : selectedAircraftTypes.length ? "Выберите тип ВС" : "Нет указанных типов ВС"}</option>{selectedAircraftTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
      <Field label="Бортовой №"><AircraftNumberSelect aircraftType={segment.aircraftType} value={segment.aircraft} onChange={(value) => onChange({ aircraft: value })} /></Field>
      <Field label="Цель"><select value={segment.purpose} onChange={(event) => onChange({ purpose: event.target.value })}>{flightPurposes.map((purpose) => <option key={purpose}>{purpose}</option>)}</select></Field>
      <Field label="Полётное" hint="0130 → 01:30"><TimeEntry value={segment.flight} onChange={(value) => onChange({ flight: value })} /></Field>
      <Field label="Ночь" hint="0045 → 00:45"><TimeEntry value={segment.night} onChange={(value) => onChange({ night: value })} /></Field>
    </div>
  </section>;
}

function TimeEntry({ value, onChange, clock, required }: { value: string; onChange: (value: string) => void; clock?: boolean; required?: boolean }) {
  return <input type="text" inputMode="numeric" required={required} value={value} placeholder="0000" onChange={(event) => onChange(compactTime(event.target.value))} onBlur={() => { const normalized = normalizeTime(value, clock); if (normalized) onChange(normalized); }} />;
}

function AircraftNumberSelect({ aircraftType, value, onChange }: { aircraftType: string; value: string; onChange: (value: string) => void }) {
  const availableNumbers = aircraftNumbersForType(aircraftType);
  const legacyNumber = value && !availableNumbers.length ? value : "";
  const options = legacyNumber ? [legacyNumber] : [...availableNumbers];
  const displayedValue = options.includes(value) ? value : "";
  const placeholder = !aircraftType
    ? "Сначала выберите тип ВС"
    : options.length
      ? "Выберите бортовой №"
      : "Для типа ВС борта не указаны";
  return <select required={availableNumbers.length > 0} disabled={!aircraftType || !options.length} value={displayedValue} onChange={(event) => onChange(event.target.value)}>
    <option value="">{placeholder}</option>
    {options.map((aircraftNumber) => <option key={aircraftNumber} value={aircraftNumber}>{aircraftNumber}</option>)}
  </select>;
}

function CheckboxGroup({ label, options, values, onChange, columns = 3 }: { label: string; options: string[]; values: string[]; onChange: (values: string[]) => void; columns?: 3 | 4 }) {
  return <fieldset className={`checkbox-group columns-${columns}`}><legend>{label}</legend><div>{options.map((option) => <label key={option}><input type="checkbox" checked={values.includes(option)} onChange={(event) => onChange(event.target.checked ? [...values, option] : values.filter((value) => value !== option))} /><span>{option}</span></label>)}</div></fieldset>;
}

function Modal({ title, subtitle, onClose, wide, children }: { title: string; subtitle: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><p className="eyebrow">Штаб ЛС</p><h2 id="modal-title">{title}</h2><span>{subtitle}</span></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header>{children}</section></div>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>; }
