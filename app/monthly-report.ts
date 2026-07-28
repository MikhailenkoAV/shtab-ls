import type { Content, StyleDictionary, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { aircraftNumbersByType } from "./aircraft-rules.ts";
import { crewDutyMinutes } from "./crew-rules.ts";
import { aircraftTypeForNumber, planBusyLabels, planRoleLabels } from "./monthly-plan-rules.ts";

export type FlightReportPerson = {
  id: string;
  name: string;
  position: string;
  aircraftTypes: string[];
  active: boolean;
};

export type FlightReportSegment = {
  id?: string;
  aircraft: string;
  aircraftType?: string;
  seat?: string;
  purpose: string;
  dutyStart?: string;
  dutyEnd?: string;
  flightMinutes: number;
  nightMinutes: number;
  excludedWorkMinutes?: number;
  splitShift?: boolean;
  splitGroupId?: string;
};

export type FlightReportShift = {
  id?: string;
  personId: string;
  date: string;
  activity: string;
  start?: string;
  workMinutes?: number;
  note?: string;
  segments?: FlightReportSegment[];
  linkedSourceShiftId?: string;
  linkedPrimaryPersonId?: string;
};

export type EmploymentPlanAssignment = {
  id?: string;
  personId: string;
  date: string;
  aircraft: string;
  role: "primary" | "reserve";
  activity?: "flight" | "standby";
};

export type EmploymentPlanBusyEntry = {
  id?: string;
  personId: string;
  dateFrom: string;
  dateTo: string;
  activity: string;
  note?: string;
};

type Totals = { flight: number; night: number };
type FlightDetail = Totals & {
  seat: string;
  aircraftType: string;
  aircraft: string;
  purpose: string;
  splitShift: boolean;
};
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
  auc_work: "Работа в АУЦ",
  auc_study: "Учёба в АУЦ",
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
  const key = [detail.seat, detail.aircraftType, detail.aircraft, detail.purpose, detail.splitShift ? "1" : "0"].join("\u0001");
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
    const aircraft = segment.aircraft?.trim() || "Борт не указан";
    const purpose = segment.purpose?.trim() || "Цель не указана";
    flight += segmentFlight;
    night += segmentNight;
    addDetail(details, {
      seat,
      aircraftType,
      aircraft,
      purpose,
      splitShift: Boolean(segment.splitShift),
      flight: segmentFlight,
      night: segmentNight,
    });
  }));
  const shiftCount = shifts.reduce((sum, shift) => {
    const segments = shift.segments ?? [];
    if (!segments.length) return sum + 1;
    const entries = new Set(segments.map((segment, index) =>
      segment.splitShift && segment.splitGroupId ? `split:${segment.splitGroupId}` : `segment:${segment.id ?? index}`));
    return sum + entries.size;
  }, 0);
  return { flight, night, shiftCount, details };
}

function flightDetailsTable(title: string, details: Map<string, FlightDetail>): Content {
  const rows = [...details.values()].sort((left, right) =>
    `${left.seat}\u0001${left.aircraftType}\u0001${left.aircraft}\u0001${left.purpose}\u0001${left.splitShift}`
      .localeCompare(`${right.seat}\u0001${right.aircraftType}\u0001${right.aircraft}\u0001${right.purpose}\u0001${right.splitShift}`, "ru-RU"));
  return {
    stack: [
      { text: title, style: "sectionTitle" },
      {
        table: {
          headerRows: 1,
          widths: [68, 54, 72, "*", 24, 48, 54],
          body: [
            [
              { text: "Кресло", style: "tableHeader" },
              { text: "Тип ВС", style: "tableHeader" },
              { text: "Бортовой №", style: "tableHeader" },
              { text: "Цель", style: "tableHeader" },
              { text: "РС", style: "tableHeader", alignment: "center" },
              { text: "Налёт", style: "tableHeader", alignment: "right" },
              { text: "Из них ночь", style: "tableHeader", alignment: "right" },
            ],
            ...(rows.length ? rows.map((row) => [
              { text: row.seat },
              { text: row.aircraftType },
              { text: row.aircraft },
              { text: row.purpose },
              { text: row.splitShift ? "+" : "—", alignment: "center" as const, bold: row.splitShift },
              { text: formatMinutes(row.flight), alignment: "right" as const },
              { text: row.night ? formatMinutes(row.night) : "—", alignment: "right" as const },
            ]) : [[{ text: "Нет данных о налёте", colSpan: 7, color: "#7b8b93", italics: true }, {}, {}, {}, {}, {}, {}]]),
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
      { text: "Время указано в формате часы:минуты. РС — разделение полётной смены на части; «+» означает наличие разделения.", style: "note" },
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
      { text: "ШТАБ ЛС", color: "#80909a" },
      { text: `${currentPage} / ${pageCount}`, alignment: "right", color: "#80909a" },
    ],
    margin: [42, 12, 42, 0],
    fontSize: 8,
  };
}

function reportHeader(title: string, dateFrom: string, dateTo: string, logoDataUrl?: string): Content[] {
  return [
    logoDataUrl ? {
      columns: [
        { text: "ЦЕНТР АВИАЦИИ «СОЛЯРИС»", style: "brand" },
        { image: logoDataUrl, width: 145, alignment: "right", margin: [0, -8, 0, 8] },
      ],
    } : { text: "ЦЕНТР АВИАЦИИ «СОЛЯРИС»", style: "brand" },
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
  logoDataUrl?: string,
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
  const content: Content[] = reportHeader("Справка о налёте лётного состава", dateFrom, dateTo, logoDataUrl);

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
      title: `Справка о налёте за ${periodLabel(dateFrom, dateTo)}`,
      author: "ШТАБ ЛС - Центр авиации «Солярис»",
      subject: personId ? "Справка о налёте сотрудника" : "Общая справка о налёте лётного состава",
    },
    content,
    footer: reportFooter,
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#334b59", lineHeight: 1.2 },
    styles: commonStyles(),
  };
}

type SummaryFlightRow = {
  personName: string;
  aircraftType: string;
  flight: number;
  night: number;
  instructor: number;
};

function reportAircraftType(person: FlightReportPerson, segment: FlightReportSegment): string {
  return segment.aircraftType?.trim()
    || (person.aircraftTypes.length === 1 ? person.aircraftTypes[0] : "")
    || "Тип не указан";
}

export function buildSummaryFlightReport(
  dateFrom: string,
  dateTo: string,
  people: FlightReportPerson[],
  shifts: FlightReportShift[],
  personId: string | null = null,
  logoDataUrl?: string,
): TDocumentDefinitions {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const totals = new Map<string, SummaryFlightRow>();
  shifts
    .filter((shift) => shift.activity === "flight" && shift.date >= dateFrom && shift.date <= dateTo && (!personId || shift.personId === personId))
    .forEach((shift) => {
      const person = peopleById.get(shift.personId);
      if (!person) return;
      (shift.segments ?? []).forEach((segment) => {
        const aircraftType = reportAircraftType(person, segment);
        const key = `${person.id}\u0001${aircraftType}`;
        const current = totals.get(key) ?? {
          personName: person.name,
          aircraftType,
          flight: 0,
          night: 0,
          instructor: 0,
        };
        const flight = Math.max(0, segment.flightMinutes || 0);
        current.flight += flight;
        current.night += Math.max(0, segment.nightMinutes || 0);
        if (segment.seat?.toLocaleLowerCase("ru-RU").includes("инструктор")) current.instructor += flight;
        totals.set(key, current);
      });
    });
  const rows = [...totals.values()].sort((left, right) =>
    left.personName.localeCompare(right.personName, "ru-RU")
    || left.aircraftType.localeCompare(right.aircraftType, "ru-RU"));
  const total = rows.reduce((result, row) => ({
    flight: result.flight + row.flight,
    night: result.night + row.night,
    instructor: result.instructor + row.instructor,
  }), { flight: 0, night: 0, instructor: 0 });
  const content: Content[] = [
    ...reportHeader("Итоговая справка о налёте", dateFrom, dateTo, logoDataUrl),
    {
      table: {
        headerRows: 1,
        widths: ["*", 72, 70, 70, 82],
        body: [
          [
            { text: "Пилот", style: "tableHeader" },
            { text: "Тип ВС", style: "tableHeader" },
            { text: "Налёт", style: "tableHeader", alignment: "right" },
            { text: "Ночь", style: "tableHeader", alignment: "right" },
            { text: "Инструктор", style: "tableHeader", alignment: "right" },
          ],
          ...(rows.length ? rows.map((row) => [
            { text: row.personName },
            { text: row.aircraftType },
            { text: formatMinutes(row.flight), alignment: "right" as const },
            { text: row.night ? formatMinutes(row.night) : "—", alignment: "right" as const },
            { text: row.instructor ? formatMinutes(row.instructor) : "—", alignment: "right" as const },
          ]) : [[{ text: "За выбранный период налёт не найден.", colSpan: 5, color: "#71818b", italics: true }, {}, {}, {}, {}]]),
          [
            { text: "ИТОГО", colSpan: 2, bold: true, fillColor: "#e7f1f2" },
            {},
            { text: formatMinutes(total.flight), bold: true, alignment: "right", fillColor: "#e7f1f2" },
            { text: total.night ? formatMinutes(total.night) : "—", bold: true, alignment: "right", fillColor: "#e7f1f2" },
            { text: total.instructor ? formatMinutes(total.instructor) : "—", bold: true, alignment: "right", fillColor: "#e7f1f2" },
          ],
        ],
      },
      layout: "lightHorizontalLines",
    },
    { text: "Данные объединены только по пилоту и типу ВС, без разделения по эксплуатантам.", style: "note", margin: [0, 10, 0, 0] },
  ];
  return {
    pageSize: "A4",
    pageMargins: [42, 48, 42, 42],
    info: {
      title: `Итоговая справка о налёте за ${periodLabel(dateFrom, dateTo)}`,
      author: "ШТАБ ЛС - Центр авиации «Солярис»",
      subject: "Итоговая справка о налёте",
    },
    content,
    footer: reportFooter,
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#334b59", lineHeight: 1.2 },
    styles: commonStyles(),
  };
}

function groupReportSegments(segments: FlightReportSegment[]): FlightReportSegment[][] {
  const groups: FlightReportSegment[][] = [];
  const handled = new Set<string>();
  segments.forEach((segment, index) => {
    const groupId = segment.splitShift ? segment.splitGroupId : "";
    if (!groupId) {
      groups.push([segment]);
      return;
    }
    if (handled.has(groupId)) return;
    handled.add(groupId);
    groups.push(segments.filter((candidate) => candidate.splitGroupId === groupId));
    if (!groups.at(-1)?.length) groups.push([segments[index]]);
  });
  return groups;
}

function employmentPersonSection(person: FlightReportPerson, dates: string[], shifts: FlightReportShift[], pageBreak: boolean): Content {
  const personShifts = shifts.filter((shift) => shift.personId === person.id);
  const minuteText = (minutes: number) => minutes > 0 ? formatMinutes(minutes) : "—";
  const summary = personShifts.reduce((total, shift) => {
    total.work += Math.max(0, shift.workMinutes || 0);
    (shift.segments ?? []).forEach((segment) => {
      const flight = Math.max(0, segment.flightMinutes || 0);
      total.flight += flight;
      total.night += Math.max(0, segment.nightMinutes || 0);
      if (segment.seat?.toLocaleLowerCase("ru-RU").includes("инструктор")) total.instructor += flight;
    });
    return total;
  }, { work: 0, flight: 0, instructor: 0, night: 0 });

  const rows: TableCell[][] = dates.flatMap((date): TableCell[][] => {
    const dayShifts = personShifts.filter((shift) => shift.date === date)
      .sort((left, right) => (left.start ?? "").localeCompare(right.start ?? ""));
    const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(new Date(`${date}T12:00:00`));
    if (!dayShifts.length) return [[
      { text: displayDate(date) },
      { text: weekday },
      { text: "Нет записи", color: "#89979e", italics: true },
      { text: "—" },
      { text: "—" },
      { text: "—", alignment: "center" as const },
      { text: "—", alignment: "right" as const },
      { text: "—", alignment: "right" as const },
      { text: "—", alignment: "right" as const },
      { text: "—", alignment: "right" as const },
      { text: "—" },
    ]];

    return dayShifts.flatMap((shift) => {
      const segments = shift.segments ?? [];
      const groups = shift.activity === "flight" && segments.length ? groupReportSegments(segments) : [[]];
      return groups.map((group) => {
        const flight = group.reduce((sum, segment) => sum + Math.max(0, segment.flightMinutes || 0), 0);
        const instructor = group.reduce((sum, segment) =>
          sum + (segment.seat?.toLocaleLowerCase("ru-RU").includes("инструктор") ? Math.max(0, segment.flightMinutes || 0) : 0), 0);
        const night = group.reduce((sum, segment) => sum + Math.max(0, segment.nightMinutes || 0), 0);
        const work = group.length ? crewDutyMinutes(group) : Math.max(0, shift.workMinutes || 0);
        const aircraftTypes = [...new Set(group.map((segment) => segment.aircraftType?.trim()).filter((value): value is string => Boolean(value)))];
        if (!aircraftTypes.length && shift.activity === "flight" && person.aircraftTypes.length === 1) aircraftTypes.push(person.aircraftTypes[0]);
        const aircraft = [...new Set(group.map((segment) => segment.aircraft?.trim()).filter(Boolean))];
        return [
          { text: displayDate(date) },
          { text: weekday },
          { text: activityLabels[shift.activity] ?? shift.activity },
          { text: aircraftTypes.join(", ") || "—" },
          { text: aircraft.join(", ") || "—" },
          { text: group.some((segment) => segment.splitShift) ? "+" : "—", alignment: "center" as const, bold: group.some((segment) => segment.splitShift) },
          { text: minuteText(work), alignment: "right" as const },
          { text: minuteText(flight), alignment: "right" as const },
          { text: minuteText(instructor), alignment: "right" as const },
          { text: minuteText(night), alignment: "right" as const },
          { text: shift.note?.trim() || "—" },
        ];
      });
    });
  });
  const totalRow: TableCell[] = [
    { text: "ИТОГО ПО СОТРУДНИКУ", colSpan: 6, bold: true, color: "#17384c", fillColor: "#e7f1f2" },
    {}, {}, {}, {}, {},
    { text: formatMinutes(summary.work), alignment: "right" as const, bold: true, fillColor: "#e7f1f2" },
    { text: formatMinutes(summary.flight), alignment: "right" as const, bold: true, fillColor: "#e7f1f2" },
    { text: formatMinutes(summary.instructor), alignment: "right" as const, bold: true, fillColor: "#e7f1f2" },
    { text: formatMinutes(summary.night), alignment: "right" as const, bold: true, fillColor: "#e7f1f2" },
    { text: "часы:минуты", color: "#71818b", italics: true, fillColor: "#e7f1f2" },
  ];
  return {
    stack: [
      { text: person.name, style: "personName" },
      { text: person.position || "Должность не указана", style: "position", margin: [0, 0, 0, 12] },
      {
        table: {
          headerRows: 1,
          widths: [50, 25, 92, 43, 58, 22, 46, 46, 54, 44, "*"],
          body: [
            [
              { text: "Дата", style: "tableHeader" },
              { text: "День", style: "tableHeader" },
              { text: "Вид занятости", style: "tableHeader" },
              { text: "Тип ВС", style: "tableHeader" },
              { text: "Бортовой №", style: "tableHeader" },
              { text: "РС", style: "tableHeader", alignment: "center" },
              { text: "Рабочее", style: "tableHeader", alignment: "right" },
              { text: "Полётное время", style: "tableHeader", alignment: "right" },
              { text: "Из них инструктором", style: "tableHeader", alignment: "right" },
              { text: "Из них ночь", style: "tableHeader", alignment: "right" },
              { text: "Примечание", style: "tableHeader" },
            ],
            ...rows,
            totalRow,
          ],
        },
        layout: "lightHorizontalLines",
      },
      { text: "Каждая фактическая полётная смена выводится отдельной строкой. РС — разделение полётной смены на части; знак «+» означает наличие разделения. При отсутствии фактической записи используется месячный план, а полностью незаполненный день отмечается как выходной.", style: "note", margin: [0, 10, 0, 0] },
    ],
    pageBreak: pageBreak ? "before" : undefined,
  };
}

function plannedEmploymentFallback(
  people: FlightReportPerson[],
  dates: string[],
  actualShifts: FlightReportShift[],
  assignments: EmploymentPlanAssignment[],
  busyEntries: EmploymentPlanBusyEntry[],
): FlightReportShift[] {
  const actualDates = new Set(actualShifts.map((shift) => `${shift.personId}\u0001${shift.date}`));
  return people.flatMap((person) => dates.flatMap((date) => {
    if (actualDates.has(`${person.id}\u0001${date}`)) return [];
    const busy = busyEntries.find((entry) =>
      entry.personId === person.id && date >= entry.dateFrom && date <= entry.dateTo);
    if (busy) {
      return [{
        id: `plan-busy-${busy.id ?? busy.activity}-${person.id}-${date}`,
        personId: person.id,
        date,
        activity: busy.activity,
        workMinutes: 0,
        note: busy.note?.trim() || `${planBusyLabels[busy.activity as keyof typeof planBusyLabels] ?? busy.activity} · месячный план`,
        segments: [],
      }];
    }
    const dayAssignments = assignments.filter((assignment) =>
      assignment.personId === person.id && assignment.date === date);
    if (dayAssignments.length) {
      return dayAssignments.map((assignment) => {
        const activity = assignment.activity === "standby" ? "standby" : "flight";
        const aircraftType = aircraftTypeForNumber(assignment.aircraft, aircraftNumbersByType);
        return {
          id: `plan-assignment-${assignment.id ?? assignment.aircraft}-${person.id}-${date}`,
          personId: person.id,
          date,
          activity,
          workMinutes: 0,
          note: `Месячный план · ${assignment.aircraft} · ${planRoleLabels[assignment.role]}`,
          segments: activity === "flight" ? [{
            id: `plan-segment-${assignment.id ?? assignment.aircraft}-${date}`,
            aircraft: assignment.aircraft,
            aircraftType,
            seat: planRoleLabels[assignment.role],
            purpose: "План",
            flightMinutes: 0,
            nightMinutes: 0,
          }] : [],
        };
      });
    }
    return [{
      id: `automatic-dayoff-${person.id}-${date}`,
      personId: person.id,
      date,
      activity: "dayoff",
      workMinutes: 0,
      note: "Автоматически: в месячном плане нет назначения или иной занятости",
      segments: [],
    }];
  }));
}

export function buildEmploymentReport(
  dateFrom: string,
  dateTo: string,
  people: FlightReportPerson[],
  shifts: FlightReportShift[],
  personId: string | null = null,
  logoDataUrl?: string,
  assignments: EmploymentPlanAssignment[] = [],
  busyEntries: EmploymentPlanBusyEntry[] = [],
): TDocumentDefinitions {
  const periodShifts = shifts.filter((shift) => shift.date >= dateFrom && shift.date <= dateTo);
  const peopleWithEntries = new Set(periodShifts.map((shift) => shift.personId));
  const includedPeople = people
    .filter((person) => personId ? person.id === personId : person.active || peopleWithEntries.has(person.id))
    .sort((left, right) => left.name.localeCompare(right.name, "ru-RU"));
  const dates = datesBetween(dateFrom, dateTo);
  const reportShifts = [
    ...periodShifts,
    ...plannedEmploymentFallback(includedPeople, dates, periodShifts, assignments, busyEntries),
  ];
  const content: Content[] = reportHeader("Отчёт о занятости", dateFrom, dateTo, logoDataUrl);
  if (!includedPeople.length) content.push({ text: "В составе нет сотрудников для формирования отчёта.", style: "empty" });
  includedPeople.forEach((person, index) => content.push(employmentPersonSection(person, dates, reportShifts, index > 0)));

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [36, 42, 36, 38],
    info: {
      title: `Отчёт о занятости за ${periodLabel(dateFrom, dateTo)}`,
      author: "ШТАБ ЛС - Центр авиации «Солярис»",
      subject: personId ? "Отчёт о занятости сотрудника" : "Отчёт о занятости всего состава",
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

async function getReportLogo(): Promise<string | undefined> {
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

export async function downloadFlightReport(
  dateFrom: string,
  dateTo: string,
  people: FlightReportPerson[],
  shifts: FlightReportShift[],
  personId: string | null = null,
) {
  const [pdfMake, logoDataUrl] = await Promise.all([getPdfMake(), getReportLogo()]);
  const scope = personId ? "pilot" : "all";
  pdfMake.createPdf(buildFlightReport(dateFrom, dateTo, people, shifts, personId, logoDataUrl)).download(`nalet-${dateFrom}-${dateTo}-${scope}.pdf`);
}

export async function downloadEmploymentReport(
  dateFrom: string,
  dateTo: string,
  people: FlightReportPerson[],
  shifts: FlightReportShift[],
  personId: string | null = null,
  assignments: EmploymentPlanAssignment[] = [],
  busyEntries: EmploymentPlanBusyEntry[] = [],
) {
  const [pdfMake, logoDataUrl] = await Promise.all([getPdfMake(), getReportLogo()]);
  const scope = personId ? "pilot" : "all";
  pdfMake.createPdf(buildEmploymentReport(dateFrom, dateTo, people, shifts, personId, logoDataUrl, assignments, busyEntries)).download(`mesyachnyy-otchet-${dateFrom}-${dateTo}-${scope}.pdf`);
}

export async function downloadSummaryFlightReport(
  dateFrom: string,
  dateTo: string,
  people: FlightReportPerson[],
  shifts: FlightReportShift[],
  personId: string | null = null,
) {
  const [pdfMake, logoDataUrl] = await Promise.all([getPdfMake(), getReportLogo()]);
  const scope = personId ? "pilot" : "all";
  pdfMake.createPdf(buildSummaryFlightReport(dateFrom, dateTo, people, shifts, personId, logoDataUrl))
    .download(`itogovaya-spravka-nalet-${dateFrom}-${dateTo}-${scope}.pdf`);
}
