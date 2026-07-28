"use client";

import type { TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import type { FlightBookTypeTotal } from "./flight-book-rules";

function displayMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function displayDate(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

async function logoDataUrl(): Promise<string | null> {
  try {
    const response = await fetch(new URL("solaris-logo.png", window.location.href).pathname);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function buildPersonalFlightPdf(
  personName: string,
  rows: FlightBookTypeTotal[],
  totalMinutes: number,
  asOf: Date,
  logo: string | null = null,
): TDocumentDefinitions {
  const visibleRows = rows.filter((row) => row.totalMinutes > 0);
  const regularMargin: [number, number, number, number] = [5, 6, 5, 6];
  const tableBody: TableCell[][] = [
    [
      { text: "Тип ВС", bold: true, color: "#ffffff", fillColor: "#31586d", margin: regularMargin },
      { text: "Налёт", bold: true, color: "#ffffff", fillColor: "#31586d", alignment: "right", margin: regularMargin },
    ],
    ...(visibleRows.length
      ? visibleRows.map((row): TableCell[] => [
        { text: row.aircraftType, margin: regularMargin },
        { text: displayMinutes(row.totalMinutes), alignment: "right", bold: true, margin: regularMargin },
      ])
      : [[
        { text: "Налёт по типам ВС не внесён", colSpan: 2, color: "#7a8c94", italics: true, margin: [5, 8, 5, 8] as [number, number, number, number] },
        { text: "" },
      ]]),
    [
      { text: "ИТОГО", bold: true, fillColor: "#e6f1f0", margin: [5, 7, 5, 7] as [number, number, number, number] },
      { text: displayMinutes(totalMinutes), alignment: "right", bold: true, fillColor: "#e6f1f0", margin: [5, 7, 5, 7] as [number, number, number, number] },
    ],
  ];
  return {
    pageSize: "A4",
    pageMargins: [46, 46, 46, 42],
    info: {
      title: `Сведения о налёте - ${personName}`,
      author: "ШТАБ ЛС - АО ЦА «Солярис»",
      subject: "Сведения о суммарном налёте пилота",
    },
    content: [
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "ЛИЧНОЕ ДЕЛО", color: "#0f756c", bold: true, fontSize: 9, characterSpacing: 1.2 },
              { text: "Сведения о налёте пилота", bold: true, fontSize: 18, color: "#17384b", margin: [0, 5, 0, 3] },
              { text: personName, fontSize: 12, color: "#405d6b" },
            ],
          },
          logo
            ? { width: 150, image: logo, fit: [145, 42], alignment: "right" }
            : { width: 150, text: "СОЛЯРИС\nЦЕНТР АВИАЦИИ", alignment: "right", bold: true, color: "#17384b", fontSize: 10 },
        ],
        margin: [0, 0, 0, 22],
      },
      {
        columns: [
          { text: `По состоянию на ${displayDate(asOf)}`, color: "#657b86", fontSize: 9 },
          { text: `Общий налёт: ${displayMinutes(totalMinutes)}`, alignment: "right", bold: true, color: "#17384b", fontSize: 11 },
        ],
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          headerRows: 1,
          widths: ["*", 110],
          body: tableBody,
        },
        layout: {
          hLineColor: () => "#cbd9dd",
          vLineColor: () => "#cbd9dd",
          hLineWidth: () => 0.7,
          vLineWidth: () => 0.7,
        },
      },
      {
        text: "Справка сформирована по актуальным данным личного дела и единого журнала полётных смен.",
        margin: [0, 16, 0, 0],
        color: "#71858e",
        fontSize: 8,
        italics: true,
      },
    ],
    defaultStyle: {
      font: "Roboto",
      fontSize: 9,
      color: "#334b59",
      lineHeight: 1.18,
    },
  };
}

export async function downloadPersonalFlightPdf(
  personName: string,
  rows: FlightBookTypeTotal[],
  totalMinutes: number,
): Promise<void> {
  const [pdfMakeModule, fontModule, logo] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
    logoDataUrl(),
  ]);
  const pdfMakePackage = pdfMakeModule as unknown as { default?: typeof pdfMakeModule };
  const fontPackage = fontModule as unknown as { default?: Record<string, string>; vfs?: Record<string, string> };
  const pdfMake = (pdfMakePackage.default ?? pdfMakeModule) as typeof pdfMakeModule;
  pdfMake.vfs = fontPackage.default ?? fontPackage.vfs ?? {};
  const safeName = personName.replace(/[<>:"/\\|?*]+/g, " ").trim().replace(/\s+/g, "_");
  pdfMake.createPdf(buildPersonalFlightPdf(personName, rows, totalMinutes, new Date(), logo))
    .download(`Личное_дело_${safeName}.pdf`);
}
