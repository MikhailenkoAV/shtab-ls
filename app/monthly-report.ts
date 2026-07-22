import type { Content, StyleDictionary, TDocumentDefinitions } from "pdfmake/interfaces";

export type FlightReportPerson = {
  id: string;
  name: string;
  position: string;
  aircraftTypes: string[];
  active: boolean;
};

export type FlightReportSegment = {
  aircraft: string;
  aircraftType?: string;
  seat?: string;
  purpose: string;
  flightMinutes: number;
  nightMinutes: number;
};

export type FlightReportShift = {
  personId: string;
  date: string;
  activity: string;
  start?: string;
  workMinutes?: number;
  note?: string;
  segments?: FlightReportSegment[];
};

type Totals = { flight: number; night: number };
type FlightDetail = Totals & { seat: string; aircraftType: string; purpose: string };
type PersonTotals = Totals & { shiftCount: number; details: Map<string, FlightDetail> };

const activityLabels: Record<string, string> = {
  flight: "Полётная смена",
  trip: "Командировка",
  office: "Работа в офисе",
  periodic_training: "Периодическая подготовка",
  ground_training: "Наземная подготовка",
  standby: "Ожидание полёта",
  vacation: "Отпуск",
  dayoff: "Выходной",
  duty: "Ожидание полёта",
  training: "Периодическая подготовка",
};

function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

function periodLabel(dateFrom: string, dateTo: string): string {
  return dateFrom === dateTo ? displayDate(dateFrom) : `${displayDate(dateFrom)} - ${displayDate(dateTo)}`;
}

function datesBetween(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${dateFrom}T12:00:00`);
  const end = new Date(`${dateTo}T12:00:00`);
  while (current <= end) {
    dates.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function addDetail(target: Map<string, FlightDetail>, detail: FlightDetail) {
  const key = [detail.seat, detail.aircraftType, detail.purpose].join("\u0001");
  const current = target.get(key);
  target.set(key, current
    ? { ...current, flight: current.flight + detail.flight, night: current.night + detail.night }
    : detail);
}

function mergeDetails(target: Map<string, FlightDetail>, source: Map<string, FlightDetail>) {
  source.forEach((detail) => addDetail(target, detail));
}

function collectPersonTotals(person: FlightReportPerson, shifts: FlightReportShift[]): PersonTotals {
  const details = new Map<string, FlightDetail>();
  let flight = 0;
  let night = 0;
  shifts.forEach((shift) => (shift.segments ?? []).forEach((segment) => {
    const segmentFlight = Math.max(0, segment.flightMinutes || 0);
    const segmentNight = Math.max(0, segment.nightMinutes || 0);
    const aircraftType = segment.aircraftType?.trim()
      || (person.aircraftTypes.length === 1 ? person.aircraftTypes[0] : "")
      || "Тип не указан";
    const seat = segment.seat?.trim() || "КВС";
    const purpose = segment.purpose?.trim() || "Цель не указана";
    flight += segmentFlight;
    night += segmentNight;
    addDetail(details, { seat, aircraftType, purpose, flight: segmentFlight, night: segmentNight });
  }));
  return { flight, night, shiftCount: shifts.length, details };
}

function flightDetailsTable(title: string, details: Map<string, FlightDetail>): Content {
  const rows = [...details.values()].sort((left, right) =>
    `${left.seat}\u0001${left.aircraftType}\u0001${left.purpose}`.localeCompare(`${right.seat}\u0001${right.aircraftType}\u0001${right.purpose}`, "ru-RU"));
  return {
    stack: [
      { text: title, style: "sectionTitle" },
      {
        table: {
          headerRows: 1,
          widths: [90, 76, "*", 62, 68],
          body: [
            [
              { text: "Кресло", style: "tableHeader" },
              { text: "Тип ВС", style: "tableHeader" },
              { text: "Цель", style: "tableHeader" },
              { text: "Налёт", style: "tableHeader", alignment: "right" },
              { text: "Из них ночь", style: "tableHeader", alignment: "right" },
            ],
            ...(rows.length ? rows.map((row) => [
              { text: row.seat },
              { text: row.aircraftType },
              { text: row.purpose },
              { text: formatMinutes(row.flight), alignment: "right" as const },
              { text: row.night ? formatMinutes(row.night) : "—", alignment: "right" as const },
            ]) : [[{ text: "Нет данных о налёте", colSpan: 5, color: "#7b8b93", italics: true }, {}, {}, {}, {}]]),
          ],
        },
        layout: "lightHorizontalLines",
      },
    ],
    margin: [0, 0, 0, 18],
  };
}

function metrics(totalFlight: number, totalNight: number, thirdLabel: string, thirdValue: string): Content {
  return {
    table: {
      widths: ["*", "*", "*"],
      body: [[
        { stack: [{ text: "ОБЩИЙ НАЛЁТ", style: "metricLabel" }, { text: formatMinutes(totalFlight), style: "metricValue" }], fillColor: "#eef5f6" },
        { stack: [{ text: "НОЧНОЙ НАЛЁТ", style: "metricLabel" }, { text: totalNight ? formatMinutes(totalNight) : "—", style: "metricValue" }], fillColor: "#eef5f6" },
        { stack: [{ text: thirdLabel, style: "metricLabel" }, { text: thirdValue, style: "metricValue" }], fillColor: "#eef5f6" },
      ]],
    },
    layout: "noBorders",
    margin: [0, 14, 0, 20],
  };
}

function personFlightSection(person: FlightReportPerson, totals: PersonTotals, pageBreak: boolean): Content {
  return {
    stack: [
      { text: person.name, style: "personName" },
      { text: person.position || "Должность не указана", style: "position" },
      metrics(totals.flight, totals.night, "ПОЛЁТНЫХ СМЕН", String(totals.shiftCount)),
      flightDetailsTable("Налёт по креслу, типу ВС и цели полёта", totals.details),
      { text: "Время указано в формате часы:минуты.", style: "note" },
    ],
    pageBreak: pageBreak ? "before" : undefined,
  };
}

function commonStyles(): StyleDictionary {
  return {
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
  };
}

function reportFooter(currentPage: number, pageCount: number): Content {
  return {
    columns: [
      { text: "Штаб ЛС", color: "#80909a" },
      { text: `${currentPage} / ${pageCount}`, alignment: "right", color: "#80909a" },
    ],
    margin: [42, 12, 42, 0],
    fontSize: 8,
  };
}

function reportHeader(title: string, dateFrom: string, dateTo: string): Content[] {
  return [
    { text: "ЦЕНТР АВИАЦИИ «СОЛЯРИС»", style: "brand" },
    { text: title, style: "reportTitle" },
    { text: periodLabel(dateFrom, dateTo), style: "reportPeriod" },
    { text: `Сформирован ${new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date())}`, style: "generated" },
  ];
}

export function buildFlightReport(
  dateFrom: string,
  dateTo: string,
  people: FlightReportPerson[],
  shifts: FlightReportShift[],
  personId: string | null = null,
): TDocumentDefinitions {
  const periodShifts = shifts.filter((shift) => shift.activity === "flight" && shift.date >= dateFrom && shift.date <= dateTo);
  const peopleWithFlights = new Set(periodShifts.map((shift) => shift.personId));
  const includedPeople = people
    .filter((person) => personId ? person.id === personId : person.active || peopleWithFlights.has(person.id))
    .sort((left, right) => left.name.localeCompare(right.name, "ru-RU"));
  const totalsByPerson = new Map(includedPeople.map((person) => {
    const personShifts = periodShifts.filter((shift) => shift.personId === person.id);
    return [person.id, collectPersonTotals(person, personShifts)];
  }));
  const content: Content[] = reportHeader("Отчёт о налёте лётного состава", dateFrom, dateTo);

  if (!includedPeople.length) {
    content.push({ text: "В составе нет сотрудников для формирования отчёта.", style: "empty" });
  } else if (!personId) {
    const overallDetails = new Map<string, FlightDetail>();
    let overallFlight = 0;
    let overallNight = 0;
    totalsByPerson.forEach((totals) => {
      overallFlight += totals.flight;
      overallNight += totals.night;
      mergeDetails(overallDetails, totals.details);
    });
    content.push({
      stack: [
        { text: "Общий итог по всем сотрудникам", style: "personName" },
        { text: "Сводный отчёт лётного состава", style: "position" },
        metrics(overallFlight, overallNight, "СОТРУДНИКОВ", String(includedPeople.length)),
        {
          stack: [
            { text: "Налёт по сотрудникам", style: "sectionTitle" },
            {
              table: {
                headerRows: 1,
                widths: ["*", 78, 78],
                body: [
                  [
                    { text: "Сотрудник", style: "tableHeader" },
                    { text: "Общий налёт", style: "tableHeader", alignment: "right" },
                    { text: "Из них ночь", style: "tableHeader", alignment: "right" },
                  ],
                  ...includedPeople.map((person) => {
                    const totals = totalsByPerson.get(person.id)!;
                    return [
                      { text: person.name },
                      { text: formatMinutes(totals.flight), alignment: "right" as const },
                      { text: totals.night ? formatMinutes(totals.night) : "—", alignment: "right" as const },
                    ];
                  }),
                ],
              },
              layout: "lightHorizontalLines",
            },
          ],
          margin: [0, 0, 0, 18],
        },
        flightDetailsTable("Общий налёт по креслу, типу ВС и цели полёта", overallDetails),
      ],
    });
  }

  includedPeople.forEach((person) => {
    content.push(personFlightSection(person, totalsByPerson.get(person.id)!, !personId));
  });

  return {
    pageSize: "A4",
    pageMargins: [42, 48, 42, 42],
    info: {
      title: `Отчёт о налёте за ${periodLabel(dateFrom, dateTo)}`,
      author: "Штаб ЛС - Центр авиации «Солярис»",
      subject: personId ? "Отчёт о налёте сотрудника" : "Общий отчёт о налёте лётного состава",
    },
    content,
    footer: reportFooter,
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#334b59", lineHeight: 1.2 },
    styles: commonStyles(),
  };
}

function employmentPersonSection(person: FlightReportPerson, dates: string[], shifts: FlightReportShift[], pageBreak: boolean): Content {
  const rows = dates.map((date) => {
    const dayShifts = shifts.filter((shift) => shift.personId === person.id && shift.date === date)
      .sort((left, right) => (left.start ?? "").localeCompare(right.start ?? ""));
    const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(new Date(`${date}T12:00:00`));
    if (!dayShifts.length) return [
      { text: displayDate(date) },
      { text: weekday },
      { text: "Нет записи", color: "#89979e", italics: true },
      { text: "—", alignment: "right" as const },
      { text: "—" },
    ];
    return [
      { text: displayDate(date) },
      { text: weekday },
      { text: dayShifts.map((shift) => activityLabels[shift.activity] ?? shift.activity).join("\n") },
      { text: dayShifts.map((shift) => shift.workMinutes ? formatMinutes(shift.workMinutes) : "—").join("\n"), alignment: "right" as const },
      { text: dayShifts.map((shift) => shift.note?.trim() || "—").join("\n") },
    ];
  });
  return {
    stack: [
      { text: person.name, style: "personName" },
      { text: person.position || "Должность не указана", style: "position", margin: [0, 0, 0, 12] },
      {
        table: {
          headerRows: 1,
          widths: [70, 42, 190, 72, "*"],
          body: [
            [
              { text: "Дата", style: "tableHeader" },
              { text: "День", style: "tableHeader" },
              { text: "Вид занятости", style: "tableHeader" },
              { text: "Рабочее", style: "tableHeader", alignment: "right" },
              { text: "Примечание", style: "tableHeader" },
            ],
            ...rows,
          ],
        },
        layout: "lightHorizontalLines",
      },
      { text: "Отчёт содержит каждый календарный день выбранного периода, включая дни без записей.", style: "note", margin: [0, 10, 0, 0] },
    ],
    pageBreak: pageBreak ? "before" : undefined,
  };
}

export function buildEmploymentReport(
  dateFrom: string,
  dateTo: string,
  people: FlightReportPerson[],
  shifts: FlightReportShift[],
  personId: string | null = null,
): TDocumentDefinitions {
  const periodShifts = shifts.filter((shift) => shift.date >= dateFrom && shift.date <= dateTo);
  const peopleWithEntries = new Set(periodShifts.map((shift) => shift.personId));
  const includedPeople = people
    .filter((person) => personId ? person.id === personId : person.active || peopleWithEntries.has(person.id))
    .sort((left, right) => left.name.localeCompare(right.name, "ru-RU"));
  const dates = datesBetween(dateFrom, dateTo);
  const content: Content[] = reportHeader("Ежедневная занятость сотрудников", dateFrom, dateTo);
  if (!includedPeople.length) content.push({ text: "В составе нет сотрудников для формирования отчёта.", style: "empty" });
  includedPeople.forEach((person, index) => content.push(employmentPersonSection(person, dates, periodShifts, index > 0)));

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [36, 42, 36, 38],
    info: {
      title: `Ежедневная занятость за ${periodLabel(dateFrom, dateTo)}`,
      author: "Штаб ЛС - Центр авиации «Солярис»",
      subject: personId ? "Ежедневная занятость сотрудника" : "Ежедневная занятость всего состава",
    },
    content,
    footer: reportFooter,
    defaultStyle: { font: "Roboto", fontSize: 8.5, color: "#334b59", lineHeight: 1.15 },
    styles: commonStyles(),
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

export async function downloadFlightReport(
  dateFrom: string,
  dateTo: string,
  people: FlightReportPerson[],
  shifts: FlightReportShift[],
  personId: string | null = null,
) {
  const pdfMake = await getPdfMake();
  const scope = personId ? "pilot" : "all";
  pdfMake.createPdf(buildFlightReport(dateFrom, dateTo, people, shifts, personId)).download(`nalet-${dateFrom}-${dateTo}-${scope}.pdf`);
}

export async function downloadEmploymentReport(
  dateFrom: string,
  dateTo: string,
  people: FlightReportPerson[],
  shifts: FlightReportShift[],
  personId: string | null = null,
) {
  const pdfMake = await getPdfMake();
  const scope = personId ? "pilot" : "all";
  pdfMake.createPdf(buildEmploymentReport(dateFrom, dateTo, people, shifts, personId)).download(`zanyatost-${dateFrom}-${dateTo}-${scope}.pdf`);
}
