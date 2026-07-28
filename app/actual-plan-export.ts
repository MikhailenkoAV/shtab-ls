export type ActualPlanExportPerson = {
  id: string;
  name: string;
  active: boolean;
};

export type ActualPlanExportShift = {
  personId: string;
  date: string;
  activity: string;
  start?: string;
  note?: string;
  segments?: {
    aircraft?: string;
    aircraftType?: string;
  }[];
};

export type ActualPlanExportCell = {
  text: string;
  activity: string;
};

export type ActualPlanExportMatrix = {
  dates: string[];
  people: ActualPlanExportPerson[];
  cells: ActualPlanExportCell[][];
};

const activityLabels: Record<string, string> = {
  flight: "Полётная смена",
  trip: "Командировка",
  office: "Работа в офисе",
  periodic_training: "Периодическая подготовка",
  ground_training: "Наземная подготовка",
  standby: "Ожидание полёта",
  vacation: "Отпуск",
  dayoff: "Выходной",
};

const activityFills: Record<string, string> = {
  flight: "E7F4E3",
  trip: "DDD9D9",
  office: "B9E0F4",
  periodic_training: "E5E7E8",
  ground_training: "F8DF91",
  standby: "D6E7E4",
  vacation: "FFD8A5",
  dayoff: "6FCDE9",
  mixed: "EDF3F5",
  empty: "FFFFFF",
};

function monthDates(month: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const [year, monthNumber] = month.split("-").map(Number);
  const count = new Date(year, monthNumber, 0).getDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

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

function flightLabel(shift: ActualPlanExportShift): string {
  const segments = shift.segments ?? [];
  const types = [...new Set(segments.map((segment) => segment.aircraftType).filter(Boolean))];
  const aircraft = [...new Set(segments.map((segment) => segment.aircraft).filter(Boolean))];
  return [types.join("/"), aircraft.join("/")].filter(Boolean).join(" · ") || "Полётная смена";
}

function shiftLabel(shift: ActualPlanExportShift): string {
  const activity = shift.activity === "flight" ? flightLabel(shift) : activityLabels[shift.activity] ?? shift.activity;
  return [activity, shift.start, shift.note].filter(Boolean).join("\n");
}

export function buildActualPlanExportMatrix(
  month: string,
  people: ActualPlanExportPerson[],
  shifts: ActualPlanExportShift[],
): ActualPlanExportMatrix {
  const dates = monthDates(month);
  const monthShifts = shifts.filter((shift) => shift.date.startsWith(month));
  const includedPeople = people
    .filter((person) => person.active || monthShifts.some((shift) => shift.personId === person.id))
    .sort((left, right) => left.name.localeCompare(right.name, "ru-RU"));
  const cells = includedPeople.map((person) => dates.map((date): ActualPlanExportCell => {
    const entries = monthShifts
      .filter((shift) => shift.personId === person.id && shift.date === date)
      .sort((left, right) => (left.start ?? "").localeCompare(right.start ?? ""));
    const activities = [...new Set(entries.map((shift) => shift.activity))];
    return {
      text: entries.map(shiftLabel).join("\n────────\n"),
      activity: activities.length === 1 ? activities[0] : activities.length > 1 ? "mixed" : "empty",
    };
  }));
  return { dates, people: includedPeople, cells };
}

export async function downloadActualPlanExcel(
  month: string,
  people: ActualPlanExportPerson[],
  shifts: ActualPlanExportShift[],
) {
  const XLSXModule = await import("xlsx-js-style");
  const XLSX = XLSXModule.default ?? XLSXModule;
  const matrix = buildActualPlanExportMatrix(month, people, shifts);
  const occupiedDays = new Set(
    shifts.filter((shift) => shift.date.startsWith(month)).map((shift) => `${shift.personId}|${shift.date}`),
  ).size;
  const data = [
    ["Фактический план лётного состава"],
    [`${monthDisplay(month)} · занятых человеко-дней: ${occupiedDays}`],
    ["Сотрудник", ...matrix.dates.map(dateLabel)],
    ...matrix.people.map((person, personIndex) => [
      person.name,
      ...matrix.cells[personIndex].map((cell) => cell.text),
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  const lastColumn = matrix.dates.length;
  const thinBorder = {
    top: { style: "thin", color: { rgb: "C7D2D7" } },
    bottom: { style: "thin", color: { rgb: "C7D2D7" } },
    left: { style: "thin", color: { rgb: "C7D2D7" } },
    right: { style: "thin", color: { rgb: "C7D2D7" } },
  };
  const fill = (rgb: string) => ({ patternType: "solid", fgColor: { rgb } });
  const setStyle = (row: number, column: number, style: Record<string, unknown>) => {
    const address = XLSX.utils.encode_cell({ r: row, c: column });
    if (!sheet[address]) sheet[address] = { t: "s", v: "" };
    sheet[address].s = style;
  };

  for (let column = 0; column <= lastColumn; column += 1) {
    setStyle(0, column, {
      fill: fill("17384C"),
      font: { name: "Arial", sz: 16, bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "left", vertical: "center" },
    });
    setStyle(1, column, {
      fill: fill("0D8D82"),
      font: { name: "Arial", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "left", vertical: "center" },
    });
    setStyle(2, column, {
      fill: fill("DDE9EC"),
      font: { name: "Arial", sz: 9, bold: true, color: { rgb: "294652" } },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      border: thinBorder,
    });
  }

  matrix.people.forEach((person, personIndex) => {
    const row = personIndex + 3;
    setStyle(row, 0, {
      fill: fill("F7FAFB"),
      font: { name: "Arial", sz: 9, bold: true, color: { rgb: "284958" } },
      alignment: { horizontal: "left", vertical: "center", wrapText: true },
      border: thinBorder,
    });
    matrix.cells[personIndex].forEach((cell, dateIndex) => {
      setStyle(row, dateIndex + 1, {
        fill: fill(activityFills[cell.activity] ?? activityFills.mixed),
        font: { name: "Arial", sz: 7, color: { rgb: "294652" } },
        alignment: { horizontal: "left", vertical: "top", wrapText: true },
        border: thinBorder,
      });
    });
  });

  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastColumn } },
  ];
  sheet["!cols"] = [{ wch: 32 }, ...matrix.dates.map(() => ({ wch: 17 }))];
  sheet["!rows"] = [
    { hpt: 28 },
    { hpt: 22 },
    { hpt: 32 },
    ...matrix.people.map((_, personIndex) => {
      const maximumLines = Math.max(1, ...matrix.cells[personIndex].map((cell) => cell.text ? cell.text.split("\n").length : 1));
      return { hpt: Math.min(110, Math.max(36, maximumLines * 12)) };
    }),
  ];
  sheet["!autofilter"] = { ref: `A3:${XLSX.utils.encode_col(lastColumn)}${data.length}` };
  sheet["!margins"] = { left: 0.2, right: 0.2, top: 0.35, bottom: 0.35, header: 0.1, footer: 0.1 };
  sheet["!pageSetup"] = { orientation: "landscape", paperSize: 8, fitToWidth: 1, fitToHeight: 0 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Фактический план");
  XLSX.writeFile(workbook, `fakticheskiy-plan-${month}.xlsx`);
}
