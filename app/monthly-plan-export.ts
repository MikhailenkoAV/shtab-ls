import { aircraftNumbersByType } from "./aircraft-rules";
import {
  ActualBusyInput,
  aircraftTypeForNumber,
  dateInPlanEntry,
  monthDates,
  planBusyActivities,
  planBusyLabels,
  planPersonShortName,
  planRoleLabels,
  PlanAssignment,
  PlanBusyActivity,
  PlanBusyEntry,
  PlanRole,
} from "./monthly-plan-rules";

export type MonthlyPlanExportPerson = {
  id: string;
  name: string;
  aircraftTypes: string[];
  active: boolean;
};

export type MonthlyPlanMatrixRow = {
  kind: "assignment" | "busy";
  label: string;
  aircraft?: string;
  aircraftType?: string;
  role?: PlanRole;
  activity?: PlanBusyActivity;
  cells: string[];
};

export type MonthlyPlanMatrix = {
  dates: string[];
  rows: MonthlyPlanMatrixRow[];
};

const aircraftNumbers = Object.values(aircraftNumbersByType).flat();

function monthDisplay(month: string): string {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" })
    .format(new Date(`${month}-01T12:00:00`))
    .replace(" г.", "");
}

function dateLabel(date: string): string {
  const value = new Date(`${date}T12:00:00`);
  const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(value).replace(".", "");
  return `${date.slice(8, 10)}\n${weekday}`;
}

export function buildMonthlyPlanMatrix(
  month: string,
  people: MonthlyPlanExportPerson[],
  shifts: ActualBusyInput[],
  assignments: PlanAssignment[],
  busyEntries: PlanBusyEntry[],
): MonthlyPlanMatrix {
  const dates = monthDates(month);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const actualBusy = shifts.filter((shift) => shift.activity !== "flight");
  const rows: MonthlyPlanMatrixRow[] = aircraftNumbers.flatMap((aircraft) =>
    (["primary", "reserve"] as PlanRole[]).map((role) => ({
      kind: "assignment" as const,
      label: planRoleLabels[role],
      aircraft,
      aircraftType: aircraftTypeForNumber(aircraft, aircraftNumbersByType),
      role,
      cells: dates.map((date) => {
        const assignment = assignments.find((item) =>
          item.date === date && item.aircraft === aircraft && item.role === role);
        const person = assignment ? peopleById.get(assignment.personId) : undefined;
        return person ? planPersonShortName(person.name) : "";
      }),
    })));
  planBusyActivities.forEach((activity) => {
    rows.push({
      kind: "busy",
      label: planBusyLabels[activity],
      activity,
      cells: dates.map((date) => {
        const personIds = new Set([
          ...busyEntries
            .filter((entry) => entry.activity === activity && dateInPlanEntry(date, entry))
            .map((entry) => entry.personId),
          ...actualBusy
            .filter((entry) => entry.activity === activity && entry.date === date)
            .map((entry) => entry.personId),
        ]);
        return [...personIds]
          .map((personId) => peopleById.get(personId))
          .filter((person): person is MonthlyPlanExportPerson => Boolean(person))
          .map((person) => planPersonShortName(person.name))
          .join("\n");
      }),
    });
  });
  return { dates, rows };
}

export async function downloadMonthlyPlanExcel(
  month: string,
  people: MonthlyPlanExportPerson[],
  shifts: ActualBusyInput[],
  assignments: PlanAssignment[],
  busyEntries: PlanBusyEntry[],
) {
  const XLSXModule = await import("xlsx-js-style");
  const XLSX = XLSXModule.default ?? XLSXModule;
  const matrix = buildMonthlyPlanMatrix(month, people, shifts, assignments, busyEntries);
  const tableRows = matrix.rows.map((row) => [
    row.kind === "assignment" ? `${row.aircraft}\n${row.aircraftType}` : row.label,
    row.kind === "assignment" ? row.label : "",
    ...row.cells,
  ]);
  const data = [
    ["Месячный план лётного состава"],
    [monthDisplay(month)],
    ["Борт / занятость", "Экипаж", ...matrix.dates.map(dateLabel)],
    ...tableRows,
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  const lastColumn = matrix.dates.length + 1;
  const lastRow = data.length - 1;
  const thinBorder = {
    top: { style: "thin", color: { rgb: "B8C5CB" } },
    bottom: { style: "thin", color: { rgb: "B8C5CB" } },
    left: { style: "thin", color: { rgb: "B8C5CB" } },
    right: { style: "thin", color: { rgb: "B8C5CB" } },
  };
  const fill = (rgb: string) => ({ patternType: "solid", fgColor: { rgb } });
  const baseStyle = {
    font: { name: "Arial", sz: 9, color: { rgb: "263F4C" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: thinBorder,
  };
  const setStyle = (row: number, column: number, style: Record<string, unknown>) => {
    const address = XLSX.utils.encode_cell({ r: row, c: column });
    if (!sheet[address]) sheet[address] = { t: "s", v: "" };
    sheet[address].s = style;
  };

  for (let column = 0; column <= lastColumn; column += 1) {
    setStyle(0, column, {
      ...baseStyle,
      fill: fill("17384C"),
      font: { name: "Arial", sz: 16, bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "left", vertical: "center", wrapText: true },
    });
    setStyle(1, column, {
      ...baseStyle,
      fill: fill("0D8D82"),
      font: { name: "Arial", sz: 11, bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "left", vertical: "center", wrapText: true },
    });
    setStyle(2, column, {
      ...baseStyle,
      fill: fill("DDE9EC"),
      font: { name: "Arial", sz: 9, bold: true, color: { rgb: "294652" } },
    });
  }

  matrix.rows.forEach((row, rowIndex) => {
    const excelRow = rowIndex + 3;
    const rowFill = row.kind === "assignment"
      ? row.role === "primary" ? "E6F2DE" : "FBE9D9"
      : busyFill[row.activity!];
    for (let column = 0; column <= lastColumn; column += 1) {
      setStyle(excelRow, column, {
        ...baseStyle,
        fill: fill(rowFill),
        font: {
          name: "Arial",
          sz: column < 2 ? 9 : 8,
          bold: column < 2,
          color: { rgb: "263F4C" },
        },
        alignment: {
          horizontal: column === 0 && row.kind === "busy" ? "left" : "center",
          vertical: "center",
          wrapText: true,
        },
      });
    }
  });

  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: matrix.dates.length + 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: matrix.dates.length + 1 } },
    ...aircraftNumbers.map((_, index) => ({
      s: { r: 3 + index * 2, c: 0 },
      e: { r: 4 + index * 2, c: 0 },
    })),
  ];
  sheet["!cols"] = [{ wch: 27 }, { wch: 14 }, ...matrix.dates.map(() => ({ wch: 16 }))];
  sheet["!rows"] = [
    { hpt: 28 },
    { hpt: 21 },
    { hpt: 32 },
    ...matrix.rows.map((row) => {
      const maximumLines = Math.max(1, ...row.cells.map((cell) => cell ? cell.split("\n").length : 1));
      return { hpt: Math.min(84, Math.max(row.kind === "busy" ? 30 : 25, maximumLines * 17)) };
    }),
  ];
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ r: 2, c: 0 }, { r: lastRow, c: lastColumn }) };
  sheet["!margins"] = { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.1, footer: 0.1 };
  sheet["!pageSetup"] = { orientation: "landscape", paperSize: 8, fitToWidth: 1, fitToHeight: 0 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Месячный план");
  XLSX.writeFile(workbook, `mesyachnyy-plan-${month}.xlsx`);
}

const busyFill: Record<PlanBusyActivity, string> = {
  dayoff: "55C6E9",
  periodic_training: "E5E7E8",
  trip: "D2CECE",
  ground_training: "F8DF91",
  auc_work: "F7E295",
  auc_study: "F4B480",
  standby: "CCE1DE",
  office: "A9DAF3",
  vacation: "FFD8A5",
};
