import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

export type MonthlyReportPerson = {
  id: string;
  name: string;
  position: string;
  aircraftTypes: string[];
  active: boolean;
};

export type MonthlyReportSegment = {
  aircraft: string;
  aircraftType?: string;
  purpose: string;
  flightMinutes: number;
  nightMinutes: number;
};

export type MonthlyReportShift = {
  personId: string;
  date: string;
  activity: string;
  segments: MonthlyReportSegment[];
};

type Totals = { flight: number; night: number };

function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function monthLabel(month: string): string {
  const label = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" })
    .format(new Date(`${month}-01T12:00:00`));
  return label.charAt(0).toLocaleUpperCase("ru-RU") + label.slice(1);
}

function addTotals(map: Map<string, Totals>, key: string, flight: number, night: number) {
  const current = map.get(key) ?? { flight: 0, night: 0 };
  map.set(key, { flight: current.flight + flight, night: current.night + night });
}

function breakdownTable(title: string, firstColumn: string, totals: Map<string, Totals>): Content {
  const rows = [...totals.entries()].sort(([left], [right]) => left.localeCompare(right, "ru-RU"));
  return {
    stack: [
      { text: title, style: "sectionTitle" },
      {
        table: {
          headerRows: 1,
          widths: ["*", 78, 78],
          body: [
            [
              { text: firstColumn, style: "tableHeader" },
              { text: "Общий налёт", style: "tableHeader", alignment: "right" },
              { text: "Ночной", style: "tableHeader", alignment: "right" },
            ],
            ...(rows.length ? rows.map(([label, value]) => [
              { text: label || "Не указано" },
              { text: formatMinutes(value.flight), alignment: "right" as const },
              { text: value.night ? formatMinutes(value.night) : "—", alignment: "right" as const },
            ]) : [[{ text: "Нет данных", colSpan: 3, color: "#7b8b93", italics: true }, {}, {}]]),
          ],
        },
        layout: "lightHorizontalLines",
      },
    ],
    margin: [0, 0, 0, 18],
  };
}

export function buildMonthlyFlightReport(
  month: string,
  people: MonthlyReportPerson[],
  shifts: MonthlyReportShift[],
): TDocumentDefinitions {
  const monthShifts = shifts.filter((shift) => shift.activity === "flight" && shift.date.startsWith(month));
  const peopleWithFlights = new Set(monthShifts.map((shift) => shift.personId));
  const includedPeople = people
    .filter((person) => person.active || peopleWithFlights.has(person.id))
    .sort((left, right) => left.name.localeCompare(right.name, "ru-RU"));
  const content: Content[] = [
    { text: "ЦЕНТР АВИАЦИИ «СОЛЯРИС»", style: "brand" },
    { text: "Отчёт о налёте лётного состава", style: "reportTitle" },
    { text: monthLabel(month), style: "reportPeriod" },
    { text: `Сформирован ${new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date())}`, style: "generated" },
  ];

  if (!includedPeople.length) {
    content.push({ text: "В составе нет сотрудников для формирования отчёта.", style: "empty" });
  }

  includedPeople.forEach((person, index) => {
    const personShifts = monthShifts.filter((shift) => shift.personId === person.id);
    const byAircraft = new Map<string, Totals>();
    const byPurpose = new Map<string, Totals>();
    let totalFlight = 0;
    let totalNight = 0;

    personShifts.forEach((shift) => shift.segments.forEach((segment) => {
      const flight = Math.max(0, segment.flightMinutes || 0);
      const night = Math.max(0, segment.nightMinutes || 0);
      const aircraftType = segment.aircraftType?.trim()
        || (person.aircraftTypes.length === 1 ? person.aircraftTypes[0] : "")
        || "Тип не указан";
      const purpose = segment.purpose?.trim() || "Цель не указана";
      totalFlight += flight;
      totalNight += night;
      addTotals(byAircraft, aircraftType, flight, night);
      addTotals(byPurpose, purpose, flight, night);
    }));

    content.push({
      stack: [
        { text: person.name, style: "personName" },
        { text: person.position || "Должность не указана", style: "position" },
        {
          table: {
            widths: ["*", "*", "*"],
            body: [[
              { stack: [{ text: "ОБЩИЙ НАЛЁТ", style: "metricLabel" }, { text: formatMinutes(totalFlight), style: "metricValue" }], fillColor: "#eef5f6" },
              { stack: [{ text: "НОЧНОЙ НАЛЁТ", style: "metricLabel" }, { text: totalNight ? formatMinutes(totalNight) : "—", style: "metricValue" }], fillColor: "#eef5f6" },
              { stack: [{ text: "ПОЛЁТНЫХ СМЕН", style: "metricLabel" }, { text: String(personShifts.length), style: "metricValue" }], fillColor: "#eef5f6" },
            ]],
          },
          layout: "noBorders",
          margin: [0, 14, 0, 20],
        },
        breakdownTable("Налёт по типам воздушных судов", "Тип ВС", byAircraft),
        breakdownTable("Налёт по целям полёта", "Цель полёта", byPurpose),
        { text: "Время указано в формате часы:минуты.", style: "note" },
      ],
      pageBreak: index === 0 ? undefined : "before",
    });
  });

  return {
    pageSize: "A4",
    pageMargins: [42, 48, 42, 42],
    info: {
      title: `Отчёт о налёте за ${monthLabel(month)}`,
      author: "Штаб ЛС — Центр авиации «Солярис»",
      subject: "Ежемесячный отчёт о налёте лётного состава",
    },
    content,
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: "Штаб ЛС", color: "#80909a" },
        { text: `${currentPage} / ${pageCount}`, alignment: "right", color: "#80909a" },
      ],
      margin: [42, 12, 42, 0],
      fontSize: 8,
    }),
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#334b59", lineHeight: 1.2 },
    styles: {
      brand: { fontSize: 8, bold: true, color: "#b68700", characterSpacing: 1.4, margin: [0, 0, 0, 10] },
      reportTitle: { fontSize: 22, bold: true, color: "#163347", margin: [0, 0, 0, 5] },
      reportPeriod: { fontSize: 13, bold: true, color: "#0d8d82", margin: [0, 0, 0, 4] },
      generated: { fontSize: 8, color: "#819099", margin: [0, 0, 0, 28] },
      personName: { fontSize: 16, bold: true, color: "#17384c", margin: [0, 0, 0, 3] },
      position: { fontSize: 9, color: "#71818b" },
      metricLabel: { fontSize: 7, bold: true, color: "#71818b", characterSpacing: 0.6, margin: [6, 7, 6, 3] },
      metricValue: { fontSize: 15, bold: true, color: "#17384c", margin: [6, 0, 6, 8] },
      sectionTitle: { fontSize: 10, bold: true, color: "#17384c", margin: [0, 0, 0, 7] },
      tableHeader: { fontSize: 7, bold: true, color: "#526b78", fillColor: "#edf3f5", margin: [0, 3, 0, 3] },
      note: { fontSize: 7, color: "#819099", italics: true },
      empty: { fontSize: 11, color: "#71818b", margin: [0, 30, 0, 0] },
    },
  };
}

export async function downloadMonthlyFlightReport(
  month: string,
  people: MonthlyReportPerson[],
  shifts: MonthlyReportShift[],
) {
  const [pdfMakeModule, fontModule] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  const pdfMakePackage = pdfMakeModule as unknown as { default?: typeof pdfMakeModule };
  const fontPackage = fontModule as unknown as { default?: Record<string, string>; vfs?: Record<string, string> };
  const pdfMake = (pdfMakePackage.default ?? pdfMakeModule) as typeof pdfMakeModule;
  pdfMake.vfs = fontPackage.default ?? fontPackage.vfs ?? {};
  pdfMake.createPdf(buildMonthlyFlightReport(month, people, shifts)).download(`nalet-${month}.pdf`);
}
