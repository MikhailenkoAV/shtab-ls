import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
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
  const XLSXModule = await import("xlsx");
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
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: matrix.dates.length + 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: matrix.dates.length + 1 } },
    ...aircraftNumbers.map((_, index) => ({
      s: { r: 3 + index * 2, c: 0 },
      e: { r: 4 + index * 2, c: 0 },
    })),
  ];
  sheet["!cols"] = [{ wch: 24 }, { wch: 13 }, ...matrix.dates.map(() => ({ wch: 14 }))];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Месячный план");
  XLSX.writeFile(workbook, `mesyachnyy-plan-${month}.xlsx`);
}

const busyFill: Record<PlanBusyActivity, string> = {
  dayoff: "#55c6e9",
  periodic_training: "#e5e7e8",
  trip: "#d2cece",
  ground_training: "#f8df91",
  auc_work: "#f7e295",
  auc_study: "#f4b480",
  standby: "#cce1de",
  office: "#a9daf3",
  vacation: "#ffd8a5",
};

export function buildMonthlyPlanPdf(
  month: string,
  people: MonthlyPlanExportPerson[],
  shifts: ActualBusyInput[],
  assignments: PlanAssignment[],
  busyEntries: PlanBusyEntry[],
  logoDataUrl?: string,
): TDocumentDefinitions {
  const matrix = buildMonthlyPlanMatrix(month, people, shifts, assignments, busyEntries);
  const body: TableCell[][] = [[
    { text: "Борт / занятость", bold: true, fillColor: "#edf3f5" },
    { text: "Экипаж", bold: true, fillColor: "#edf3f5" },
    ...matrix.dates.map((date) => ({ text: dateLabel(date), bold: true, alignment: "center" as const, fillColor: "#edf3f5" })),
  ]];
  matrix.rows.forEach((row) => {
    if (row.kind === "assignment") {
      const isPrimary = row.role === "primary";
      body.push([
        isPrimary
          ? { text: `${row.aircraft}\n${row.aircraftType}`, rowSpan: 2, bold: true, alignment: "center", margin: [0, 4, 0, 0], fillColor: "#f7fafb" }
          : {},
        { text: row.label, bold: true, fillColor: isPrimary ? "#edf7e7" : "#fff0e3" },
        ...row.cells.map((cell) => ({ text: cell || " ", alignment: "center" as const, fillColor: isPrimary ? "#edf7e7" : "#fff0e3" })),
      ]);
    } else {
      const fillColor = busyFill[row.activity!];
      body.push([
        { text: row.label, colSpan: 2, bold: true, fillColor },
        {},
        ...row.cells.map((cell) => ({ text: cell || " ", alignment: "center" as const, fillColor })),
      ]);
    }
  });
  const header: Content = logoDataUrl
    ? {
      columns: [
        { stack: [{ text: "Месячный план лётного состава", style: "title" }, { text: monthDisplay(month), style: "period" }] },
        { image: logoDataUrl, width: 135, alignment: "right" },
      ],
      margin: [0, 0, 0, 12],
    }
    : { stack: [{ text: "Месячный план лётного состава", style: "title" }, { text: monthDisplay(month), style: "period" }], margin: [0, 0, 0, 12] };
  return {
    pageSize: "A3",
    pageOrientation: "landscape",
    pageMargins: [24, 24, 24, 28],
    info: {
      title: `Месячный план лётного состава — ${monthDisplay(month)}`,
      author: "Штаб ЛС — Центр авиации «Солярис»",
    },
    content: [
      header,
      {
        table: {
          headerRows: 1,
          widths: [67, 48, ...matrix.dates.map(() => 29)],
          body,
        },
        layout: {
          hLineColor: () => "#aebbc1",
          vLineColor: () => "#aebbc1",
          paddingLeft: () => 2,
          paddingRight: () => 2,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
      },
    ],
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: "Штаб ЛС · Центр авиации «Солярис»" },
        { text: `${currentPage} / ${pageCount}`, alignment: "right" },
      ],
      margin: [24, 8, 24, 0],
      color: "#7b8b93",
      fontSize: 7,
    }),
    defaultStyle: { font: "Roboto", fontSize: 5.7, color: "#304955", lineHeight: 1.05 },
    styles: {
      title: { fontSize: 18, bold: true, color: "#17384c" },
      period: { fontSize: 11, bold: true, color: "#0d8d82", margin: [0, 3, 0, 0] },
    },
  };
}

async function getPdfMake() {
  const [pdfMakeModule, fontModule] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  const pdfMakePackage = pdfMakeModule as unknown as { default?: typeof pdfMakeModule };
  const fontPackage = fontModule as unknown as { default?: Record<string, string>; vfs?: Record<string, string> };
  const pdfMake = (pdfMakePackage.default ?? pdfMakeModule) as typeof pdfMakeModule;
  pdfMake.vfs = fontPackage.default ?? fontPackage.vfs ?? {};
  return pdfMake;
}

async function getLogo(): Promise<string | undefined> {
  try {
    const response = await fetch(new URL("solaris-logo.png", window.location.href).toString());
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export async function downloadMonthlyPlanPdf(
  month: string,
  people: MonthlyPlanExportPerson[],
  shifts: ActualBusyInput[],
  assignments: PlanAssignment[],
  busyEntries: PlanBusyEntry[],
) {
  const [pdfMake, logoDataUrl] = await Promise.all([getPdfMake(), getLogo()]);
  pdfMake.createPdf(buildMonthlyPlanPdf(month, people, shifts, assignments, busyEntries, logoDataUrl))
    .download(`mesyachnyy-plan-${month}.pdf`);
}
