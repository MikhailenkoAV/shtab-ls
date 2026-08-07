import type { TDocumentDefinitions } from "pdfmake/interfaces";

export type AnalyticsReportPayload = {
  from: string;
  to: string;
  totalFlight: number;
  flightShifts: number;
  training: number;
  warnings: number;
  rows: { name: string; shifts: number; work: number; flight: number; night: number }[];
};

const duration = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
const date = (value: string) => new Intl.DateTimeFormat("ru-RU").format(new Date(`${value}T12:00:00`));

export function buildAnalyticsReport(payload: AnalyticsReportPayload, logo?: string): TDocumentDefinitions {
  const summary = [
    ["Налёт", duration(payload.totalFlight)],
    ["Полётные смены", String(payload.flightShifts)],
    ["Подготовка", String(payload.training)],
    ["Требует внимания", String(payload.warnings)],
  ];
  const body = [
    ["Сотрудник", "Смены", "Рабочее время", "Налёт", "Ночь"],
    ...payload.rows.map((row) => [row.name, String(row.shifts), duration(row.work), duration(row.flight), duration(row.night)]),
    ["ИТОГО", String(payload.rows.reduce((sum, row) => sum + row.shifts, 0)), duration(payload.rows.reduce((sum, row) => sum + row.work, 0)), duration(payload.totalFlight), duration(payload.rows.reduce((sum, row) => sum + row.night, 0))],
  ];
  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [34, 32, 34, 34],
    info: { title: `Управленческая сводка ${payload.from}–${payload.to}`, author: "ШТАБ ЛС — Центр авиации «Солярис»" },
    content: [
      { columns: [{ width: "*", stack: [{ text: "УПРАВЛЕНЧЕСКАЯ СВОДКА", style: "title" }, { text: `за период с ${date(payload.from)} по ${date(payload.to)}`, style: "period" }] }, ...(logo ? [{ image: logo, width: 155, alignment: "right" as const }] : [])], margin: [0, 0, 0, 18] },
      { table: { widths: ["*", "*", "*", "*"], body: [summary.map(([label]) => ({ text: label, style: "metricLabel" })), summary.map(([, value]) => ({ text: value, style: "metricValue" }))] }, layout: { fillColor: (rowIndex: number) => rowIndex === 0 ? "#EAF3F4" : "#FFFFFF", hLineColor: () => "#C9D8DD", vLineColor: () => "#C9D8DD" }, margin: [0, 0, 0, 18] },
      { text: "Рабочее и полётное время сотрудников", style: "section" },
      { table: { headerRows: 1, widths: ["*", 62, 92, 78, 78], body }, layout: { fillColor: (rowIndex: number) => rowIndex === 0 ? "#173B4F" : rowIndex === body.length - 1 ? "#EAF3F4" : rowIndex % 2 ? "#FFFFFF" : "#F7F9FA", hLineColor: () => "#D9E3E7", vLineColor: () => "#D9E3E7" } },
    ],
    footer: (currentPage, pageCount) => ({ columns: [{ text: `Сформировано: ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(new Date())}`, color: "#71828C" }, { text: `${currentPage} / ${pageCount}`, alignment: "right", color: "#71828C" }], margin: [34, 8, 34, 0], fontSize: 8 }),
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#334B59" },
    styles: {
      title: { fontSize: 17, bold: true, color: "#173B4F" },
      period: { margin: [0, 5, 0, 0], fontSize: 10, color: "#687985" },
      section: { margin: [0, 0, 0, 8], fontSize: 11, bold: true, color: "#173B4F" },
      metricLabel: { margin: [7, 5, 7, 3], bold: true, color: "#526B78", alignment: "center" },
      metricValue: { margin: [7, 6, 7, 6], fontSize: 15, bold: true, color: "#173B4F", alignment: "center" },
    },
  };
}

async function imageDataUrl(path: string): Promise<string | undefined> {
  try {
    const response = await fetch(new URL(path, window.location.href).toString());
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
  } catch { return undefined; }
}

export async function downloadAnalyticsReport(payload: AnalyticsReportPayload): Promise<void> {
  const [pdfMakeModule, fontModule, logo] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
    imageDataUrl("solaris-logo.png"),
  ]);
  const pdfMakePackage = pdfMakeModule as unknown as { default?: typeof pdfMakeModule };
  const fontPackage = fontModule as unknown as { default?: Record<string, string>; vfs?: Record<string, string> };
  const pdfMake = (pdfMakePackage.default ?? pdfMakeModule) as typeof pdfMakeModule;
  pdfMake.vfs = fontPackage.default ?? fontPackage.vfs ?? {};
  pdfMake.createPdf(buildAnalyticsReport(payload, logo)).download(`analitika-${payload.from}-${payload.to}.pdf`);
}
