import { aircraftNumbersByType } from "./aircraft-rules.ts";

export type ImportedActivity = "flight" | "trip" | "office" | "periodic_training" | "ground_training" | "standby" | "vacation" | "dayoff";
export type ImportedSeat = "КВС" | "Пилот-инструктор";

export type WorkTimeImportPerson = {
  id: string;
  name: string;
  position: string;
  aircraftTypes: string[];
  qualifications: { aircraftTypes: string[]; seats: string[] }[];
  active: boolean;
};

export type ImportedWorkTimeSegment = {
  id: string;
  aircraft: string;
  aircraftType?: string;
  seat: ImportedSeat;
  purpose: string;
  dutyStart: string;
  dutyEnd: string;
  flightMinutes: number;
  nightMinutes: number;
  splitShift: boolean;
  splitGroupId?: string;
  splitPart?: 1 | 2;
};

export type ImportedWorkTimeShift = {
  id: string;
  personId: string;
  date: string;
  activity: ImportedActivity;
  start: string;
  workMinutes: number;
  segments: ImportedWorkTimeSegment[];
  note: string;
  createdAt: string;
  periodId?: string;
  periodStart?: string;
  periodEnd?: string;
  periodActivity?: ImportedActivity;
  periodNote?: string;
};

export type CellRange = { s: { r: number; c: number }; e: { r: number; c: number } };
export type WorkTimeSheetInput = { name: string; rows: unknown[][]; merges: CellRange[] };
export type WorkTimeImportIssue = { kind: "unmatched" | "qualification" | "seat" | "aircraft"; text: string };

export type WorkTimeImportResult = {
  records: ImportedWorkTimeShift[];
  sourcePeople: string[];
  matchedPeople: string[];
  unmatchedPeople: string[];
  unmatchedRows: number;
  flightSegments: number;
  nonFlightRecords: number;
  uncertainSeats: number;
  dateFrom: string;
  dateTo: string;
  issues: WorkTimeImportIssue[];
};

export type WorkTimeMergeResult = {
  shifts: ImportedWorkTimeShift[];
  addedShifts: number;
  addedSegments: number;
  addedRows: number;
  duplicateRows: number;
};

const flightPurposes = ["КВП", "АОН", "АР", "АОН (УТП)"];
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function cleanText(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizedNameParts(value: string): string[] {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^а-яa-z]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

export function personMatchKey(value: string): string {
  const parts = normalizedNameParts(value);
  if (!parts.length) return "";
  return `${parts[0]}|${parts.slice(1, 3).map((part) => part[0]).join("")}`;
}

function excelDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && value >= 40_000 && value < 50_000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000).toISOString().slice(0, 10);
  }
  const text = cleanText(value);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${String(+iso[2]).padStart(2, "0")}-${String(+iso[3]).padStart(2, "0")}`;
  const local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text);
  if (!local) return "";
  const year = +local[3] < 100 ? 2000 + +local[3] : +local[3];
  return `${year}-${String(+local[2]).padStart(2, "0")}-${String(+local[1]).padStart(2, "0")}`;
}

function excelMinutes(value: unknown): number | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getUTCHours() * 60 + value.getUTCMinutes();
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round((value - Math.floor(value)) * 1_440));
  const match = /^(\d{1,3}):(\d{2})/.exec(cleanText(value));
  if (!match || +match[2] > 59) return null;
  return +match[1] * 60 + +match[2];
}

function timeText(minutes: number | null): string {
  if (minutes === null) return "";
  const withinDay = ((minutes % 1_440) + 1_440) % 1_440;
  return `${String(Math.floor(withinDay / 60)).padStart(2, "0")}:${String(withinDay % 60).padStart(2, "0")}`;
}

function expandMergedRows(input: WorkTimeSheetInput): unknown[][] {
  const rows = input.rows.map((row) => [...row]);
  input.merges.forEach((merge) => {
    const value = rows[merge.s.r]?.[merge.s.c];
    if (value === undefined || value === null || value === "") return;
    for (let rowIndex = merge.s.r; rowIndex <= merge.e.r; rowIndex += 1) {
      rows[rowIndex] ??= [];
      for (let columnIndex = merge.s.c; columnIndex <= merge.e.c; columnIndex += 1) {
        if (rows[rowIndex][columnIndex] === undefined || rows[rowIndex][columnIndex] === null || rows[rowIndex][columnIndex] === "") {
          rows[rowIndex][columnIndex] = value;
        }
      }
    }
  });
  return rows;
}

function aircraftTypeForNumber(aircraft: string): string {
  const normalized = aircraft.toLocaleUpperCase("ru-RU").replace(/\s+/g, "");
  return Object.entries(aircraftNumbersByType).find(([, numbers]) =>
    numbers.some((number) => number.toLocaleUpperCase("ru-RU").replace(/\s+/g, "") === normalized))?.[0] ?? "";
}

function normalizedPurpose(value: string): string {
  const normalized = value.toLocaleUpperCase("ru-RU").replace(/\s+/g, " ").trim();
  return flightPurposes.find((purpose) => purpose === normalized) ?? (normalized.includes("УТП") ? "АОН (УТП)" : normalized || "АОН");
}

function seatsForType(person: WorkTimeImportPerson, aircraftType: string): string[] {
  const exact = person.qualifications
    .filter((qualification) => qualification.aircraftTypes.includes(aircraftType))
    .flatMap((qualification) => qualification.seats);
  return exact.length ? [...new Set(exact)] : [...new Set(person.qualifications.flatMap((qualification) => qualification.seats))];
}

function inferSeat(person: WorkTimeImportPerson, aircraftType: string, note: string): { seat: ImportedSeat; uncertain: boolean } {
  const seats = seatsForType(person, aircraftType);
  const surname = normalizedNameParts(person.name)[0] ?? "";
  const normalizedNote = note.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  const escapedSurname = surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namesCurrentPilotAsInstructor = escapedSurname
    ? new RegExp(`(?:^|[^а-я])(?:пи|пилот-инструктор)\\s+${escapedSurname}(?:$|[^а-я])`, "i").test(normalizedNote)
    : false;
  if (namesCurrentPilotAsInstructor) return { seat: "Пилот-инструктор", uncertain: false };
  const canCommand = seats.some((seat) => seat === "КВС" || seat === "Командир ВС");
  const canInstruct = seats.some((seat) => seat.includes("инструктор"));
  if (canInstruct && !canCommand) return { seat: "Пилот-инструктор", uncertain: false };
  return { seat: "КВС", uncertain: canCommand && canInstruct };
}

function activityFromNote(note: string): ImportedActivity | null {
  const normalized = note.toLocaleLowerCase("ru-RU");
  if (/командиров/.test(normalized)) return "trip";
  if (/отпуск/.test(normalized)) return "vacation";
  if (/выходн/.test(normalized)) return "dayoff";
  if (/периодическ|учеб|ауц/.test(normalized)) return "periodic_training";
  if (/наземн/.test(normalized)) return "ground_training";
  if (/офис/.test(normalized)) return "office";
  if (/ожидани/.test(normalized)) return "standby";
  return null;
}

function intervalMinutes(start: string, end: string): number {
  const [startHours, startMinutes] = start.split(":").map(Number);
  const [endHours, endMinutes] = end.split(":").map(Number);
  if (![startHours, startMinutes, endHours, endMinutes].every(Number.isFinite)) return 0;
  const from = startHours * 60 + startMinutes;
  const to = endHours * 60 + endMinutes;
  return to >= from ? to - from : 1_440 - from + to;
}

function combinedFlightWork(segments: ImportedWorkTimeSegment[]): number {
  const ranges = segments.map((segment) => {
    const [startHours, startMinutes] = segment.dutyStart.split(":").map(Number);
    const [endHours, endMinutes] = segment.dutyEnd.split(":").map(Number);
    const start = startHours * 60 + startMinutes;
    let end = endHours * 60 + endMinutes;
    if (end < start) end += 1_440;
    return { start, end };
  }).filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end)).sort((left, right) => left.start - right.start);
  if (!ranges.length) return 0;
  let total = 0;
  let currentStart = ranges[0].start;
  let currentEnd = ranges[0].end;
  ranges.slice(1).forEach((range) => {
    if (range.start <= currentEnd) currentEnd = Math.max(currentEnd, range.end);
    else {
      total += currentEnd - currentStart;
      currentStart = range.start;
      currentEnd = range.end;
    }
  });
  return total + currentEnd - currentStart;
}

function addIssue(issues: WorkTimeImportIssue[], issue: WorkTimeImportIssue) {
  if (!issues.some((item) => item.kind === issue.kind && item.text === issue.text)) issues.push(issue);
}

export function buildWorkTimeImport(
  sheets: WorkTimeSheetInput[],
  people: WorkTimeImportPerson[],
  dateFrom: string,
): WorkTimeImportResult {
  const sourcePeople = new Set<string>();
  const matchedPeople = new Set<string>();
  const unmatchedPeople = new Set<string>();
  const issues: WorkTimeImportIssue[] = [];
  const flightGroups = new Map<string, {
    person: WorkTimeImportPerson;
    date: string;
    segments: ImportedWorkTimeSegment[];
    notes: string[];
    split: boolean;
  }>();
  const nonFlightRecords: ImportedWorkTimeShift[] = [];
  let unmatchedRows = 0;
  let uncertainSeats = 0;
  let maximumDate = "";

  sheets.forEach((sheet) => {
    const rows = expandMergedRows(sheet);
    const blockStarts = (rows[1] ?? []).flatMap((value, column) =>
      cleanText(value).toLocaleLowerCase("ru-RU") === "цель полета" && cleanText(rows[0]?.[column]) ? [column] : []);
    blockStarts.forEach((startColumn) => {
      const sourceName = cleanText(rows[0]?.[startColumn]);
      sourcePeople.add(sourceName);
      const matches = people.filter((person) => personMatchKey(person.name) === personMatchKey(sourceName));
      const person = matches.length === 1 ? matches[0] : null;
      if (person) matchedPeople.add(sourceName);
      else {
        unmatchedPeople.add(sourceName);
        addIssue(issues, { kind: "unmatched", text: matches.length > 1 ? `${sourceName}: найдено несколько совпадений` : `${sourceName}: сотрудник не найден` });
      }
      const noteColumn = blockStarts.length === 1 ? startColumn + 10 : null;
      rows.slice(2).forEach((row) => {
        const purposeValue = cleanText(row[startColumn]);
        if (purposeValue === "Итого" || purposeValue === "Тип ВС") return;
        const date = excelDate(row[startColumn + 2]);
        if (!date || date < dateFrom) return;
        const aircraft = cleanText(row[startColumn + 1]).toLocaleUpperCase("ru-RU");
        const startMinutes = excelMinutes(row[startColumn + 3]);
        const flightMinutes = excelMinutes(row[startColumn + 4]) ?? 0;
        const workMinutes = excelMinutes(row[startColumn + 5]) ?? 0;
        const endMinutes = excelMinutes(row[startColumn + 6]);
        const nightMinutes = excelMinutes(row[startColumn + 7]) ?? 0;
        const note = noteColumn === null ? "" : cleanText(row[noteColumn]);
        const split = Boolean(cleanText(row[startColumn + 9]));
        const flightRow = Boolean(aircraft) && startMinutes !== null && endMinutes !== null && (workMinutes > 0 || flightMinutes > 0);
        const nonFlightActivity = activityFromNote(note);
        const nonFlightRow = Boolean(nonFlightActivity) && (!aircraft || flightMinutes === 0);
        if (!flightRow && !nonFlightRow) return;
        maximumDate = maximumDate > date ? maximumDate : date;
        if (!person) {
          unmatchedRows += 1;
          return;
        }
        if (flightRow) {
          const aircraftType = aircraftTypeForNumber(aircraft);
          if (!aircraftType) addIssue(issues, { kind: "aircraft", text: `${sourceName}, ${date}: неизвестный борт ${aircraft}` });
          else if (!person.aircraftTypes.includes(aircraftType)) {
            addIssue(issues, { kind: "qualification", text: `${sourceName}: в карточке нет типа ${aircraftType} для ${aircraft}` });
          }
          const seat = inferSeat(person, aircraftType, note);
          if (seat.uncertain) {
            uncertainSeats += 1;
            addIssue(issues, { kind: "seat", text: `${sourceName}: кресло по умолчанию «КВС», если в примечании сотрудник не указан как ПИ` });
          }
          const segment: ImportedWorkTimeSegment = {
            id: uid(),
            aircraft,
            aircraftType: aircraftType || undefined,
            seat: seat.seat,
            purpose: normalizedPurpose(purposeValue),
            dutyStart: timeText(startMinutes),
            dutyEnd: timeText(endMinutes),
            flightMinutes,
            nightMinutes: Math.min(nightMinutes, flightMinutes),
            splitShift: split,
          };
          const key = `${person.id}|${date}`;
          const group = flightGroups.get(key) ?? { person, date, segments: [], notes: [], split: false };
          group.segments.push(segment);
          if (note && !group.notes.includes(note)) group.notes.push(note);
          group.split ||= split;
          flightGroups.set(key, group);
          return;
        }
        const activity = nonFlightActivity!;
        const timed = ["office", "ground_training"].includes(activity);
        const start = timed ? timeText(startMinutes) : "";
        nonFlightRecords.push({
          id: uid(),
          personId: person.id,
          date,
          activity,
          start,
          workMinutes: timed ? workMinutes || intervalMinutes(start, timeText(endMinutes)) : 0,
          segments: [],
          note,
          createdAt: new Date().toISOString(),
          periodActivity: activity === "periodic_training" ? activity : undefined,
          periodNote: activity === "periodic_training" ? note : undefined,
        });
      });
    });
  });

  const flightRecords = [...flightGroups.values()].map((group): ImportedWorkTimeShift => {
    const segments = [...group.segments].sort((left, right) => left.dutyStart.localeCompare(right.dutyStart));
    if (group.split) {
      const splitGroupId = uid();
      segments.forEach((segment) => {
        segment.splitShift = true;
        segment.splitGroupId = splitGroupId;
      });
    }
    return {
      id: uid(),
      personId: group.person.id,
      date: group.date,
      activity: "flight",
      start: segments[0]?.dutyStart ?? "",
      workMinutes: combinedFlightWork(segments),
      segments,
      note: group.notes.join(" · "),
      createdAt: new Date().toISOString(),
    };
  });
  const records = [...flightRecords, ...nonFlightRecords].sort((left, right) => `${left.date}|${left.personId}`.localeCompare(`${right.date}|${right.personId}`));
  return {
    records,
    sourcePeople: [...sourcePeople],
    matchedPeople: [...matchedPeople],
    unmatchedPeople: [...unmatchedPeople],
    unmatchedRows,
    flightSegments: flightRecords.reduce((sum, shift) => sum + shift.segments.length, 0),
    nonFlightRecords: nonFlightRecords.length,
    uncertainSeats,
    dateFrom,
    dateTo: maximumDate,
    issues,
  };
}

function segmentSignature(segment: ImportedWorkTimeSegment): string {
  return [
    segment.aircraft,
    segment.dutyStart,
    segment.dutyEnd,
    segment.flightMinutes,
    segment.nightMinutes,
    segment.purpose,
  ].join("|");
}

function mergeNotes(current: string, incoming: string): string {
  return [...new Set([current, incoming].flatMap((value) => value.split(" · ")).map((value) => value.trim()).filter(Boolean))].join(" · ");
}

export function mergeImportedWorkTime(
  existing: ImportedWorkTimeShift[],
  incoming: ImportedWorkTimeShift[],
): WorkTimeMergeResult {
  const shifts = existing.map((shift) => ({ ...shift, segments: shift.segments.map((segment) => ({ ...segment })) }));
  let addedShifts = 0;
  let addedSegments = 0;
  let addedRows = 0;
  let duplicateRows = 0;
  incoming.forEach((record) => {
    if (record.activity === "flight") {
      const sameDay = shifts.filter((shift) => shift.personId === record.personId && shift.date === record.date && shift.activity === "flight");
      const known = new Set(sameDay.flatMap((shift) => shift.segments.map(segmentSignature)));
      const missing = record.segments.filter((segment) => {
        const signature = segmentSignature(segment);
        if (known.has(signature)) return false;
        known.add(signature);
        return true;
      });
      duplicateRows += record.segments.length - missing.length;
      if (!missing.length) return;
      if (!sameDay.length) {
        shifts.push({ ...record, segments: missing });
        addedShifts += 1;
        addedSegments += missing.length;
        addedRows += missing.length;
        return;
      }
      const target = sameDay[0];
      target.segments = [...target.segments, ...missing].sort((left, right) => left.dutyStart.localeCompare(right.dutyStart));
      target.start = target.segments[0]?.dutyStart ?? target.start;
      target.workMinutes = combinedFlightWork(target.segments);
      target.note = mergeNotes(target.note, record.note);
      addedSegments += missing.length;
      addedRows += missing.length;
      return;
    }
    const duplicate = shifts.some((shift) =>
      shift.personId === record.personId
      && shift.date === record.date
      && shift.activity === record.activity
      && shift.note.trim() === record.note.trim());
    if (duplicate) {
      duplicateRows += 1;
      return;
    }
    shifts.push(record);
    addedShifts += 1;
    addedRows += 1;
  });
  return { shifts, addedShifts, addedSegments, addedRows, duplicateRows };
}
