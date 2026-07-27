import type {
  FlightReportPerson,
  FlightReportShift,
} from "./monthly-report";

export const CUMULATIVE_SOURCE_END = "2026-06-30";
export const CUMULATIVE_APPEND_START = "2026-07-01";

type SourceAircraftRow = {
  board: string;
  month: string;
  minutes: number;
};

type SourcePilotRow = {
  pilot: string;
  month: string;
  minutes: number;
};

export type CumulativeAircraftGroup = {
  board: string;
  rows: Array<{ month: string; minutes: number }>;
};

export type CumulativePilotMonth = {
  month: string;
  rows: Array<{ pilot: string; minutes: number }>;
};

export type CumulativeWorkbookModel = {
  aircraftGroups: CumulativeAircraftGroup[];
  pilotMonths: CumulativePilotMonth[];
  includedThrough: string;
};

export type SourceWorkbookData = {
  aircraft: SourceAircraftRow[];
  pilots: SourcePilotRow[];
};

type XlsxCellValue = string | number | null | undefined;

function minutesFromCell(value: XlsxCellValue): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value * 1_440));
  const match = /^(\d+):(\d{2})$/.exec(String(value ?? "").trim());
  return match ? Math.max(0, Number(match[1]) * 60 + Number(match[2])) : 0;
}

export function sourceDataFromRows(aircraftRows: XlsxCellValue[][], pilotRows: XlsxCellValue[][]): SourceWorkbookData {
  const aircraft: SourceAircraftRow[] = [];
  let currentBoard = "";
  aircraftRows.slice(1).forEach((row) => {
    if (String(row[1] ?? "").trim()) currentBoard = String(row[1]).trim();
    const month = String(row[0] ?? "").trim();
    if (currentBoard && month) aircraft.push({ board: currentBoard, month, minutes: minutesFromCell(row[2]) });
  });

  const pilots: SourcePilotRow[] = [];
  let currentMonth = "";
  pilotRows.slice(1).forEach((row) => {
    if (String(row[1] ?? "").trim()) currentMonth = String(row[1]).trim();
    const pilot = String(row[0] ?? "").trim();
    if (pilot && currentMonth) pilots.push({ pilot, month: currentMonth, minutes: minutesFromCell(row[2]) });
  });
  return { aircraft, pilots };
}

function isoMonth(value: string): string {
  return value.slice(0, 7);
}

function monthsThrough(dateTo: string): string[] {
  if (dateTo < CUMULATIVE_APPEND_START) return [];
  const result: string[] = [];
  const current = new Date(`${CUMULATIVE_APPEND_START}T12:00:00`);
  const end = new Date(`${dateTo}T12:00:00`);
  while (current <= end) {
    result.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`);
    current.setMonth(current.getMonth() + 1, 1);
  }
  return result;
}

function monthLabel(month: string): string {
  const label = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" })
    .format(new Date(`${month}-01T12:00:00`))
    .replace(" г.", "");
  return label.charAt(0).toLocaleUpperCase("ru-RU") + label.slice(1);
}

function pilotShortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name.trim();
  return `${parts[0]} ${parts.slice(1, 3).map((part) => `${part[0]?.toLocaleUpperCase("ru-RU") ?? ""}.`).join("")}`;
}

function normalizePilot(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^а-яa-z0-9]/g, "");
}

function addMinutes(map: Map<string, number>, key: string, minutes: number) {
  map.set(key, (map.get(key) ?? 0) + Math.max(0, minutes || 0));
}

export function buildCumulativeWorkbookModel(
  dateTo: string,
  people: FlightReportPerson[],
  shifts: FlightReportShift[],
  source: SourceWorkbookData,
): CumulativeWorkbookModel {
  const dynamicMonths = monthsThrough(dateTo);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const aircraftByMonth = new Map<string, number>();
  const pilotsByMonth = new Map<string, number>();

  shifts
    .filter((shift) =>
      shift.activity === "flight"
      && shift.date >= CUMULATIVE_APPEND_START
      && shift.date <= dateTo)
    .forEach((shift) => {
      const month = isoMonth(shift.date);
      const person = peopleById.get(shift.personId);
      const pilot = person ? pilotShortName(person.name) : "";
      (shift.segments ?? []).forEach((segment) => {
        const minutes = Math.max(0, segment.flightMinutes || 0);
        const board = segment.aircraft?.trim();
        if (board && !shift.linkedSourceShiftId) addMinutes(aircraftByMonth, `${board}\u0001${month}`, minutes);
        if (pilot) addMinutes(pilotsByMonth, `${normalizePilot(pilot)}\u0001${month}`, minutes);
      });
    });

  const sourceAircraftOrder = [...new Set(source.aircraft.map((row) => row.board))];
  const dynamicAircraftOrder = [...new Set(
    [...aircraftByMonth.keys()].map((key) => key.split("\u0001")[0]),
  )].filter((board) => !sourceAircraftOrder.includes(board)).sort((left, right) => left.localeCompare(right, "ru"));
  const aircraftGroups = [...sourceAircraftOrder, ...dynamicAircraftOrder].map((board) => ({
    board,
    rows: [
      ...source.aircraft.filter((row) => row.board === board).map((row) => ({ month: row.month, minutes: row.minutes })),
      ...dynamicMonths.map((month) => ({
        month: monthLabel(month),
        minutes: aircraftByMonth.get(`${board}\u0001${month}`) ?? 0,
      })),
    ],
  }));

  const sourcePilotOrder = [...new Set(source.pilots.map((row) => row.pilot))];
  const sourcePilotKeys = new Set(sourcePilotOrder.map(normalizePilot));
  const dynamicPilotOrder = people
    .map((person) => pilotShortName(person.name))
    .filter((pilot) =>
      !sourcePilotKeys.has(normalizePilot(pilot))
      && dynamicMonths.some((month) => (pilotsByMonth.get(`${normalizePilot(pilot)}\u0001${month}`) ?? 0) > 0))
    .sort((left, right) => left.localeCompare(right, "ru"));
  const pilotOrder = [...sourcePilotOrder, ...dynamicPilotOrder];
  const sourcePilotMonthOrder = [...new Set(source.pilots.map((row) => row.month))];
  const pilotMonths = [
    ...sourcePilotMonthOrder.map((month) => ({
      month,
      rows: sourcePilotOrder.map((pilot) => ({
        pilot,
        minutes: source.pilots.find((row) =>
          row.month === month && normalizePilot(row.pilot) === normalizePilot(pilot))?.minutes ?? 0,
      })),
    })),
    ...dynamicMonths.map((month) => ({
      month: monthLabel(month),
      rows: pilotOrder.map((pilot) => ({
        pilot,
        minutes: pilotsByMonth.get(`${normalizePilot(pilot)}\u0001${month}`) ?? 0,
      })),
    })),
  ];

  return { aircraftGroups, pilotMonths, includedThrough: dateTo };
}

function applyReportStyle(XLSX: typeof import("xlsx-js-style"), sheet: Record<string, unknown>, rowCount: number) {
  const thinBorder = {
    top: { style: "thin", color: { rgb: "777777" } },
    bottom: { style: "thin", color: { rgb: "777777" } },
    left: { style: "thin", color: { rgb: "777777" } },
    right: { style: "thin", color: { rgb: "777777" } },
  };
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (!sheet[address]) sheet[address] = { t: "s", v: "" };
      const cell = sheet[address] as Record<string, unknown>;
      cell.s = {
        font: { name: "Calibri", sz: row === 0 ? 11 : 10, bold: row === 0, color: { rgb: "1F1F1F" } },
        fill: { patternType: "solid", fgColor: { rgb: row === 0 ? "D9D9D9" : "FFFFFF" } },
        alignment: {
          horizontal: column === 0 && row > 0 ? "left" : "center",
          vertical: "center",
          wrapText: true,
        },
        border: thinBorder,
        numFmt: column >= 2 ? "[h]:mm" : undefined,
      };
    }
  }
}

function buildAircraftSheet(XLSX: typeof import("xlsx-js-style"), model: CumulativeWorkbookModel) {
  const data: XlsxCellValue[][] = [["Месяц", "Бортовой номер", "Налёт борта", "Итого", "ВС Нарастающий"]];
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
  model.aircraftGroups.forEach((group) => {
    const startRow = data.length;
    const totalMinutes = group.rows.reduce((sum, row) => sum + row.minutes, 0);
    let runningMinutes = 0;
    group.rows.forEach((row) => {
      runningMinutes += row.minutes;
      data.push([row.month, group.board, row.minutes / 1_440, totalMinutes / 1_440, runningMinutes / 1_440]);
    });
    const endRow = data.length - 1;
    if (endRow > startRow) {
      merges.push({ s: { r: startRow, c: 1 }, e: { r: endRow, c: 1 } });
      merges.push({ s: { r: startRow, c: 3 }, e: { r: endRow, c: 3 } });
    }
  });
  const sheet = XLSX.utils.aoa_to_sheet(data) as Record<string, unknown>;
  let rowIndex = 1;
  model.aircraftGroups.forEach((group) => {
    const start = rowIndex + 1;
    const end = rowIndex + group.rows.length;
    const totalCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 3 })] as Record<string, unknown>;
    totalCell.f = `SUM(C${start}:C${end})`;
    group.rows.forEach((_, index) => {
      const excelRow = rowIndex + index + 1;
      const cumulativeCell = sheet[XLSX.utils.encode_cell({ r: rowIndex + index, c: 4 })] as Record<string, unknown> | undefined;
      if (cumulativeCell) cumulativeCell.f = `SUM(C${start}:C${excelRow})`;
    });
    rowIndex += group.rows.length;
  });
  sheet["!merges"] = merges;
  sheet["!cols"] = [{ wch: 19 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 20 }];
  sheet["!rows"] = Array.from({ length: data.length }, (_, index) => ({ hpt: index === 0 ? 24 : 21 }));
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  sheet["!margins"] = { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 };
  sheet["!pageSetup"] = { orientation: "portrait", paperSize: 9, fitToWidth: 1, fitToHeight: 0 };
  applyReportStyle(XLSX, sheet, data.length);
  return sheet;
}

function buildPilotSheet(XLSX: typeof import("xlsx-js-style"), model: CumulativeWorkbookModel) {
  const data: XlsxCellValue[][] = [["КВС", "Месяц", "Налёт", "Итого", "КВС Нарастающий"]];
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
  const runningByPilot = new Map<string, number>();
  model.pilotMonths.forEach((month) => {
    const startRow = data.length;
    const totalMinutes = month.rows.reduce((sum, row) => sum + row.minutes, 0);
    month.rows.forEach((row) => {
      const runningMinutes = (runningByPilot.get(normalizePilot(row.pilot)) ?? 0) + row.minutes;
      runningByPilot.set(normalizePilot(row.pilot), runningMinutes);
      data.push([row.pilot, month.month, row.minutes / 1_440, totalMinutes / 1_440, runningMinutes / 1_440]);
    });
    const endRow = data.length - 1;
    if (endRow > startRow) {
      merges.push({ s: { r: startRow, c: 1 }, e: { r: endRow, c: 1 } });
      merges.push({ s: { r: startRow, c: 3 }, e: { r: endRow, c: 3 } });
    }
  });
  const sheet = XLSX.utils.aoa_to_sheet(data) as Record<string, unknown>;
  let rowIndex = 1;
  model.pilotMonths.forEach((month) => {
    const start = rowIndex + 1;
    const end = rowIndex + month.rows.length;
    const totalCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 3 })] as Record<string, unknown>;
    totalCell.f = `SUM(C${start}:C${end})`;
    month.rows.forEach((_, index) => {
      const excelRow = rowIndex + index + 1;
      const cumulativeCell = sheet[XLSX.utils.encode_cell({ r: rowIndex + index, c: 4 })] as Record<string, unknown> | undefined;
      if (cumulativeCell) cumulativeCell.f = `SUMIF($A$2:A${excelRow},A${excelRow},$C$2:C${excelRow})`;
    });
    rowIndex += month.rows.length;
  });
  sheet["!merges"] = merges;
  sheet["!cols"] = [{ wch: 25 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 22 }];
  sheet["!rows"] = Array.from({ length: data.length }, (_, index) => ({ hpt: index === 0 ? 24 : 21 }));
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  sheet["!margins"] = { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 };
  sheet["!pageSetup"] = { orientation: "portrait", paperSize: 9, fitToWidth: 1, fitToHeight: 0 };
  applyReportStyle(XLSX, sheet, data.length);
  return sheet;
}

export function buildCumulativeFlightWorkbook(
  XLSX: typeof import("xlsx-js-style"),
  model: CumulativeWorkbookModel,
) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, buildAircraftSheet(XLSX, model), "ВС");
  XLSX.utils.book_append_sheet(workbook, buildPilotSheet(XLSX, model), "КВС");
  return workbook;
}

export async function downloadCumulativeFlightExcel(
  dateTo: string,
  people: FlightReportPerson[],
  shifts: FlightReportShift[],
) {
  const XLSXModule = await import("xlsx-js-style");
  const XLSX = XLSXModule.default ?? XLSXModule;
  const response = await fetch(new URL("report-templates/barkov-source.xlsx", window.location.href).toString());
  if (!response.ok) throw new Error("Не удалось загрузить исходные данные отчёта.");
  const sourceBook = XLSX.read(await response.arrayBuffer(), { type: "array", cellDates: false });
  const aircraftSheet = sourceBook.Sheets["ВС"];
  const pilotSheet = sourceBook.Sheets["КВС"];
  if (!aircraftSheet || !pilotSheet) throw new Error("В исходном файле отсутствуют листы «ВС» или «КВС».");
  const source = sourceDataFromRows(
    XLSX.utils.sheet_to_json<XlsxCellValue[]>(aircraftSheet, { header: 1, raw: true, defval: null }),
    XLSX.utils.sheet_to_json<XlsxCellValue[]>(pilotSheet, { header: 1, raw: true, defval: null }),
  );
  const model = buildCumulativeWorkbookModel(dateTo, people, shifts, source);
  const workbook = buildCumulativeFlightWorkbook(XLSX, model);
  XLSX.writeFile(workbook, `narastayushchiy-nalet-po-${dateTo}.xlsx`);
}
