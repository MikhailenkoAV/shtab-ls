"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { activityUsesTime as usesTime, isRestNeutralActivity, normalizeActivityTiming } from "./activity-rules";
import { aircraftNumbersByType, aircraftNumbersForType, canonicalAircraftType, isAircraftNumberAllowed } from "./aircraft-rules";
import {
  downloadEmploymentReport,
  downloadFlightReport,
  downloadSummaryFlightReport,
} from "./monthly-report";
import {
  CUMULATIVE_APPEND_START,
  downloadCumulativeFlightExcel,
} from "./cumulative-flight-report";
import { MonthlyPlanView, PlanEditRequest } from "./monthly-plan";
import { ActualPlanView } from "./actual-plan";
import {
  aircraftTypeForNumber,
  planBusyLabels,
  planRoleLabels,
  PlanAssignment,
  PlanBusyEntry,
} from "./monthly-plan-rules";
import { CertificationRecord, ImportAviabitModal, ImportPayload } from "./personal-files";
import { isMedicalCertificationSuperseded, latestCertificationRecords } from "./personal-files-rules";
import { PersonalFilesView } from "./personal-overview";
import {
  calculateRestIssues,
  isSundayDate,
  restMinutesAroundDate,
  RestDayInput,
  RestIntervalInput,
  RestIssue,
} from "./rest-rules";
import { groupedDateCells } from "./journal-rules";
import { WorkTimeImportModal } from "./work-time-import";
import { ImportedWorkTimeShift, mergeImportedWorkTime } from "./work-time-import-rules";
import { ControlJournalView } from "./control-journal";
import {
  buildControlRows,
  compareAttentionDates,
  isControlAttention,
} from "./control-journal-rules";
import { expandLinkedCrewShifts } from "./crew-rules";
import { dashboardRows, isCurrentMonthDate } from "./dashboard-rules";
import { backupFileName } from "./backup-rules";
import {
  backupChecksum,
  changedDataSections,
  RecoveryCheckpoint,
  TrashEntry,
  TrashKind,
  validateBackupEnvelope,
} from "./recovery-rules";
import { DocumentationView } from "./documentation";
import registrySeedJson from "./document-registry-seed.json";
import medicalReferralsSeedJson from "./medical-referrals-seed.json";
import {
  DocumentPersonProfile,
  DocumentRegistryRecord,
  DocumentSettings,
  EMPTY_DOCUMENT_PROFILE,
  EMPTY_DOCUMENT_SETTINGS,
  normalizeDocumentSettings,
  MedicalReferralRecord,
} from "./documentation-rules";
import { FlightBookBaseline } from "./flight-book-rules";
import { employeeReadiness, EmployeeReadiness, readinessBlockReason } from "./readiness-rules";
import { CrewDeploymentView } from "./crew-deployment";
import {
  DEFAULT_PERSONAL_DOCUMENT_DEFINITIONS,
  migratePersonalDocumentDefinitions,
  normalizePilotPersonalProfile,
  PERSONAL_DOCUMENT_DEFINITIONS_VERSION,
  PersonalDocumentDefinition,
  PilotPersonalProfile,
} from "./pilot-profile-rules";

type View = "dashboard" | "shifts" | "people" | "personal" | "control" | "crew" | "planning" | "actual" | "documentation" | "settings";
type Activity = "flight" | "trip" | "office" | "periodic_training" | "ground_training" | "standby" | "vacation" | "dayoff";
type Seat = "КВС" | "Пилот-инструктор";

type Qualification = {
  id: string;
  operators: string[];
  aircraftTypes: string[];
  seats: string[];
  nightAircraftTypes: string[];
};
type Person = { id: string; name: string; position: string; permissions: string[]; aircraftTypes: string[]; qualifications: Qualification[]; active: boolean };
type Segment = {
  id: string; aircraft: string; aircraftType?: string; seat: Seat; purpose: string;
  dutyStart: string; dutyEnd: string; flightMinutes: number; nightMinutes: number; splitShift: boolean;
  dayLandings?: number; nightLandings?: number;
  excludedWorkMinutes?: number;
  splitGroupId?: string; splitPart?: 1 | 2;
  commanderPersonId?: string;
};
type Shift = {
  id: string; personId: string; date: string; activity: Activity; start: string; workMinutes: number;
  segments: Segment[]; note: string; createdAt: string;
  periodId?: string; periodStart?: string; periodEnd?: string;
  periodActivity?: Activity; periodNote?: string;
  linkedSourceShiftId?: string; linkedPrimaryPersonId?: string;
};
type ShiftDraft = Omit<Shift, "id" | "createdAt" | "periodId" | "periodStart" | "periodEnd" | "periodActivity" | "periodNote"> & { dateTo?: string };
type CompanySettings = {
  fullName: string;
  shortName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
  chiefOfStaff: string;
  deputyFlightOperations: string;
  generalDirector: string;
};
type DashboardAlert = {
  id: string;
  severity: "danger" | "warning";
  title: string;
  detail: string;
  sortDate: string;
};
type AppData = {
  people: Person[];
  shifts: Shift[];
  certifications: CertificationRecord[];
  planAssignments: PlanAssignment[];
  planBusyEntries: PlanBusyEntry[];
  settings: CompanySettings;
  documentRegistry: DocumentRegistryRecord[];
  medicalReferrals: MedicalReferralRecord[];
  documentProfiles: Record<string, DocumentPersonProfile>;
  documentSettings: DocumentSettings;
  flightBookBaselines: FlightBookBaseline[];
  personalProfiles: Record<string, PilotPersonalProfile>;
  personalDocumentDefinitions: PersonalDocumentDefinition[];
  personalDocumentDefinitionsVersion: number;
  trash: TrashEntry[];
};
const REGISTRY_SEED = registrySeedJson as DocumentRegistryRecord[];
const MEDICAL_REFERRALS_SEED = medicalReferralsSeedJson as MedicalReferralRecord[];

const EMPTY_SETTINGS: CompanySettings = {
  fullName: "",
  shortName: "",
  inn: "",
  kpp: "",
  ogrn: "",
  legalAddress: "",
  actualAddress: "",
  chiefOfStaff: "",
  deputyFlightOperations: "",
  generalDirector: "",
};
const EMPTY_DATA: AppData = {
  people: [],
  shifts: [],
  certifications: [],
  planAssignments: [],
  planBusyEntries: [],
  settings: EMPTY_SETTINGS,
  documentRegistry: REGISTRY_SEED,
  medicalReferrals: MEDICAL_REFERRALS_SEED,
  documentProfiles: {},
  documentSettings: EMPTY_DOCUMENT_SETTINGS,
  flightBookBaselines: [],
  personalProfiles: {},
  personalDocumentDefinitions: DEFAULT_PERSONAL_DOCUMENT_DEFINITIONS,
  personalDocumentDefinitionsVersion: PERSONAL_DOCUMENT_DEFINITIONS_VERSION,
  trash: [],
};
const DB_NAME = "shtab-ls";
const STORE_NAME = "workspace";
const STATE_KEY = "primary";
const RECOVERY_KEY = "recovery-checkpoints-v1";
const MAX_CHECKPOINTS = 20;
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
const aircraftTypeOptions = ["A109", "AW109", "AW139", "AS350", "EC130", "R44", "R66", "BO105", "Bell407"];
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
    excludedWorkMinutes: Math.max(0, segment.excludedWorkMinutes ?? 0),
    dayLandings: Math.max(0, Math.floor(segment.dayLandings ?? 0)),
    nightLandings: Math.max(0, Math.floor(segment.nightLandings ?? 0)),
    splitShift: Boolean(segment.splitShift),
    splitPart: segment.splitPart === 1 || segment.splitPart === 2 ? segment.splitPart : undefined,
    commanderPersonId: segment.seat?.toLocaleLowerCase("ru-RU").includes("инструктор")
      ? segment.commanderPersonId
      : undefined,
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
    aircraftTypes: orderedUnique((qualification.aircraftTypes ?? []).map(canonicalAircraftType), aircraftTypeOptions),
    seats: orderedUnique(qualification.seats ?? [], positionOptions),
    nightAircraftTypes: orderedUnique(
      (qualification.nightAircraftTypes ?? []).map(canonicalAircraftType)
        .filter((aircraftType) => (qualification.aircraftTypes ?? []).map(canonicalAircraftType).includes(aircraftType)),
      aircraftTypeOptions,
    ),
  })) : ((person.permissions?.length || person.aircraftTypes?.length || legacySeats.length) ? [{
    id: `${person.id}-legacy-qualification`,
    operators: orderedUnique(person.permissions ?? [], operatorOptions),
    aircraftTypes: orderedUnique((person.aircraftTypes ?? []).map(canonicalAircraftType), aircraftTypeOptions),
    seats: orderedUnique(legacySeats, positionOptions),
    nightAircraftTypes: [],
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

function normalizeAppData(stored?: Partial<AppData>): AppData {
  return {
        people: (stored?.people ?? []).map(normalizePerson),
        shifts: (stored?.shifts ?? []).map(normalizeShift),
        certifications: stored?.certifications ?? [],
        planAssignments: stored?.planAssignments ?? [],
        planBusyEntries: stored?.planBusyEntries ?? [],
        settings: { ...EMPTY_SETTINGS, ...(stored?.settings ?? {}) },
        documentRegistry: stored?.documentRegistry ?? REGISTRY_SEED,
        medicalReferrals: stored?.medicalReferrals ?? MEDICAL_REFERRALS_SEED,
        documentProfiles: stored?.documentProfiles ?? {},
        documentSettings: normalizeDocumentSettings(stored?.documentSettings),
        flightBookBaselines: stored?.flightBookBaselines ?? [],
        personalProfiles: Object.fromEntries(Object.entries(stored?.personalProfiles ?? {})
          .map(([personId, profile]) => [personId, normalizePilotPersonalProfile(profile)])),
        personalDocumentDefinitions: migratePersonalDocumentDefinitions(
          stored?.personalDocumentDefinitions,
          stored?.personalDocumentDefinitionsVersion,
        ),
        personalDocumentDefinitionsVersion: PERSONAL_DOCUMENT_DEFINITIONS_VERSION,
        trash: stored?.trash ?? [],
  };
}

async function loadData(): Promise<AppData> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => {
      resolve(normalizeAppData(request.result as Partial<AppData> | undefined));
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function loadCheckpoints(): Promise<RecoveryCheckpoint<AppData>[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(RECOVERY_KEY);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function saveCheckpoints(checkpoints: RecoveryCheckpoint<AppData>[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(checkpoints, RECOVERY_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
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
function segmentCountedWorkMinutes(segment: Segment): number {
  return Math.max(0, segmentDutyMinutes(segment) - Math.max(0, segment.excludedWorkMinutes ?? 0));
}
function flightWorkMinutes(segments: Segment[]): number {
  const ranges = segmentMinuteRanges(segments).map(({ start, end }) => ({ start, end })).sort((left, right) => left.start - right.start);
  if (!ranges.length) return 0;
  let total = 0; let currentStart = ranges[0].start; let currentEnd = ranges[0].end;
  ranges.slice(1).forEach((range) => {
    if (range.start <= currentEnd) currentEnd = Math.max(currentEnd, range.end);
    else { total += currentEnd - currentStart; currentStart = range.start; currentEnd = range.end; }
  });
  const dutyMinutes = total + currentEnd - currentStart;
  const excludedMinutes = segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.excludedWorkMinutes ?? 0),
    0,
  );
  return Math.max(0, dutyMinutes - excludedMinutes);
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

function restBoundaries(shift: Shift, shifts: Shift[]): { from: number; to: number } | null {
  const days = getWorkDays(shifts).get(shift.personId) ?? [];
  if (shift.activity === "dayoff") {
    const previous = days.filter((day) => day.date < shift.date).at(-1);
    const next = days.find((day) => day.date > shift.date);
    return previous && next ? { from: previous.end, to: next.start } : null;
  }
  const currentIndex = days.findIndex((day) => day.items.some((item) => item.id === shift.id));
  if (currentIndex <= 0) return null;
  return { from: days[currentIndex - 1].end, to: days[currentIndex].start };
}

function formatRestBoundary(value: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value)).replace(",", "");
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
  const [newShiftDefaults, setNewShiftDefaults] = useState<{ personId: string; date: string } | null>(null);
  const [aviabitModal, setAviabitModal] = useState(false);
  const [planEditRequest, setPlanEditRequest] = useState<PlanEditRequest | null>(null);
  const [personalTargetId, setPersonalTargetId] = useState("");
  const [toast, setToast] = useState("");
  const [checkpoints, setCheckpoints] = useState<RecoveryCheckpoint<AppData>[]>([]);
  const importRef = useRef<HTMLInputElement>(null);
  const previousDataRef = useRef<AppData | null>(null);

  useEffect(() => {
    Promise.all([loadData(), loadCheckpoints()]).then(([loadedData, loadedCheckpoints]) => {
      previousDataRef.current = structuredClone(loadedData);
      setData(loadedData);
      setCheckpoints(loadedCheckpoints);
    }).finally(() => setHydrated(true));
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
    if (!hydrated || !previousDataRef.current) return;
    const previous = previousDataRef.current;
    const sections = changedDataSections(previous as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>);
    if (!sections.length) return;
    previousDataRef.current = structuredClone(data);
    const checkpoint: RecoveryCheckpoint<AppData> = {
      id: uid(),
      createdAt: new Date().toISOString(),
      sections,
      snapshot: structuredClone(previous),
    };
    setCheckpoints((current) => {
      const next = [checkpoint, ...current].slice(0, MAX_CHECKPOINTS);
      void saveCheckpoints(next);
      return next;
    });
  }, [data, hydrated]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const expandedShifts = useMemo(() => expandLinkedCrewShifts(data.shifts), [data.shifts]);
  const restMap = useMemo(() => getRestMap(expandedShifts), [expandedShifts]);
  const assumedCompliantRestIds = useMemo(() => getAssumedCompliantRestIds(expandedShifts), [expandedShifts]);
  const restIssues = useMemo(() => getRestIssues(expandedShifts), [expandedShifts]);
  const todayIso = localIsoDate(new Date());
  const monthKey = todayIso.slice(0, 7);
  const monthShifts = useMemo(() => data.shifts.filter((shift) => shift.date.startsWith(monthKey)), [data.shifts, monthKey]);
  const controlCertifications = useMemo(() => latestCertificationRecords(data.certifications).filter((record) =>
    !isMedicalCertificationSuperseded(record, data.personalProfiles[record.personId]?.medical.expiryDate ?? "")),
  [data.certifications, data.personalProfiles]);
  const controlRows = useMemo(
    () => buildControlRows(data.people, expandedShifts, controlCertifications, todayIso),
    [data.people, expandedShifts, controlCertifications, todayIso],
  );
  const readinessByPerson = useMemo(() => Object.fromEntries(data.people.map((person) => [
    person.id,
    employeeReadiness(
      data.certifications.filter((record) => record.personId === person.id),
      normalizePilotPersonalProfile(data.personalProfiles[person.id]),
    ),
  ])), [data.certifications, data.people, data.personalProfiles]);
  const alerts = useMemo(() => {
    const result: DashboardAlert[] = [];
    restIssues.filter((issue) => isCurrentMonthDate(issue.date, todayIso) && isRestIssueVisible(issue)).forEach((issue) => {
      const person = data.people.find((item) => item.id === issue.personId);
      result.push({
        id: issue.id,
        severity: "danger",
        title: restIssueTitle(issue, person?.name ?? "Сотрудник"),
        detail: restIssueDetail(issue),
        sortDate: issue.date,
      });
    });
    controlRows.filter(isControlAttention).forEach((row) => {
      const title = row.kind === "type"
        ? `${row.personName}: срок полёта на ${row.aircraftType}`
        : row.kind === "night"
          ? `${row.personName}: ночной допуск ${row.aircraftType}`
          : `${row.personName}: ${row.subject}`;
      const detail = row.dueDate
        ? `${formatDate(row.dueDate)} · ${row.statusLabel.toLocaleLowerCase("ru-RU")}`
        : `${row.aircraftType ? `${row.aircraftType} · ` : ""}${row.statusLabel}`;
      result.push({
        id: row.id,
        severity: row.status === "expired" || row.status === "alert14" || row.status === "incomplete" ? "danger" : "warning",
        title,
        detail,
        sortDate: row.dueDate,
      });
    });
    return result.sort((left, right) =>
      compareAttentionDates(left.sortDate, right.sortDate, todayIso)
      || left.title.localeCompare(right.title, "ru-RU"));
  }, [controlRows, data.people, restIssues, todayIso]);
  const sortedShifts = useMemo(() => [...data.shifts].sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`)), [data.shifts]);
  const monthSortedShifts = useMemo(() => [...monthShifts].sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`)), [monthShifts]);
  const totalWork = monthShifts.reduce((sum, shift) => sum + shift.workMinutes, 0);
  const totalFlight = monthShifts.reduce((sum, shift) => sum + shift.segments.reduce((inner, segment) => inner + segment.flightMinutes, 0), 0);

  function openNewShift(defaults?: { personId: string; date: string }) {
    setNewShiftDefaults(defaults ?? null);
    setShiftModal("new");
  }
  function openShiftForEdit(shift: Shift) {
    setNewShiftDefaults(null);
    setShiftModal(shift);
  }
  function closeShiftModal() {
    setShiftModal(null);
    setNewShiftDefaults(null);
  }
  function trashEntry(kind: TrashKind, label: string, payload: unknown): TrashEntry {
    return { id: uid(), kind, label, deletedAt: new Date().toISOString(), payload: structuredClone(payload) };
  }
  function restoreTrashItem(entry: TrashEntry) {
    setData((current) => {
      const next = { ...current, trash: current.trash.filter((item) => item.id !== entry.id) };
      if (entry.kind === "person") {
        const bundle = entry.payload as { person: Person; shifts: Shift[]; certifications: CertificationRecord[]; planAssignments: PlanAssignment[]; planBusyEntries: PlanBusyEntry[]; baselines: FlightBookBaseline[]; documentProfile?: DocumentPersonProfile; personalProfile?: PilotPersonalProfile };
        return {
          ...next,
          people: next.people.some((item) => item.id === bundle.person.id) ? next.people : [...next.people, bundle.person],
          shifts: [...next.shifts.filter((item) => !bundle.shifts.some((saved) => saved.id === item.id)), ...bundle.shifts],
          certifications: [...next.certifications.filter((item) => !bundle.certifications.some((saved) => saved.id === item.id)), ...bundle.certifications],
          planAssignments: [...next.planAssignments.filter((item) => !bundle.planAssignments.some((saved) => saved.id === item.id)), ...bundle.planAssignments],
          planBusyEntries: [...next.planBusyEntries.filter((item) => !bundle.planBusyEntries.some((saved) => saved.id === item.id)), ...bundle.planBusyEntries],
          flightBookBaselines: [...next.flightBookBaselines.filter((item) => !bundle.baselines.some((saved) => saved.id === item.id)), ...bundle.baselines],
          documentProfiles: bundle.documentProfile ? { ...next.documentProfiles, [bundle.person.id]: bundle.documentProfile } : next.documentProfiles,
          personalProfiles: bundle.personalProfile ? { ...next.personalProfiles, [bundle.person.id]: bundle.personalProfile } : next.personalProfiles,
        };
      }
      if (entry.kind === "shift") {
        const items = entry.payload as Shift[];
        return { ...next, shifts: [...next.shifts.filter((item) => !items.some((saved) => saved.id === item.id)), ...items] };
      }
      if (entry.kind === "shiftSnapshot") {
        const item = entry.payload as Shift;
        return { ...next, shifts: [...next.shifts.filter((currentShift) => currentShift.id !== item.id), item] };
      }
      if (entry.kind === "certification") return { ...next, certifications: [...next.certifications.filter((item) => item.id !== (entry.payload as CertificationRecord).id), entry.payload as CertificationRecord] };
      if (entry.kind === "baseline") return { ...next, flightBookBaselines: [...next.flightBookBaselines.filter((item) => item.id !== (entry.payload as FlightBookBaseline).id), entry.payload as FlightBookBaseline] };
      if (entry.kind === "registry") return { ...next, documentRegistry: [...next.documentRegistry.filter((item) => item.id !== (entry.payload as DocumentRegistryRecord).id), entry.payload as DocumentRegistryRecord] };
      if (entry.kind === "medicalReferral") return { ...next, medicalReferrals: [...next.medicalReferrals.filter((item) => item.id !== (entry.payload as MedicalReferralRecord).id), entry.payload as MedicalReferralRecord] };
      if (entry.kind === "planAssignment") return { ...next, planAssignments: [...next.planAssignments.filter((item) => item.id !== (entry.payload as PlanAssignment).id), entry.payload as PlanAssignment] };
      if (entry.kind === "planBusy") return { ...next, planBusyEntries: [...next.planBusyEntries.filter((item) => item.id !== (entry.payload as PlanBusyEntry).id), entry.payload as PlanBusyEntry] };
      return next;
    });
    setToast("Запись восстановлена из корзины");
  }
  function permanentlyDeleteTrashItem(entryId: string) {
    if (!window.confirm("Удалить запись из корзины без возможности восстановления?")) return;
    setData((current) => ({ ...current, trash: current.trash.filter((item) => item.id !== entryId) }));
    setToast("Запись окончательно удалена");
  }
  function restoreCheckpoint(checkpoint: RecoveryCheckpoint<AppData>) {
    if (!window.confirm(`Восстановить состояние до изменения «${checkpoint.sections.join(", ")}»?`)) return;
    previousDataRef.current = structuredClone(checkpoint.snapshot);
    setData(normalizeAppData(checkpoint.snapshot));
    setToast("Контрольная точка восстановлена");
  }
  function undoLastChange() {
    const checkpoint = checkpoints[0];
    if (!checkpoint) { setToast("Нет изменений для отмены"); return; }
    previousDataRef.current = structuredClone(checkpoint.snapshot);
    setData(normalizeAppData(checkpoint.snapshot));
    setCheckpoints((current) => {
      const next = current.slice(1);
      void saveCheckpoints(next);
      return next;
    });
    setToast("Последнее изменение отменено");
  }

  function savePerson(person: Omit<Person, "id" | "active">) {
    if (personModal && personModal !== "new") setData((current) => ({ ...current, people: current.people.map((item) => item.id === personModal.id ? { ...item, ...person } : item) }));
    else setData((current) => ({ ...current, people: [...current.people, { ...person, id: uid(), active: true }] }));
    setPersonModal(null); setToast(personModal === "new" ? "Сотрудник добавлен" : "Данные сотрудника обновлены");
  }
  function deletePerson(person: Person) {
    const related = expandedShifts.filter((shift) => shift.personId === person.id).length
      + data.certifications.filter((record) => record.personId === person.id).length
      + data.planAssignments.filter((assignment) => assignment.personId === person.id).length
      + data.planBusyEntries.filter((entry) => entry.personId === person.id).length;
    if (!window.confirm(related ? `Удалить ${person.name} вместе со связанными записями (${related})?` : `Удалить ${person.name} из состава?`)) return;
    setData((current) => ({
      ...current,
      trash: [trashEntry("person", person.name, {
        person,
        shifts: current.shifts.filter((shift) => shift.personId === person.id || shift.segments.some((segment) => segment.commanderPersonId === person.id)),
        certifications: current.certifications.filter((record) => record.personId === person.id),
        planAssignments: current.planAssignments.filter((assignment) => assignment.personId === person.id),
        planBusyEntries: current.planBusyEntries.filter((entry) => entry.personId === person.id),
        baselines: current.flightBookBaselines.filter((baseline) => baseline.personId === person.id),
        documentProfile: current.documentProfiles[person.id],
        personalProfile: current.personalProfiles[person.id],
      }), ...current.trash],
      people: current.people.filter((item) => item.id !== person.id),
      shifts: current.shifts
        .filter((shift) => shift.personId !== person.id)
        .map((shift) => ({
          ...shift,
          segments: shift.segments.map((segment) =>
            segment.commanderPersonId === person.id ? { ...segment, commanderPersonId: undefined } : segment),
        })),
      certifications: current.certifications.filter((record) => record.personId !== person.id),
      planAssignments: current.planAssignments.filter((assignment) => assignment.personId !== person.id),
      planBusyEntries: current.planBusyEntries.filter((entry) => entry.personId !== person.id),
      documentProfiles: Object.fromEntries(Object.entries(current.documentProfiles).filter(([personId]) => personId !== person.id)),
      flightBookBaselines: current.flightBookBaselines.filter((baseline) => baseline.personId !== person.id),
      personalProfiles: Object.fromEntries(Object.entries(current.personalProfiles).filter(([personId]) => personId !== person.id)),
    }));
    setPersonModal(null); setToast("Сотрудник удалён");
  }
  function saveShift(shift: ShiftDraft) {
    const editing = shiftModal && shiftModal !== "new" ? shiftModal : null;
    const { dateTo, ...base } = shift;
    const hasPeriod = multiDayActivities.includes(shift.activity) && Boolean(dateTo && dateTo > shift.date);
    const dates = hasPeriod ? enumerateDates(shift.date, dateTo!) : [shift.date];
    // Месячный план — ориентир, а не ограничение для фактических данных.
    // Факт всегда сохраняется в журнал и автоматически появляется в фактическом плане.
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
    closeShiftModal(); setToast(hasPeriod ? `Период сохранён: ${dates.length} дн.` : "Запись сохранена");
  }
  function deleteShift(shift: Shift) {
    const periodText = shift.periodId && shift.periodStart && shift.periodEnd ? ` весь период ${formatDate(shift.periodStart)} — ${formatDate(shift.periodEnd)}` : ` запись ${formatDate(shift.date)}`;
    if (!window.confirm(`Удалить${periodText}?`)) return;
    setData((current) => {
      const removed = current.shifts.filter((item) => shift.periodId ? item.periodId === shift.periodId : item.id === shift.id);
      return { ...current, shifts: current.shifts.filter((item) => shift.periodId ? item.periodId !== shift.periodId : item.id !== shift.id), trash: [trashEntry("shift", shift.periodId ? `Период с ${formatDate(shift.periodStart ?? shift.date)}` : `Смена ${formatDate(shift.date)}`, removed), ...current.trash] };
    }); closeShiftModal(); setToast(shift.periodId ? "Период перемещён в корзину" : "Запись перемещена в корзину");
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
      trash: [trashEntry("shiftSnapshot", `Полёт ${formatDate(shift.date)}`, current.shifts.find((item) => item.id === shift.id) ?? shift), ...current.trash],
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
        qualifications: aircraftTypes.length ? [{ id: uid(), operators: [], aircraftTypes, seats: ["Командир ВС"], nightAircraftTypes: [] }] : [],
        active: true,
      }];
      const kept = current.certifications.filter((record) => !(record.personId === personId && record.source === "aviabit"));
      return { ...current, people, certifications: [...kept, ...payload.records.map((record) => ({ ...record, personId }))] };
    });
    setAviabitModal(false); setView("personal"); setToast(`Импортировано записей: ${payload.records.length}`);
  }
  function importWorkTime(records: ImportedWorkTimeShift[]) {
    const preview = mergeImportedWorkTime(data.shifts, records);
    setData((current) => {
      const merged = mergeImportedWorkTime(current.shifts, records);
      return { ...current, shifts: merged.shifts.map((shift) => normalizeShift(shift as Shift)) };
    });
    setToast(`Импорт завершён: добавлено ${preview.addedRows}, пропущено дублей ${preview.duplicateRows}`);
  }
  function upsertCertification(record: CertificationRecord) {
    setData((current) => ({ ...current, certifications: current.certifications.some((item) => item.id === record.id) ? current.certifications.map((item) => item.id === record.id ? record : item) : [...current.certifications, record] })); setToast("Запись личного дела сохранена");
  }
  function deleteCertification(recordId: string) { setData((current) => { const record = current.certifications.find((item) => item.id === recordId); return { ...current, certifications: current.certifications.filter((item) => item.id !== recordId), trash: record ? [trashEntry("certification", record.certificationType || record.category || "Документ", record), ...current.trash] : current.trash }; }); setToast("Запись перемещена в корзину"); }
  function upsertFlightBookBaseline(baseline: FlightBookBaseline) {
    setData((current) => ({
      ...current,
      flightBookBaselines: current.flightBookBaselines.some((item) => item.id === baseline.id)
        ? current.flightBookBaselines.map((item) => item.id === baseline.id ? baseline : item)
        : [...current.flightBookBaselines, baseline],
    }));
    setToast("Исходный налёт сохранён");
  }
  function deleteFlightBookBaseline(baselineId: string) {
    setData((current) => { const baseline = current.flightBookBaselines.find((item) => item.id === baselineId); return {
      ...current,
      flightBookBaselines: current.flightBookBaselines.filter((item) => item.id !== baselineId),
      trash: baseline ? [trashEntry("baseline", `Исходный налёт ${baseline.date}`, baseline), ...current.trash] : current.trash,
    }; });
    setToast("Контрольная точка перемещена в корзину");
  }
  function savePilotPersonalProfile(personId: string, profile: PilotPersonalProfile) {
    const passportParts = profile.personalInfo.passportSeriesNumber.trim().split(/\s+/);
    const educationParts = profile.personalInfo.educationSeriesNumber.trim().split(/\s+/);
    setData((current) => ({
      ...current,
      personalProfiles: { ...current.personalProfiles, [personId]: profile },
      documentProfiles: {
        ...current.documentProfiles,
        [personId]: {
          ...EMPTY_DOCUMENT_PROFILE,
          ...(current.documentProfiles[personId] ?? {}),
          birthDate: profile.birthDate,
          snils: profile.personalInfo.snils,
          passportSeries: passportParts[0] ?? "",
          passportNumber: passportParts.slice(1).join(" "),
          educationDocumentSeries: educationParts[0] ?? "",
          educationDocumentNumber: educationParts.slice(1).join(" "),
          educationQualification: profile.personalInfo.specialty,
          educationLevel: profile.personalInfo.educationLevel,
          email: profile.email,
          phone: profile.phone,
        },
      },
    }));
    setToast("Личное дело обновлено");
  }
  function upsertRegistryRecord(record: DocumentRegistryRecord) {
    setData((current) => ({
      ...current,
      documentRegistry: current.documentRegistry.some((item) => item.id === record.id)
        ? current.documentRegistry.map((item) => item.id === record.id ? record : item)
        : [...current.documentRegistry, record],
    }));
    setToast("Запись реестра сохранена");
  }
  function deleteRegistryRecord(recordId: string) {
    setData((current) => { const record = current.documentRegistry.find((item) => item.id === recordId); return { ...current, documentRegistry: current.documentRegistry.filter((item) => item.id !== recordId), trash: record ? [trashEntry("registry", `Реестр ${record.number}`, record), ...current.trash] : current.trash }; });
    setToast("Запись реестра перемещена в корзину");
  }
  function upsertMedicalReferral(record: MedicalReferralRecord) {
    setData((current) => ({ ...current, medicalReferrals: current.medicalReferrals.some((item) => item.id === record.id) ? current.medicalReferrals.map((item) => item.id === record.id ? record : item) : [...current.medicalReferrals, record] }));
    setToast("Медицинское направление сохранено");
  }
  function deleteMedicalReferral(recordId: string) {
    setData((current) => { const record = current.medicalReferrals.find((item) => item.id === recordId); return { ...current, medicalReferrals: current.medicalReferrals.filter((item) => item.id !== recordId), trash: record ? [trashEntry("medicalReferral", `Направление № ${record.number}`, record), ...current.trash] : current.trash }; });
    setToast("Медицинское направление перемещено в корзину");
  }
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
    setData((current) => { const record = current.planAssignments.find((item) => item.id === assignmentId); return { ...current, planAssignments: current.planAssignments.filter((item) => item.id !== assignmentId), trash: record ? [trashEntry("planAssignment", `Назначение ${record.aircraft} · ${formatDate(record.date)}`, record), ...current.trash] : current.trash }; });
    setToast("Назначение перемещено в корзину");
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
    setData((current) => { const record = current.planBusyEntries.find((item) => item.id === entryId); return { ...current, planBusyEntries: current.planBusyEntries.filter((item) => item.id !== entryId), trash: record ? [trashEntry("planBusy", `${planBusyLabels[record.activity]} · ${formatDate(record.dateFrom)}`, record), ...current.trash] : current.trash }; });
    setToast("Занятость перемещена в корзину");
  }
  function exportBackup() {
    const now = new Date();
    download(backupFileName(now), JSON.stringify({ version: 16, exportedAt: now.toISOString(), checksum: backupChecksum(data), data }, null, 2));
    setToast("Проверенная резервная копия сохранена");
  }
  function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    file.text().then((text) => {
      const parsed = JSON.parse(text) as unknown;
      const validation = validateBackupEnvelope(parsed);
      if (!validation.valid) throw new Error(validation.error);
      const restored = normalizeAppData(validation.data as Partial<AppData>);
      previousDataRef.current = structuredClone(restored);
      setData(restored);
      setToast("Резервная копия проверена и восстановлена");
    }).catch((caught) => setToast(caught instanceof Error ? caught.message : "Не удалось прочитать резервную копию"));
    event.target.value = "";
  }

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><div className="brand-mark">
        {/* The public asset must stay relative so it also works under the GitHub Pages repository path. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="sidebar-icon.png" alt="" />
      </div><div><strong>ШТАБ ЛС</strong><span>Рабочий контур</span></div></div>
      <nav className="quick-nav" aria-label="Быстрый доступ">
        <NavButton active={view === "dashboard"} onClick={() => setView("dashboard")} label="Главная" glyph="⌂" />
        <NavButton active={view === "documentation"} onClick={() => setView("documentation")} label="Документация" glyph="▤" />
        <NavButton active={view === "settings"} onClick={() => setView("settings")} label="Настройки" glyph="⚙" />
      </nav>
      <div className="header-status"><span className="status-dot" /><div><strong>Локальная база</strong><span className={`save-state ${saveState}`}>{saveState === "saved" ? "Сохранено" : saveState === "saving" ? "Сохраняю…" : "Ошибка сохранения"}</span></div></div>
      <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={importBackup} />
    </header>
    <main className="workspace" style={{ backgroundImage: 'linear-gradient(180deg, rgba(242, 245, 246, .62), rgba(242, 245, 246, .82)), url("solaris-berassom-bg.jpeg")' }}>
      <header className="topbar"><div className="topbar-title"><p className="eyebrow current-date">{new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</p><h1>{viewTitle(view)}</h1></div>
        <WorldClocks />
        <div className="top-actions">{!["dashboard", "documentation", "settings"].includes(view) && <button className="secondary-button" onClick={() => setView("dashboard")}>← На главную</button>}</div>
      </header>
      {!hydrated ? <Loading /> : view === "dashboard"
        ? <Dashboard
          people={data.people}
          shifts={monthSortedShifts}
          alerts={alerts}
          totalWork={totalWork}
          totalFlight={totalFlight}
          restMap={restMap}
          assumedCompliantRestIds={assumedCompliantRestIds}
          onAddShift={() => openNewShift()}
          onRestore={() => importRef.current?.click()}
          onNavigate={setView}
        />
        : view === "documentation"
          ? <DocumentationView
            people={data.people.map((person) => ({ ...person, division: data.personalProfiles[person.id]?.division ?? "" }))}
            certifications={data.certifications}
            shifts={data.shifts}
            baselines={data.flightBookBaselines}
            registry={data.documentRegistry}
            medicalReferrals={data.medicalReferrals}
            profiles={data.documentProfiles}
            settings={data.documentSettings}
            company={data.settings}
            onUpsertRegistry={upsertRegistryRecord}
            onDeleteRegistry={deleteRegistryRecord}
            onUpsertMedicalReferral={upsertMedicalReferral}
            onDeleteMedicalReferral={deleteMedicalReferral}
            onSettingsChange={(patch) => setData((current) => ({ ...current, documentSettings: { ...current.documentSettings, ...patch } }))}
            onNotify={setToast}
          />
          : view === "settings"
            ? <SettingsView
              settings={data.settings}
              checkpoints={checkpoints}
              trash={data.trash}
              onChange={(patch) => setData((current) => ({ ...current, settings: { ...current.settings, ...patch } }))}
              onExport={exportBackup}
              onRestore={() => importRef.current?.click()}
              onUndo={undoLastChange}
              onRestoreCheckpoint={restoreCheckpoint}
              onRestoreTrash={restoreTrashItem}
              onDeleteTrash={permanentlyDeleteTrashItem}
            />
        : view === "shifts"
          ? <ShiftsView
            people={data.people}
            shifts={sortedShifts}
            assignments={data.planAssignments}
            busyEntries={data.planBusyEntries}
            restMap={restMap}
            assumedCompliantRestIds={assumedCompliantRestIds}
            onAdd={() => openNewShift()}
            onEdit={openShiftForEdit}
            onDelete={deleteShift}
            onDeleteFlight={deleteFlight}
            onEditPlan={(request) => { setPlanEditRequest(request); setView("planning"); }}
            onDeletePlanAssignment={deletePlanAssignment}
            onDeletePlanBusy={deletePlanBusy}
            onImport={importWorkTime}
            onNotify={setToast}
          />
          : view === "crew"
            ? <CrewDeploymentView people={data.people} assignments={data.planAssignments} shifts={expandedShifts} readiness={readinessByPerson} onOpenPlan={(assignment) => { setPlanEditRequest(assignment ? { kind: "assignment", id: assignment.id } : null); setView("planning"); }} />
          : view === "people"
            ? <PeopleView people={data.people} shifts={expandedShifts} readinessByPerson={readinessByPerson} onAdd={() => setPersonModal("new")} onEdit={setPersonModal} onOpenPersonal={(personId) => { setPersonalTargetId(personId); setView("personal"); }} />
            : view === "personal"
              ? <PersonalFilesView
                people={data.people}
                shifts={expandedShifts}
                records={data.certifications}
                baselines={data.flightBookBaselines}
                profiles={data.personalProfiles}
                documentDefinitions={data.personalDocumentDefinitions}
                onImportClick={() => setAviabitModal(true)}
                onUpsert={upsertCertification}
                onDelete={deleteCertification}
                onUpsertBaseline={upsertFlightBookBaseline}
                onDeleteBaseline={deleteFlightBookBaseline}
                onProfileChange={savePilotPersonalProfile}
                onDefinitionsChange={(definitions) => setData((current) => ({ ...current, personalDocumentDefinitions: definitions }))}
                onNotify={setToast}
                initialPersonId={personalTargetId}
              />
              : view === "control"
                ? <ControlJournalView rows={controlRows} alerts={alerts} onNotify={setToast} />
                : view === "actual"
                  ? <ActualPlanView
                    people={data.people}
                    shifts={expandedShifts}
                    onNotify={setToast}
                    onAdd={(personId, date) => openNewShift({ personId, date })}
                    onEdit={(selected) => {
                      const source = data.shifts.find((item) => item.id === selected.linkedSourceShiftId);
                      openShiftForEdit(source ?? selected as Shift);
                    }}
                  />
                  : <MonthlyPlanView
                people={data.people.map((person) => ({ ...person, readinessStatus: readinessByPerson[person.id]?.status, readinessReason: readinessBlockReason(readinessByPerson[person.id]) ?? readinessByPerson[person.id]?.reasons[0]?.detail ?? "" }))}
                shifts={expandedShifts}
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
    {shiftModal && <ShiftModal
      people={data.people}
      readinessByPerson={readinessByPerson}
      shift={shiftModal === "new" ? null : shiftModal}
      initialPersonId={shiftModal === "new" ? newShiftDefaults?.personId : undefined}
      initialDate={shiftModal === "new" ? newShiftDefaults?.date : undefined}
      onClose={closeShiftModal}
      onSubmit={saveShift}
      onDelete={shiftModal === "new" ? undefined : () => deleteShift(shiftModal)}
    />}
    {aviabitModal && <ImportAviabitModal people={data.people} onClose={() => setAviabitModal(false)} onSubmit={importAviabit} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function NavButton({ active, onClick, label, glyph }: { active: boolean; onClick: () => void; label: string; glyph: string }) { return <button className={active ? "active" : ""} onClick={onClick}><span>{glyph}</span>{label}</button>; }
function viewTitle(view: View): string {
  return {
    dashboard: "Оперативная информация",
    shifts: "Полётные смены",
    people: "Сотрудники",
    personal: "Личные дела",
    control: "Контрольный журнал",
    crew: "Расстановка экипажей",
    planning: "Месячный план",
    actual: "Фактический план",
    documentation: "Документация",
    settings: "Настройки",
  }[view];
}
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

function Dashboard({
  people,
  shifts,
  alerts,
  totalWork,
  totalFlight,
  restMap,
  assumedCompliantRestIds,
  onAddShift,
  onRestore,
  onNavigate,
}: {
  people: Person[];
  shifts: Shift[];
  alerts: DashboardAlert[];
  totalWork: number;
  totalFlight: number;
  restMap: Map<string, number>;
  assumedCompliantRestIds: Set<string>;
  onAddShift: () => void;
  onRestore: () => void;
  onNavigate: (view: View) => void;
}) {
  if (!people.length) return <section className="empty-start"><div className="empty-visual"><span>01</span><i /></div><p className="eyebrow">Новая или пустая база</p><h2>Восстановите рабочую базу из резервной копии</h2><p>Выберите ранее сохранённый файл BaseShtab. Сотрудники, смены, планы, личные дела и настройки предприятия будут восстановлены на этом устройстве.</p><button className="primary-button" onClick={onRestore}>Восстановить базу из файла</button></section>;
  return <><section className="metric-grid"><Metric label="Активный состав" value={String(people.filter((person) => person.active).length)} detail="сотрудников в базе" tone="blue" /><Metric label="Рабочее время" value={formatDuration(totalWork)} detail="в текущем месяце" tone="navy" /><Metric label="Полётное время" value={formatDuration(totalFlight)} detail="в текущем месяце" tone="teal" /><Metric label="Полётные смены" value={String(shifts.filter((shift) => shift.activity === "flight").reduce((sum, shift) => sum + flightEntryCount(shift.segments), 0))} detail="в текущем месяце" tone="violet" /><Metric label="Требует внимания" value={String(alerts.length)} detail={alerts.length ? "открытых предупреждений" : "нарушений не выявлено"} tone={alerts.length ? "red" : "green"} /></section>
    <section className="dashboard-main-grid">
      <div className="dashboard-area dashboard-work">
      <DashboardBlock eyebrow="Рабочий контур" title="Личный состав">
        <DashboardShortcut glyph="◷" title="Полётные смены" detail="Единый журнал, импорт и отчёты" onClick={() => onNavigate("shifts")} />
        <DashboardShortcut glyph="◎" title="Сотрудники" detail="Состав, допуски, кресла и типы ВС" onClick={() => onNavigate("people")} />
        <DashboardShortcut glyph="▤" title="Личные дела" detail="Документы и контроль сроков" onClick={() => onNavigate("personal")} />
      </DashboardBlock>
      </div>
      <article className="panel alerts-panel dashboard-area dashboard-control"><div className="panel-heading"><div><p className="eyebrow">Контроль</p><h2>Требует внимания</h2></div><span className="count-badge">{alerts.length}</span></div><div className="control-rules"><strong>Нормы отдыха · приказ № 381</strong><span>12 ч ежедневно · 42 ч после 6 рабочих дней · 48 ч после двух разделённых смен</span></div>{!alerts.length ? <div className="good-state"><span>✓</span><div><strong>Критических замечаний нет</strong><p>Новые предупреждения появятся после расчёта смен.</p></div></div> : dashboardRows(alerts).map((alert) => <div className={`alert-row ${alert.severity}`} key={alert.id}><span className="alert-icon">!</span><div><strong>{alert.title}</strong><p>{alert.detail}</p></div></div>)}</article>
      <div className="dashboard-area dashboard-crews">
      <DashboardBlock eyebrow="Расстановка экипажей" title="Планирование">
        <DashboardShortcut glyph="✈" title="Расстановка экипажей" detail="Суточный состав, готовность и фактические полёты" onClick={() => onNavigate("crew")} />
        <DashboardShortcut glyph="▦" title="Месячный план" detail="Борта, экипажи и занятость" onClick={() => onNavigate("planning")} />
        <DashboardShortcut glyph="▦" title="Фактический план" detail="Фактическая занятость по дням" onClick={() => onNavigate("actual")} />
      </DashboardBlock>
      </div>
      <article className="panel recent-panel dashboard-area dashboard-recent"><div className="panel-heading"><div><p className="eyebrow">Последние записи</p><h2>Недавние смены</h2></div><button className="link-button" onClick={onAddShift}>Добавить</button></div>{!shifts.length ? <div className="panel-empty">Смен пока нет</div> : dashboardRows(shifts).map((shift) => { const person = people.find((item) => item.id === shift.personId); const rest = restMap.get(shift.id); const assumedCompliant = assumedCompliantRestIds.has(shift.id); return <div className="shift-row" key={shift.id}><div className="date-tile"><strong>{shift.date.slice(8, 10)}</strong><span>{new Intl.DateTimeFormat("ru-RU", { month: "short" }).format(new Date(`${shift.date}T12:00:00`)).replace(".", "")}</span></div><div className="shift-main"><strong>{person?.name ?? "Сотрудник"}</strong><span>{activityLabels[shift.activity]} · {shift.start || "без времени"}</span></div><div className="shift-meta"><strong>{shift.workMinutes ? formatDuration(shift.workMinutes) : "—"}</strong><span>{shift.activity === "dayoff" ? "отдых 24 ч" : assumedCompliant ? "отдых по норме" : rest === undefined ? "первая смена" : `отдых ${formatDuration(rest)}`}</span></div></div>; })}</article>
      <div className="dashboard-area dashboard-expiry">
      <DashboardBlock eyebrow="Сроки и допуски" title="Контроль">
        <DashboardShortcut glyph="✓" title="Контрольный журнал" detail="Все предупреждения с главной страницы" onClick={() => onNavigate("control")} />
      </DashboardBlock>
      </div>
    </section></>;
}
function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <article className={`metric ${tone}`}><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>; }

function DashboardBlock({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <section className="panel dashboard-block"><div className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div><div className="dashboard-shortcuts">{children}</div></section>;
}

function DashboardShortcut({ glyph, title, detail, onClick }: { glyph: string; title: string; detail: string; onClick: () => void }) {
  return <button type="button" className="dashboard-shortcut" onClick={onClick}><span>{glyph}</span><div><strong>{title}</strong><small>{detail}</small></div><i>→</i></button>;
}

function SettingsView({
  settings,
  checkpoints,
  trash,
  onChange,
  onExport,
  onRestore,
  onUndo,
  onRestoreCheckpoint,
  onRestoreTrash,
  onDeleteTrash,
}: {
  settings: CompanySettings;
  checkpoints: RecoveryCheckpoint<AppData>[];
  trash: TrashEntry[];
  onChange: (patch: Partial<CompanySettings>) => void;
  onExport: () => void;
  onRestore: () => void;
  onUndo: () => void;
  onRestoreCheckpoint: (checkpoint: RecoveryCheckpoint<AppData>) => void;
  onRestoreTrash: (entry: TrashEntry) => void;
  onDeleteTrash: (entryId: string) => void;
}) {
  return <section className="settings-layout">
    <article className="panel settings-card"><div className="panel-heading"><div><p className="eyebrow">Реквизиты</p><h2>Карточка предприятия</h2></div><span className="settings-auto-save">Сохраняется автоматически</span></div><div className="settings-form form-stack">
      <Field label="Полное наименование"><input value={settings.fullName} onChange={(event) => onChange({ fullName: event.target.value })} placeholder="Общество с ограниченной ответственностью…" /></Field>
      <Field label="Сокращённое наименование"><input value={settings.shortName} onChange={(event) => onChange({ shortName: event.target.value })} placeholder="ООО «…»" /></Field>
      <div className="form-grid three">
        <Field label="ИНН"><input value={settings.inn} onChange={(event) => onChange({ inn: event.target.value.replace(/\D/g, "").slice(0, 12) })} /></Field>
        <Field label="КПП"><input value={settings.kpp} onChange={(event) => onChange({ kpp: event.target.value.replace(/\D/g, "").slice(0, 9) })} /></Field>
        <Field label="ОГРН"><input value={settings.ogrn} onChange={(event) => onChange({ ogrn: event.target.value.replace(/\D/g, "").slice(0, 15) })} /></Field>
      </div>
      <Field label="Юридический адрес"><textarea value={settings.legalAddress} onChange={(event) => onChange({ legalAddress: event.target.value })} /></Field>
      <Field label="Фактический адрес"><textarea value={settings.actualAddress} onChange={(event) => onChange({ actualAddress: event.target.value })} /></Field>
    </div></article>
    <article className="panel settings-card"><div className="panel-heading"><div><p className="eyebrow">Ответственные лица</p><h2>Подписанты и руководство</h2></div></div><div className="settings-form form-stack">
      <Field label="Начальник штаба"><input value={settings.chiefOfStaff} onChange={(event) => onChange({ chiefOfStaff: event.target.value })} placeholder="Фамилия Имя Отчество" /></Field>
      <Field label="ЗГД по ОЛР"><input value={settings.deputyFlightOperations} onChange={(event) => onChange({ deputyFlightOperations: event.target.value })} placeholder="Фамилия Имя Отчество" /></Field>
      <Field label="Генеральный директор"><input value={settings.generalDirector} onChange={(event) => onChange({ generalDirector: event.target.value })} placeholder="Фамилия Имя Отчество" /></Field>
      <div className="report-scope-note">Эти данные подготовлены для будущего автоматического заполнения Word-форм, приказов, заявок и приложений.</div>
    </div></article>
    <article className="panel backup-card"><div><p className="eyebrow">Локальная база</p><h2>Резервное копирование</h2><p>Новая копия содержит контрольную сумму. Перед восстановлением сайт автоматически проверяет целостность файла.</p></div><div><button type="button" className="primary-button" onClick={onExport}>Скачать проверенную копию</button><button type="button" className="secondary-button" onClick={onRestore}>Восстановить базу из файла</button></div></article>
    <article className="panel settings-card recovery-card"><div className="panel-heading"><div><p className="eyebrow">Автоматическое сохранение</p><h2>История изменений</h2></div><button className="secondary-button compact" disabled={!checkpoints.length} onClick={onUndo}>↶ Отменить последнее</button></div>
      {!checkpoints.length ? <div className="panel-empty">Контрольные точки появятся после первого изменения данных.</div> : <div className="recovery-list">{checkpoints.slice(0, 10).map((checkpoint) => <div key={checkpoint.id}><span><strong>{checkpoint.sections.join(", ")}</strong><small>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(checkpoint.createdAt))}</small></span><button className="row-action" onClick={() => onRestoreCheckpoint(checkpoint)}>Восстановить</button></div>)}</div>}
      <div className="report-scope-note">Хранится до {MAX_CHECKPOINTS} последних состояний базы. Восстановление применяется только после вашего подтверждения.</div>
    </article>
    <article className="panel settings-card recovery-card"><div className="panel-heading"><div><p className="eyebrow">Защита от удаления</p><h2>Корзина</h2></div><span className="settings-auto-save">{trash.length} записей</span></div>
      {!trash.length ? <div className="panel-empty">Удалённые сотрудники, смены, документы и записи планов будут временно храниться здесь.</div> : <div className="recovery-list">{trash.map((entry) => <div key={entry.id}><span><strong>{entry.label}</strong><small>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.deletedAt))}</small></span><div className="row-actions"><button onClick={() => onRestoreTrash(entry)}>Восстановить</button><button className="delete" onClick={() => onDeleteTrash(entry.id)}>Удалить навсегда</button></div></div>)}</div>}
    </article>
  </section>;
}

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
  onImport,
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
  onImport: (records: ImportedWorkTimeShift[]) => void;
  onNotify: (message: string) => void;
}) {
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  const [personId, setPersonId] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const expandedActualShifts = useMemo(() => expandLinkedCrewShifts(shifts), [shifts]);
  const sourceShifts = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift])), [shifts]);
  const filtered = expandedActualShifts.filter((shift) => (!dateFrom || shift.date >= dateFrom) && (!dateTo || shift.date <= dateTo) && (!personId || shift.personId === personId));
  const actualRows = filtered.flatMap<{ kind: "actual"; date: string; personId: string; shift: Shift; sourceShift: Shift; segment: Segment | null; segmentIndex: number }>((shift) => {
    const sourceShift = sourceShifts.get(shift.linkedSourceShiftId ?? shift.id) ?? shift;
    return shift.activity === "flight" && shift.segments.length
      ? shift.segments.map((segment, segmentIndex) => ({ kind: "actual" as const, date: shift.date, personId: shift.personId, shift, sourceShift, segment, segmentIndex }))
      : [{ kind: "actual" as const, date: shift.date, personId: shift.personId, shift, sourceShift, segment: null, segmentIndex: 0 }];
  });
  const journalRows: Array<
    (typeof actualRows)[number]
    | { kind: "assignment"; date: string; personId: string; assignment: PlanAssignment }
    | { kind: "busy"; date: string; personId: string; entry: PlanBusyEntry }
  > = [...actualRows].sort((left, right) => right.date.localeCompare(left.date)
    || people.find((item) => item.id === left.personId)?.name.localeCompare(people.find((item) => item.id === right.personId)?.name ?? "", "ru-RU") || 0
  );
  const dateCells = groupedDateCells(journalRows.map((row) => ({ date: row.date })));
  function showCurrentMonth() {
    setDateFrom(localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
    setDateTo(localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  }
  function showToday() {
    const value = localIsoDate(today);
    setDateFrom(value); setDateTo(value);
  }
  function showAdjacentMonth(offset: number) {
    const reference = /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? new Date(`${dateFrom}T12:00:00`) : today;
    const target = new Date(reference.getFullYear(), reference.getMonth() + offset, 1);
    setDateFrom(localIsoDate(target));
    setDateTo(localIsoDate(new Date(target.getFullYear(), target.getMonth() + 1, 0)));
  }
  return <><section className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">Единый журнал</p><h2>Смены за выбранный период</h2></div><div className="journal-heading-actions"><button className="secondary-button" disabled={!people.length} onClick={() => setImportOpen(true)}>Импорт рабочего времени</button><button className="secondary-button pdf-button" disabled={!people.length} onClick={() => setReportOpen(true)}>Отчёт PDF</button><button className="primary-button" disabled={!people.length} onClick={onAdd}>+ Новая смена</button></div></div>
    <div className="journal-filters"><Field label="Период с"><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></Field><Field label="Период по"><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></Field><Field label="Сотрудник"><select value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Все сотрудники</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field><div className="quick-filters"><button className="secondary-button" onClick={showToday}>Сегодня</button><button className="secondary-button month-arrow" title="Предыдущий месяц" aria-label="Предыдущий месяц" onClick={() => showAdjacentMonth(-1)}>←</button><button className="secondary-button" onClick={showCurrentMonth}>Текущий месяц</button><button className="secondary-button month-arrow" title="Следующий месяц" aria-label="Следующий месяц" onClick={() => showAdjacentMonth(1)}>→</button></div></div>
    <div className="journal-summary">Показано строк: <strong>{journalRows.length}</strong>{dateFrom === dateTo ? ` · ${formatDate(dateFrom)}` : ` · ${formatDate(dateFrom)} — ${formatDate(dateTo)}`}</div>
    {!journalRows.length ? <div className="panel-empty tall">За выбранный период смен нет.</div> : <div className="table-scroll"><table><thead><tr><th>Дата</th><th>Сотрудник</th><th>Занятость</th><th>Начало–конец</th><th>ВС / кресло</th><th>Цель</th><th>Рабочее</th><th>Полётное / ночь</th><th>Отдых</th><th>Примечание</th><th>Действия</th></tr></thead><tbody>{journalRows.map((row, rowIndex) => {
      const person = people.find((item) => item.id === row.personId);
      if (row.kind === "actual") {
        const { shift, sourceShift, segment, segmentIndex } = row;
        const rest = segmentIndex === 0 ? restMap.get(shift.id) : undefined;
        const assumedCompliant = segmentIndex === 0 && assumedCompliantRestIds.has(shift.id);
        const flight = segment?.flightMinutes ?? 0; const night = segment?.nightMinutes ?? 0;
        const linkedPerson = shift.linkedPrimaryPersonId
          ? people.find((item) => item.id === shift.linkedPrimaryPersonId)
          : segment?.commanderPersonId
            ? people.find((item) => item.id === segment.commanderPersonId)
            : null;
        const crewLabel = shift.linkedPrimaryPersonId
          ? `ПИ: ${linkedPerson?.name ?? "связанная смена"}`
          : segment?.commanderPersonId
            ? `КВС: ${linkedPerson?.name ?? "связанная смена"}`
            : "";
        return <tr key={segment ? `${shift.id}-${segment.id}` : shift.id}>{dateCells[rowIndex].showDate && <td className="journal-date-cell" rowSpan={dateCells[rowIndex].rowSpan}>{formatDate(row.date)}</td>}<td><strong>{person?.name ?? "—"}</strong></td><td><span className="journal-activity">{activityLabels[shift.activity]}{crewLabel && <span className="source-pill">Одна смена · {crewLabel}</span>}{segment?.splitShift && <span className="split-pill active">Разделённая · часть {segment.splitPart ?? 1}</span>}</span></td><td>{segment ? `${segment.dutyStart || "—"}–${segment.dutyEnd || "—"}` : shift.start ? `${shift.start}–${shiftEndClock(shift)}` : "—"}</td><td>{segment ? <span className="aircraft-cell"><strong>{[segment.aircraftType, segment.aircraft].filter(Boolean).join(" · ") || "—"}</strong><small>{segment.seat}</small></span> : "—"}</td><td>{segment?.purpose || "—"}</td><td>{segment ? <span className="flight-cell"><strong>{formatDuration(segmentCountedWorkMinutes(segment))}</strong>{Boolean(segment.excludedWorkMinutes) && <small>не учитывается {formatDuration(segment.excludedWorkMinutes ?? 0)}</small>}</span> : shift.workMinutes ? formatDuration(shift.workMinutes) : "—"}</td><td>{segment ? <span className="flight-cell"><strong>{flight ? formatDuration(flight) : "—"}</strong>{night > 0 && <small>ночь {formatDuration(night)}</small>}<small>посадки Д/Н: {segment.dayLandings ?? 0}/{segment.nightLandings ?? 0}</small></span> : "—"}</td><td><RestCell shift={shift} rest={rest} assumedCompliant={assumedCompliant} allShifts={expandedActualShifts} /></td><td className="note-cell">{shift.note || "—"}</td><td><div className="row-actions"><button onClick={() => onEdit(sourceShift)}>Изменить</button><button className="delete" onClick={() => segment ? onDeleteFlight(sourceShift, segment.id) : onDelete(sourceShift)}>Удалить</button></div></td></tr>;
      }
      if (row.kind === "assignment") {
        const aircraftType = aircraftTypeForNumber(row.assignment.aircraft, aircraftNumbersByType);
        const plannedActivity = row.assignment.activity === "standby" ? "Ожидание полёта" : "Полётная смена";
        return <tr className="planned-row" key={`assignment-${row.assignment.id}`}>{dateCells[rowIndex].showDate && <td className="journal-date-cell" rowSpan={dateCells[rowIndex].rowSpan}>{formatDate(row.date)}</td>}<td><strong>{person?.name ?? "—"}</strong></td><td><span className="journal-activity">{plannedActivity}<span className="source-pill">Из месячного плана</span></span></td><td>—</td><td><span className="aircraft-cell"><strong>{[aircraftType, row.assignment.aircraft].filter(Boolean).join(" · ")}</strong><small>{planRoleLabels[row.assignment.role]}</small></span></td><td>—</td><td>—</td><td>—</td><td>—</td><td className="note-cell">{plannedActivity} · месячный план</td><td><div className="row-actions"><button onClick={() => onEditPlan({ kind: "assignment", id: row.assignment.id })}>Изменить</button><button className="delete" onClick={() => { if (window.confirm(`Удалить назначение ${person?.name ?? "сотрудника"} на ${row.assignment.aircraft} за ${formatDate(row.date)}?`)) onDeletePlanAssignment(row.assignment.id); }}>Удалить</button></div></td></tr>;
      }
      return <tr className="planned-row" key={`busy-${row.entry.id}-${row.date}`}>{dateCells[rowIndex].showDate && <td className="journal-date-cell" rowSpan={dateCells[rowIndex].rowSpan}>{formatDate(row.date)}</td>}<td><strong>{person?.name ?? "—"}</strong></td><td><span className="journal-activity">{planBusyLabels[row.entry.activity]}<span className="source-pill">Из месячного плана</span></span></td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td className="note-cell">{row.entry.note || "Из месячного плана"}</td><td><div className="row-actions"><button onClick={() => onEditPlan({ kind: "busy", id: row.entry.id })}>Изменить</button><button className="delete" onClick={() => { if (window.confirm(`Удалить занятость «${planBusyLabels[row.entry.activity]}» за ${formatDate(row.date)}?`)) onDeletePlanBusy(row.entry.id); }}>Удалить</button></div></td></tr>;
    })}</tbody></table></div>}
  </section>{reportOpen && <FlightReportModal people={people} shifts={shifts} assignments={assignments} busyEntries={busyEntries} onClose={() => setReportOpen(false)} onNotify={onNotify} />}{importOpen && <WorkTimeImportModal people={people} shifts={shifts} onClose={() => setImportOpen(false)} onSubmit={(records) => { onImport(records); setImportOpen(false); }} />}</>;
}

function RestCell({
  shift,
  rest,
  assumedCompliant,
  allShifts,
}: {
  shift: Shift;
  rest?: number;
  assumedCompliant: boolean;
  allShifts: Shift[];
}) {
  if (assumedCompliant) return <span className="success-text">по норме</span>;
  const boundaries = restBoundaries(shift, allShifts);
  const explanation = boundaries
    ? `${formatRestBoundary(boundaries.from)} → ${formatRestBoundary(boundaries.to)}`
    : "";
  const weeklyTone = rest !== undefined && rest >= 0
    ? rest >= 2_520 ? "success-text" : "danger-text"
    : "";
  if (shift.activity === "dayoff") {
    return <span className="rest-cell" title={explanation ? `Непрерывный отдых: ${explanation}` : "Для полного периода нужна следующая рабочая смена"}>
      <strong>24 ч 00 мин</strong>
      <small className={`weekly-rest ${weeklyTone}`}>{rest !== undefined && rest >= 0 ? `непрерывно ${formatDuration(rest)}` : "выходной день"}</small>
      {explanation && <small>{explanation}</small>}
    </span>;
  }
  return <span className={`rest-cell ${weeklyTone}`}>
    <strong>{rest === undefined ? "—" : rest < 0 ? "пересечение" : formatDuration(rest)}</strong>
    {explanation && <small>{explanation}</small>}
  </span>;
}

function FlightReportModal({ people, shifts, assignments, busyEntries, onClose, onNotify }: { people: Person[]; shifts: Shift[]; assignments: PlanAssignment[]; busyEntries: PlanBusyEntry[]; onClose: () => void; onNotify: (message: string) => void }) {
  const today = new Date();
  const reportShifts = useMemo(() => expandLinkedCrewShifts(shifts), [shifts]);
  type ReportType = "flight" | "employment" | "cumulative" | "summary";
  const [reportType, setReportType] = useState<ReportType>("flight");
  const [dateFrom, setDateFrom] = useState(localIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(localIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)));
  const [personId, setPersonId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dateTo || (reportType !== "cumulative" && (!dateFrom || dateFrom > dateTo))) { setError("Проверьте даты периода отчёта."); return; }
    setExporting(true); setError("");
    try {
      if (reportType === "flight") await downloadFlightReport(dateFrom, dateTo, people, reportShifts, personId || null);
      else if (reportType === "employment") await downloadEmploymentReport(dateFrom, dateTo, people, reportShifts, personId || null, assignments, busyEntries);
      else if (reportType === "cumulative") await downloadCumulativeFlightExcel(dateTo, people, reportShifts);
      else await downloadSummaryFlightReport(dateFrom, dateTo, people, reportShifts, personId || null);
      onNotify(reportType === "cumulative" ? "Excel-отчёт сформирован" : "PDF-отчёт сформирован"); onClose();
    } catch {
      setError(`Не удалось сформировать ${reportType === "cumulative" ? "Excel" : "PDF"}. Попробуйте ещё раз.`);
    } finally {
      setExporting(false);
    }
  }
  const reportHint = reportType === "flight"
    ? "Справка показывает налёт по креслу, типу ВС, бортовому номеру, цели полёта и отмечает разделённые смены."
    : reportType === "employment"
      ? "Фактические смены имеют приоритет. Если записи нет, отчёт использует месячный план: свободный день становится ожиданием полёта, а после 6 рабочих дней подряд — выходным."
      : reportType === "cumulative"
        ? "Общий Excel-отчёт включает исходные данные из файла «Баркову С.В.» за январь–июнь 2026 года и дополняет листы «ВС» и «КВС» всеми полётами сайта с 01.07.2026 по выбранную дату."
        : "Итоговая справка: пилот, тип ВС, общий налёт, ночь и инструкторский налёт — без разделения по эксплуатантам.";
  return <Modal title="Формирование отчёта" subtitle="Произвольный период и состав отчёта" onClose={onClose}><form className="form-stack" onSubmit={submit}><Field label="Вид отчёта"><select value={reportType} onChange={(event) => {
    const next = event.target.value as ReportType;
    setReportType(next);
    if (next === "cumulative") {
      setDateFrom(CUMULATIVE_APPEND_START);
      setPersonId("");
    }
    setError("");
  }}><option value="flight">Справка о налёте</option><option value="employment">Отчёт о занятости</option><option value="cumulative">Отчёт по нарастающему налёту</option><option value="summary">Итоговая справка о налёте</option></select></Field>{reportType === "cumulative" ? <Field label="Дополнить исходный отчёт по дату"><input required min={CUMULATIVE_APPEND_START} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></Field> : <><div className="form-grid two"><Field label="Период с"><input required type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></Field><Field label="Период по"><input required type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></Field></div><Field label="Состав отчёта"><select value={personId} onChange={(event) => setPersonId(event.target.value)}><option value="">Все сотрудники — общий отчёт</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field></>}<div className="report-scope-note">{reportHint}</div>{error && <div className="form-error">{error}</div>}<div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>Отмена</button><button type="submit" className="primary-button" disabled={exporting}>{exporting ? "Формирую…" : reportType === "cumulative" ? "Скачать Excel" : "Скачать PDF"}</button></div></form></Modal>;
}

function PeopleView({ people, shifts, readinessByPerson, onAdd, onEdit, onOpenPersonal }: { people: Person[]; shifts: Shift[]; readinessByPerson: Record<string, EmployeeReadiness>; onAdd: () => void; onEdit: (person: Person) => void; onOpenPersonal: (personId: string) => void }) {
  return <section className="panel people-panel">
    <div className="panel-heading"><div><p className="eyebrow">Реестр</p><h2>Сотрудники</h2></div><button className="primary-button" onClick={onAdd}>+ Добавить</button></div>
    {!people.length ? <div className="panel-empty tall">Карточки сотрудников ещё не созданы.</div> : <div className="people-grid">{people.map((person) => {
      const personShifts = shifts.filter((shift) => shift.personId === person.id);
      const readiness = readinessByPerson[person.id];
      return <article className="person-card" key={person.id}>
        <div className="person-avatar">{person.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div>
        <div className="person-body">
          <strong>{person.name}</strong>
          <span>{person.position || "Кресла не указаны"}</span>
          {readiness && <div className={`readiness-badge ${readiness.status}`}><span>{readiness.label}</span>{readiness.reasons[0] && <small>{readiness.reasons[0].label}: {readiness.reasons[0].detail}</small>}</div>}
          <div className="person-qualification-list">{person.qualifications.length ? person.qualifications.map((qualification) => <div key={qualification.id}>
            <b>{qualification.operators.join(", ") || "Эксплуатант не указан"}</b>
            <span>{qualification.aircraftTypes.join(", ") || "Тип ВС не указан"}</span>
            <small>{qualification.seats.join(", ") || "Кресла не указаны"}</small>
            {qualification.nightAircraftTypes.length > 0 && <small>Ночь: {qualification.nightAircraftTypes.join(", ")}</small>}
          </div>) : <div><span>Наборы допуска не указаны</span></div>}</div>
          <div className="person-card-actions"><button onClick={() => onOpenPersonal(person.id)}>Личное дело</button><button onClick={() => onEdit(person)}>Изменить</button></div>
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
  const [nightTypes, setNightTypes] = useState<string[]>([]);
  const [editingQualificationId, setEditingQualificationId] = useState<string | null>(null);
  const [error, setError] = useState("");

  function resetQualificationDraft() {
    setOperators([]); setTypes([]); setSeats([]); setNightTypes([]); setEditingQualificationId(null); setError("");
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
      nightAircraftTypes: orderedUnique(nightTypes.filter((aircraftType) => types.includes(aircraftType)), aircraftTypeOptions),
    };
    setQualifications((current) => editingQualificationId
      ? current.map((item) => item.id === editingQualificationId ? qualification : item)
      : [...current, qualification]);
    resetQualificationDraft();
  }

  function editQualification(qualification: Qualification) {
    setOperators(qualification.operators); setTypes(qualification.aircraftTypes); setSeats(qualification.seats);
    setNightTypes(qualification.nightAircraftTypes ?? []);
    setEditingQualificationId(qualification.id); setError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("Укажите Ф. И. О. сотрудника."); return; }
    if (operators.length || types.length || seats.length || nightTypes.length || editingQualificationId) { setError("Сначала добавьте или сохраните заполненный набор допуска."); return; }
    if (!qualifications.length) { setError("Добавьте хотя бы один набор допуска сотрудника."); return; }
    if (qualifications.some((qualification) => !qualification.operators.length || !qualification.aircraftTypes.length || !qualification.seats.length)) {
      setError("Отредактируйте неполный набор: эксплуатант, тип ВС и кресла обязательны."); return;
    }
    const permissions = orderedUnique(qualifications.flatMap((qualification) => qualification.operators), operatorOptions);
    const aircraftTypes = orderedUnique(qualifications.flatMap((qualification) => qualification.aircraftTypes), aircraftTypeOptions);
    const position = orderedUnique(qualifications.flatMap((qualification) => qualification.seats), positionOptions).join(", ");
    onSubmit({ name: name.trim(), position, permissions, aircraftTypes, qualifications });
  }
  return <Modal title={person ? "Редактирование сотрудника" : "Новый сотрудник"} subtitle="Эксплуатант → тип ВС → занимаемые кресла → ночной допуск" onClose={onClose} wide>
    <form onSubmit={submit} className="form-stack person-form">
      <Field label="Ф. И. О."><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="Иванов Иван Иванович" /></Field>
      <section className="qualification-builder">
        <div className="qualification-builder-heading"><div><strong>{editingQualificationId ? "Изменение набора допуска" : "Новый набор допуска"}</strong><span>Последовательно выберите данные и добавьте набор в карточку сотрудника.</span></div>{editingQualificationId && <button type="button" className="link-button" onClick={resetQualificationDraft}>Отменить изменение набора</button>}</div>
        <div className="qualification-step"><span>1</span><CheckboxGroup label="Эксплуатант" options={operatorOptions} values={operators} onChange={setOperators} /></div>
        <div className="qualification-step"><span>2</span><CheckboxGroup label="Тип ВС" options={aircraftTypeOptions} values={types} onChange={(values) => { setTypes(values); setNightTypes((current) => current.filter((aircraftType) => values.includes(aircraftType))); }} columns={4} /></div>
        <div className="qualification-step"><span>3</span><CheckboxGroup label="Занимаемые кресла" options={positionOptions} values={seats} onChange={setSeats} /></div>
        <div className="qualification-step"><span>4</span>{types.length
          ? <CheckboxGroup label="Допуск к полётам ночью — выберите типы ВС" options={types} values={nightTypes} onChange={setNightTypes} columns={4} />
          : <div className="qualification-night-empty"><strong>Допуск к полётам ночью</strong><span>Сначала выберите хотя бы один тип ВС на шаге 2.</span></div>}</div>
        <div className="qualification-add"><button type="button" className="secondary-button" onClick={saveQualification}>{editingQualificationId ? "Сохранить набор" : "+ Добавить набор"}</button></div>
      </section>
      {qualifications.length > 0 && <section className="qualification-list"><div className="section-label"><strong>Добавленные наборы</strong><span>{qualifications.length}</span></div>{qualifications.map((qualification, index) => <article className={editingQualificationId === qualification.id ? "editing" : ""} key={qualification.id}>
        <div className="qualification-index">{index + 1}</div>
        <div><small>Эксплуатант</small><strong>{qualification.operators.join(", ") || "Не указан"}</strong></div>
        <div><small>Тип ВС</small><strong>{qualification.aircraftTypes.join(", ") || "Не указан"}</strong></div>
        <div><small>Кресла</small><strong>{qualification.seats.join(", ") || "Не указаны"}</strong></div>
        <div><small>Ночь</small><strong>{qualification.nightAircraftTypes.length ? qualification.nightAircraftTypes.join(", ") : "Нет допуска"}</strong></div>
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
  commanderPersonId?: string;
  purpose: string;
  dutyStart: string;
  dutyEnd: string;
  flight: string;
  night: string;
  dayLandings: string;
  nightLandings: string;
  excludeFromWork: boolean;
  excludedWork: string;
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
    commanderPersonId: undefined,
    purpose: "АОН",
    dutyStart,
    dutyEnd: clockAfterMinutes(dutyStart, 480),
    flight: "00:00",
    night: "00:00",
    dayLandings: "0",
    nightLandings: "0",
    excludeFromWork: false,
    excludedWork: "00:00",
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
    dayLandings: "0",
    nightLandings: "0",
    excludeFromWork: false,
    excludedWork: "00:00",
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
    commanderPersonId: item.commanderPersonId,
    purpose: item.purpose || "АОН",
    dutyStart: item.dutyStart || shift.start || "08:00",
    dutyEnd: item.dutyEnd || clockAfterMinutes(shift.start || "08:00", shift.workMinutes || 480),
    flight: durationValue(item.flightMinutes),
    night: durationValue(item.nightMinutes),
    dayLandings: String(Math.max(0, Math.floor(item.dayLandings ?? 0))),
    nightLandings: String(Math.max(0, Math.floor(item.nightLandings ?? 0))),
    excludeFromWork: Boolean(item.excludedWorkMinutes),
    excludedWork: durationValue(item.excludedWorkMinutes ?? 0),
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

function ShiftModal({
  people,
  readinessByPerson,
  shift,
  initialPersonId,
  initialDate,
  onClose,
  onSubmit,
  onDelete,
}: {
  people: Person[];
  readinessByPerson: Record<string, EmployeeReadiness>;
  shift: Shift | null;
  initialPersonId?: string;
  initialDate?: string;
  onClose: () => void;
  onSubmit: (shift: ShiftDraft) => void;
  onDelete?: () => void;
}) {
  const resolvedInitialDate = shift?.periodStart ?? shift?.date ?? initialDate ?? localIsoDate(new Date());
  const [personId, setPersonId] = useState(shift?.personId ?? initialPersonId ?? "");
  const [date, setDate] = useState(resolvedInitialDate);
  const [dateTo, setDateTo] = useState(shift?.periodEnd ?? resolvedInitialDate);
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
    setSegments((current) => current.map((item) => ({ ...item, aircraftType: nextAircraftType, aircraft: "", commanderPersonId: undefined })));
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
    if (activity === "flight") {
      const blocked = readinessBlockReason(readinessByPerson[personId]);
      if (blocked) { setError(`Полётная смена недоступна. ${blocked}`); return; }
    }
    if (supportsPeriod && (!dateTo || dateTo < date)) { setError("Дата окончания периода не может быть раньше даты начала."); return; }
    const safeStart = usesTime(activity) && activity !== "flight" ? normalizeTime(start, true) : "";
    const safeWork = usesTime(activity) && activity !== "flight" ? normalizeTime(work) : "";
    if (usesTime(activity) && activity !== "flight" && (!safeStart || !safeWork)) { setError("Проверьте время: минуты должны быть от 00 до 59."); return; }
    if (activity === "flight" && !selectedAircraftTypes.length) { setError("Сначала укажите типы ВС в карточке выбранного сотрудника."); return; }
    if (activity === "flight" && segments.some((item) => !item.aircraftType || !selectedAircraftTypes.includes(item.aircraftType))) { setError("Выберите тип ВС из допусков выбранного сотрудника."); return; }
    if (activity === "flight" && segments.some((item) => {
      const requiredOperator = item.purpose.startsWith("АОН") ? "АОН" : item.purpose;
      if (!requiredOperator || !["КВП", "АОН", "АР"].includes(requiredOperator)) return false;
      const person = people.find((candidate) => candidate.id === personId);
      return !person?.qualifications.some((qualification) => qualification.aircraftTypes.includes(item.aircraftType) && qualification.operators.includes(requiredOperator));
    })) { setError("Цель полёта не соответствует эксплуатанту в допуске сотрудника на выбранный тип ВС."); return; }
    if (activity === "flight" && segments.some((item) => {
      const night = parseDuration(normalizeTime(item.night) || "00:00");
      if (!night) return false;
      const person = people.find((candidate) => candidate.id === personId);
      return !person?.qualifications.some((qualification) => qualification.aircraftTypes.includes(item.aircraftType) && qualification.nightAircraftTypes.includes(item.aircraftType));
    })) { setError("Для внесения ночного налёта нужен ночной допуск на выбранный тип ВС."); return; }
    if (activity === "flight" && segments.some((item) => aircraftNumbersForType(item.aircraftType).length > 0 && !isAircraftNumberAllowed(item.aircraftType, item.aircraft))) { setError("Выберите бортовой номер из списка для указанного типа ВС."); return; }
    if (activity === "flight" && segments.some((item) => {
      const dutyStart = normalizeTime(item.dutyStart, true); const dutyEnd = normalizeTime(item.dutyEnd, true);
      return !dutyStart || !dutyEnd || dutyStart === dutyEnd;
    })) { setError("Проверьте начало и окончание каждой смены: время должно быть заполнено и отличаться."); return; }
    if (activity === "flight" && segments.some((item) => {
      if (!item.commanderPersonId) return false;
      const commander = people.find((person) => person.id === item.commanderPersonId);
      return item.seat !== "Пилот-инструктор"
        || item.commanderPersonId === personId
        || !commander
        || !commander.aircraftTypes.includes(item.aircraftType)
        || !commander.qualifications.some((qualification) =>
          qualification.aircraftTypes.includes(item.aircraftType)
          && qualification.seats.some((seat) => seat === "КВС" || seat === "Командир ВС"));
    })) { setError("Выбранный КВС должен быть другим сотрудником и иметь допуск на указанный тип ВС."); return; }
    if (activity === "flight" && segments.some((item) => (item.flight && !normalizeTime(item.flight)) || (item.night && !normalizeTime(item.night)))) { setError("Проверьте полётное и ночное время."); return; }
    if (activity === "flight" && segments.some((item) => !/^\d*$/.test(item.dayLandings) || !/^\d*$/.test(item.nightLandings))) { setError("Количество посадок указывается целым неотрицательным числом."); return; }
    if (activity === "flight" && segments.some((item) => item.excludeFromWork && item.excludedWork && !normalizeTime(item.excludedWork))) { setError("Проверьте время, которое не учитывается в рабочем времени."); return; }
    const safeSegments: Segment[] = activity === "flight" ? segments.map((item) => ({
      id: item.id,
      aircraft: item.aircraft.trim(),
      aircraftType: item.aircraftType.trim(),
      seat: item.seat,
      commanderPersonId: item.seat === "Пилот-инструктор" ? item.commanderPersonId : undefined,
      purpose: item.purpose,
      dutyStart: normalizeTime(item.dutyStart, true),
      dutyEnd: normalizeTime(item.dutyEnd, true),
      flightMinutes: parseDuration(normalizeTime(item.flight) || "00:00"),
      nightMinutes: parseDuration(normalizeTime(item.night) || "00:00"),
      dayLandings: Math.max(0, Math.floor(Number(item.dayLandings) || 0)),
      nightLandings: Math.max(0, Math.floor(Number(item.nightLandings) || 0)),
      excludedWorkMinutes: item.excludeFromWork
        ? parseDuration(normalizeTime(item.excludedWork) || "00:00")
        : 0,
      splitShift: item.splitShift,
      splitGroupId: item.splitGroupId,
      splitPart: item.splitPart,
    })) : [];
    if (activity === "flight" && safeSegments.some((item) => (item.excludedWorkMinutes ?? 0) > segmentDutyMinutes(item))) {
      setError("Неучитываемое время не может превышать продолжительность соответствующей части смены.");
      return;
    }
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
                  people={people}
                  primaryPersonId={personId}
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
  people,
  primaryPersonId,
  selectedAircraftTypes,
  onChange,
}: {
  segment: SegmentDraft;
  partLabel?: string;
  personSelected: boolean;
  people: Person[];
  primaryPersonId: string;
  selectedAircraftTypes: string[];
  onChange: (patch: Partial<SegmentDraft>) => void;
}) {
  const commanderOptions = people.filter((person) =>
    person.active
    && person.id !== primaryPersonId
    && person.aircraftTypes.includes(segment.aircraftType)
    && person.qualifications.some((qualification) =>
      qualification.aircraftTypes.includes(segment.aircraftType)
      && qualification.seats.some((seat) => seat === "КВС" || seat === "Командир ВС")))
    .sort((left, right) => left.name.localeCompare(right.name, "ru-RU"));
  return <section className={partLabel ? "split-part-card" : ""}>
    {partLabel && <div className="split-part-heading"><strong>{partLabel}</strong><span>{segment.splitPart === 1 ? "до перерыва" : "после перерыва"}</span></div>}
    <div className="segment-field-grid">
      <Field label="Начало смены" hint="0830 → 08:30"><TimeEntry required clock value={segment.dutyStart} onChange={(value) => onChange({ dutyStart: value })} /></Field>
      <Field label="Конец смены" hint="1630 → 16:30"><TimeEntry required clock value={segment.dutyEnd} onChange={(value) => onChange({ dutyEnd: value })} /></Field>
      <Field label="Кресло"><select value={segment.seat} onChange={(event) => { const seat = event.target.value as Seat; onChange({ seat, commanderPersonId: seat === "Пилот-инструктор" ? segment.commanderPersonId : undefined }); }}>{seatOptions.map((seat) => <option key={seat}>{seat}</option>)}</select></Field>
      {segment.seat === "Пилот-инструктор" && <Field label="КВС в экипаже" hint="Запись появится у обоих сотрудников"><select value={segment.commanderPersonId ?? ""} onChange={(event) => onChange({ commanderPersonId: event.target.value || undefined })}><option value="">Не указывать КВС</option>{commanderOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>}
      <Field label="Тип ВС"><select required disabled={!personSelected || !selectedAircraftTypes.length} value={segment.aircraftType} onChange={(event) => onChange({ aircraftType: event.target.value, aircraft: "", commanderPersonId: undefined })}><option value="">{!personSelected ? "Сначала выберите сотрудника" : selectedAircraftTypes.length ? "Выберите тип ВС" : "Нет указанных типов ВС"}</option>{selectedAircraftTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
      <Field label="Бортовой №"><AircraftNumberSelect aircraftType={segment.aircraftType} value={segment.aircraft} onChange={(value) => onChange({ aircraft: value })} /></Field>
      <Field label="Цель"><select value={segment.purpose} onChange={(event) => onChange({ purpose: event.target.value })}>{flightPurposes.map((purpose) => <option key={purpose}>{purpose}</option>)}</select></Field>
      <Field label="Полётное" hint="0130 → 01:30"><TimeEntry value={segment.flight} onChange={(value) => onChange({ flight: value })} /></Field>
      <Field label="Ночь" hint="0045 → 00:45"><TimeEntry value={segment.night} onChange={(value) => onChange({ night: value })} /></Field>
      <fieldset className="landing-count-field">
        <legend>Посадки <small>день / ночь</small></legend>
        <div>
          <label><span>День</span><input type="number" inputMode="numeric" min="0" step="1" value={segment.dayLandings} onChange={(event) => onChange({ dayLandings: event.target.value.replace(/\D/g, "") })} /></label>
          <label><span>Ночь</span><input type="number" inputMode="numeric" min="0" step="1" value={segment.nightLandings} onChange={(event) => onChange({ nightLandings: event.target.value.replace(/\D/g, "") })} /></label>
        </div>
      </fieldset>
      <label className="excluded-work-toggle"><input type="checkbox" checked={segment.excludeFromWork} onChange={(event) => onChange({
        excludeFromWork: event.target.checked,
        excludedWork: event.target.checked ? segment.excludedWork : "00:00",
      })} /><span>В рабочее время не учитывается</span></label>
      {segment.excludeFromWork && <Field label="Не учитывать" hint="Необязательно, например 0130"><TimeEntry value={segment.excludedWork} onChange={(value) => onChange({ excludedWork: value })} /></Field>}
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

function Modal({ title, subtitle, onClose, wide, children }: { title: string; subtitle: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><div><p className="eyebrow">ШТАБ ЛС</p><h2 id="modal-title">{title}</h2><span>{subtitle}</span></div><button className="modal-close" aria-label="Закрыть" onClick={onClose}>×</button></header>{children}</section></div>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>; }
