import type { ExternalFlightRecord } from "./flight-book-rules.ts";

export function externalFlightPeriod(record: ExternalFlightRecord) {
  const [year, month] = record.month.split("-").map(Number);
  const end = new Date(year, month, 0).getDate();
  return { from: record.dateFrom || `${record.month}-01`, to: record.dateTo || `${record.month}-${end}` };
}

export function externalFlightBaselineState(record: ExternalFlightRecord, baselineDate?: string): "additional" | "included" | "ambiguous" {
  if (record.baselineDisposition === "additional" || record.baselineDisposition === "included") return record.baselineDisposition;
  if (!baselineDate) return "additional";
  const period = externalFlightPeriod(record);
  if (period.to <= baselineDate) return "included";
  return period.from > baselineDate ? "additional" : "ambiguous";
}

export function externalFlightsForReport(records: ExternalFlightRecord[], dateFrom: string, dateTo: string, personId: string | null = null) {
  return records.filter((record) => !personId || record.personId === personId).flatMap((record) => {
    const period = externalFlightPeriod(record);
    if (period.to < dateFrom || period.from > dateTo) return [];
    if (period.from < dateFrom || period.to > dateTo) throw new Error(`Справка за ${record.month}: период налёта пересекает границу отчёта. Уточните даты в записи «Налёт по справкам» или выберите полный период справки.`);
    return [{ id: `external-${record.id}`, personId: record.personId, date: period.to, activity: "flight", externalFlight: true, note: record.note,
      segments: [{ id: record.id, aircraft: record.aircraft, aircraftType: record.aircraftType, seat: record.seat, purpose: record.purpose || "По справке", flightMinutes: record.flightMinutes, nightMinutes: record.nightMinutes }] }];
  });
}
