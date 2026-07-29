import { aircraftNumbersByType, canonicalAircraftType } from "./aircraft-rules.ts";

export type FlightBookBaselineRow = {
  id: string;
  aircraftType: string;
  totalMinutes: number;
  picMinutes: number;
  secondPilotMinutes: number;
  instructorMinutes: number;
  nightMinutes: number;
  ifrMinutes: number;
  ifrApproaches: number;
  note: string;
};

export type FlightBookBaseline = {
  id: string;
  personId: string;
  date: string;
  source: string;
  note: string;
  siteFlightStartDate?: string;
  rows: FlightBookBaselineRow[];
  createdAt: string;
};

export type FlightBookShiftRef = {
  id?: string;
  personId: string;
  date: string;
  activity: string;
  segments: {
    id?: string;
    aircraft: string;
    aircraftType?: string;
    seat?: string;
    purpose?: string;
    flightMinutes: number;
    nightMinutes: number;
  }[];
};

export type FlightBookTotals = {
  totalMinutes: number;
  picMinutes: number;
  secondPilotMinutes: number;
  instructorMinutes: number;
  nightMinutes: number;
  ifrMinutes: number;
  ifrApproaches: number;
  siteMinutes: number;
};

export type FlightBookTypeTotal = FlightBookTotals & {
  aircraftType: string;
};

export type FlightBookEntry = {
  id: string;
  date: string;
  aircraftType: string;
  aircraft: string;
  seat: string;
  purpose: string;
  flightMinutes: number;
  nightMinutes: number;
};

export type FlightBookResult = {
  baseline: FlightBookBaseline | null;
  rows: FlightBookTypeTotal[];
  total: FlightBookTotals;
  entries: FlightBookEntry[];
};

const EMPTY_TOTALS: FlightBookTotals = {
  totalMinutes: 0,
  picMinutes: 0,
  secondPilotMinutes: 0,
  instructorMinutes: 0,
  nightMinutes: 0,
  ifrMinutes: 0,
  ifrApproaches: 0,
  siteMinutes: 0,
};

function typeForSegment(segment: FlightBookShiftRef["segments"][number]): string {
  if (segment.aircraftType?.trim()) return canonicalAircraftType(segment.aircraftType);
  return Object.entries(aircraftNumbersByType)
    .find(([, numbers]) => numbers.includes(segment.aircraft))?.[0] ?? "Без типа";
}

function addTotals(target: FlightBookTotals, source: Partial<FlightBookTotals>) {
  target.totalMinutes += Math.max(0, source.totalMinutes ?? 0);
  target.picMinutes += Math.max(0, source.picMinutes ?? 0);
  target.secondPilotMinutes += Math.max(0, source.secondPilotMinutes ?? 0);
  target.instructorMinutes += Math.max(0, source.instructorMinutes ?? 0);
  target.nightMinutes += Math.max(0, source.nightMinutes ?? 0);
  target.ifrMinutes += Math.max(0, source.ifrMinutes ?? 0);
  target.ifrApproaches += Math.max(0, Math.floor(source.ifrApproaches ?? 0));
  target.siteMinutes += Math.max(0, source.siteMinutes ?? 0);
}

export function latestFlightBookBaseline(
  baselines: FlightBookBaseline[],
  personId: string,
): FlightBookBaseline | null {
  return baselines
    .filter((item) => item.personId === personId)
    .sort((left, right) =>
      `${right.date}|${right.createdAt}`.localeCompare(`${left.date}|${left.createdAt}`))[0] ?? null;
}

function journalStartDate(baseline: FlightBookBaseline | null): string {
  if (!baseline) return "";
  if (baseline.siteFlightStartDate) return baseline.siteFlightStartDate;
  // Compatibility with control points imported before the July boundary
  // became part of the saved data model.
  if (/\.(xlsx|xls|csv)\b|excel|элк/i.test(baseline.source)) return "2026-07-01";
  return "";
}

export function buildFlightBook(
  personId: string,
  shifts: FlightBookShiftRef[],
  baselines: FlightBookBaseline[],
  allowedAircraftTypes: string[] = [],
): FlightBookResult {
  const baseline = latestFlightBookBaseline(baselines, personId);
  const siteFlightStartDate = journalStartDate(baseline);
  const byType = new Map<string, FlightBookTypeTotal>();
  const ensure = (aircraftType: string) => {
    const current = byType.get(aircraftType);
    if (current) return current;
    const created = { aircraftType, ...EMPTY_TOTALS };
    byType.set(aircraftType, created);
    return created;
  };

  allowedAircraftTypes.filter(Boolean).map(canonicalAircraftType).forEach(ensure);
  baseline?.rows.forEach((row) => addTotals(ensure(canonicalAircraftType(row.aircraftType) || "Без типа"), {
    totalMinutes: row.totalMinutes,
    picMinutes: row.picMinutes,
    secondPilotMinutes: row.secondPilotMinutes,
    instructorMinutes: row.instructorMinutes,
    nightMinutes: row.nightMinutes,
    ifrMinutes: row.ifrMinutes,
    ifrApproaches: row.ifrApproaches,
  }));

  const entries: FlightBookEntry[] = [];
  shifts
    .filter((shift) =>
      shift.personId === personId
      && shift.activity === "flight"
      && (!baseline?.date || (siteFlightStartDate
        ? shift.date >= siteFlightStartDate
        : shift.date > baseline.date)))
    .forEach((shift) => shift.segments.forEach((segment, index) => {
      const aircraftType = typeForSegment(segment);
      const flightMinutes = Math.max(0, segment.flightMinutes || 0);
      const nightMinutes = Math.max(0, segment.nightMinutes || 0);
      const seat = segment.seat?.trim() || "КВС";
      const row = ensure(aircraftType);
      addTotals(row, {
        totalMinutes: flightMinutes,
        picMinutes: /квс|командир/i.test(seat) && !/инструктор/i.test(seat) ? flightMinutes : 0,
        secondPilotMinutes: /2п|втор/i.test(seat) ? flightMinutes : 0,
        instructorMinutes: /инструктор/i.test(seat) ? flightMinutes : 0,
        nightMinutes,
        siteMinutes: flightMinutes,
      });
      entries.push({
        id: `${shift.id ?? shift.date}-${segment.id ?? index}`,
        date: shift.date,
        aircraftType,
        aircraft: segment.aircraft,
        seat,
        purpose: segment.purpose ?? "",
        flightMinutes,
        nightMinutes,
      });
    }));

  const rows = [...byType.values()]
    .filter((row) => Object.values(row).some((value) => typeof value === "number" && value > 0)
      || allowedAircraftTypes.map(canonicalAircraftType).includes(row.aircraftType))
    .sort((left, right) => left.aircraftType.localeCompare(right.aircraftType, "ru-RU"));
  const total = { ...EMPTY_TOTALS };
  rows.forEach((row) => addTotals(total, row));
  entries.sort((left, right) => `${right.date}|${right.id}`.localeCompare(`${left.date}|${left.id}`));
  return { baseline, rows, total, entries };
}
