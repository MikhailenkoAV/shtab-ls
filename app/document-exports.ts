"use client";

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import {
  DocumentPersonProfile,
  safeFilePart,
  splitPersonName,
} from "./documentation-rules";

export type DocumentCertificationRef = {
  category: string;
  certificationType: string;
  aircraftType: string;
  organization: string;
  issuedDate: string;
  startDate: string;
  endDate: string;
  documentType: string;
  number: string;
  grade: string;
};

export type PilotAppendixPayload = {
  personName: string;
  profile: DocumentPersonProfile;
  issueDate: string;
  operator: string;
  signatory: string;
  certifications: DocumentCertificationRef[];
};

export type TrainingRequestRow = {
  personName: string;
  birthDate: string;
  aircraftType: string;
  position: string;
  snils: string;
  educationDocument: string;
  educationQualification: string;
  educationLevel: string;
  passport: string;
};

export type TrainingRequestPayload = {
  requestDate: string;
  trainingCenterName: string;
  trainingCenterHead: string;
  programName: string;
  hours: string;
  dateFrom: string;
  dateTo: string;
  senderTitle: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  companyName: string;
  rows: TrainingRequestRow[];
};

export type QualificationCheckPayload = {
  personName: string;
  licenceKind: string;
  licenceNumber: string;
  aircraftType: string;
  aircraftNumber: string;
  flightTime: string;
  landings: string;
  checkDate: string;
  checkPlace: string;
  result: string;
  examinerName: string;
  examinerLicence: string;
};

function displayDate(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ru-RU").format(date);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function logoParagraph(): Promise<Paragraph> {
  try {
    const response = await fetch(new URL("solaris-logo.png", window.location.href).pathname);
    if (!response.ok) throw new Error("logo");
    const bytes = new Uint8Array(await response.arrayBuffer());
    return new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new ImageRun({ data: bytes, type: "png", transformation: { width: 165, height: 45 } })],
      spacing: { after: 160 },
    });
  } catch {
    return new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: "СОЛЯРИС · ЦЕНТР АВИАЦИИ", bold: true, color: "18384B", size: 20 })],
      spacing: { after: 160 },
    });
  }
}

const borders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "9FB1BA" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "9FB1BA" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "9FB1BA" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "9FB1BA" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "D4DEE2" },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "D4DEE2" },
};

function cell(text: string, bold = false, width?: number): TableCell {
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 90, right: 90 },
    children: [new Paragraph({ children: [new TextRun({ text: text || " ", bold, size: 18 })] })],
  });
}

function detailsTable(rows: Array<[string, string]>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: rows.map(([label, value]) => new TableRow({ children: [cell(label, true, 2500), cell(value)] })),
  });
}

function qualificationTable(title: string, records: DocumentCertificationRef[]): (Paragraph | Table)[] {
  return [
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 280, after: 100 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders,
      rows: [
        new TableRow({ tableHeader: true, children: [
          cell("Тип ВС / отметка", true),
          cell("Дата", true),
          cell("Документ / номер", true),
          cell("Организация / результат", true),
        ] }),
        ...(records.length ? records : [{ aircraftType: "", certificationType: "", issuedDate: "", startDate: "", endDate: "", documentType: "", number: "", organization: "", grade: "", category: "" }])
          .map((record) => new TableRow({ children: [
            cell(record.aircraftType || record.certificationType || record.category),
            cell(displayDate(record.endDate || record.startDate || record.issuedDate)),
            cell([record.documentType, record.number].filter(Boolean).join(" № ")),
            cell([record.organization, record.grade].filter(Boolean).join(" · ")),
          ] })),
      ],
    }),
  ];
}

export async function downloadPilotAppendixWord(payload: PilotAppendixPayload): Promise<void> {
  const { lastName, firstName, patronymic } = splitPersonName(payload.personName);
  const matches = (pattern: RegExp) => payload.certifications.filter((record) =>
    pattern.test(`${record.category} ${record.certificationType}`.toLocaleLowerCase("ru-RU")));
  const usedIds = new Set<DocumentCertificationRef>();
  const simulator = matches(/тренаж|симулятор/); simulator.forEach((item) => usedIds.add(item));
  const proficiency = matches(/квалиф|провер|экзам/); proficiency.forEach((item) => usedIds.add(item));
  const lowVisibility = matches(/видим|минимум|lvto|cat/); lowVisibility.forEach((item) => usedIds.add(item));
  const special = payload.certifications.filter((item) => !usedIds.has(item));
  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 900, right: 900, bottom: 900, left: 900 } } },
      children: [
        await logoParagraph(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "ПРИЛОЖЕНИЕ К СВИДЕТЕЛЬСТВУ", bold: true, size: 30 }),
            new TextRun({ text: "\nATTACHMENT TO THE LICENCE", bold: true, size: 22, color: "4F6570" }),
          ],
          spacing: { after: 260 },
        }),
        detailsTable([
          ["Фамилия / Last name", lastName],
          ["Имя, отчество / First name", [firstName, patronymic].filter(Boolean).join(" ")],
          ["Вид свидетельства / Licence kind", payload.profile.pilotLicenceKind],
          ["Номер свидетельства / Licence number", payload.profile.pilotLicenceNumber],
          ["Дата оформления / Issue date", displayDate(payload.issueDate)],
          ["Эксплуатант / Operator", payload.operator],
          ["Подписант / Signatory", payload.signatory],
        ]),
        ...qualificationTable("Проверки на тренажёре / Simulator checks", simulator),
        ...qualificationTable("Особые отметки / Special ratings", special),
        ...qualificationTable("Квалификационные проверки / Proficiency checks", proficiency),
        ...qualificationTable("Полёты в условиях ограниченной видимости / Low visibility operations", lowVisibility),
      ],
    }],
  });
  downloadBlob(await Packer.toBlob(doc), `Приложение_к_свидетельству_${safeFilePart(payload.personName)}.docx`);
}

export async function downloadTrainingRequestWord(payload: TrainingRequestPayload): Promise<void> {
  const header = ["№", "Ф. И. О.", "Дата рождения", "Тип ВС", "Должность", "СНИЛС", "Документ об образовании", "Квалификация", "Уровень образования", "Паспорт"];
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { orientation: "landscape" },
          margin: { top: 650, right: 560, bottom: 650, left: 560 },
        },
      },
      children: [
        await logoParagraph(),
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [
          new TextRun({ text: `${payload.trainingCenterHead}\n`, bold: true, size: 20 }),
          new TextRun({ text: payload.trainingCenterName, size: 20 }),
        ] }),
        new Paragraph({
          text: "ЗАЯВКА НА ОБУЧЕНИЕ ПЕРСОНАЛА",
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { before: 260, after: 220 },
        }),
        detailsTable([
          ["Дата заявки", displayDate(payload.requestDate)],
          ["Программа обучения", payload.programName],
          ["Объём", payload.hours ? `${payload.hours} ч` : ""],
          ["Период обучения", `${displayDate(payload.dateFrom)} — ${displayDate(payload.dateTo)}`],
          ["Предприятие", payload.companyName],
        ]),
        new Paragraph({ text: "Список работников", heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 100 } }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders,
          rows: [
            new TableRow({ tableHeader: true, children: header.map((value) => cell(value, true)) }),
            ...payload.rows.map((row, index) => new TableRow({ children: [
              cell(String(index + 1)),
              cell(row.personName),
              cell(displayDate(row.birthDate)),
              cell(row.aircraftType),
              cell(row.position),
              cell(row.snils),
              cell(row.educationDocument),
              cell(row.educationQualification),
              cell(row.educationLevel),
              cell(row.passport),
            ] })),
          ],
        }),
        new Paragraph({ spacing: { before: 260 }, children: [
          new TextRun({ text: `${payload.senderTitle}: `, bold: true }),
          new TextRun({ text: payload.senderName }),
        ] }),
        new Paragraph({ children: [new TextRun({ text: `E-mail: ${payload.senderEmail} · Телефон: ${payload.senderPhone}`, size: 19 })] }),
        new Paragraph({ spacing: { before: 220 }, children: [new TextRun({
          text: "Перед направлением приложите требуемые АУЦ копии документов работников.",
          italics: true,
          color: "5F7079",
          size: 18,
        })] }),
      ],
    }],
  });
  downloadBlob(await Packer.toBlob(doc), `Заявка_в_АУЦ_${safeFilePart(payload.programName || payload.requestDate)}.docx`);
}

export async function downloadQualificationCheckExcel(payload: QualificationCheckPayload): Promise<void> {
  const XLSX = await import("xlsx-js-style");
  const rows = [
    ["СПРАВКА", "", "", ""],
    ["о прохождении проверки навыков в полёте", "", "", ""],
    ["Ф. И. О.", payload.personName, "Дата проверки", displayDate(payload.checkDate)],
    ["Свидетельство", `${payload.licenceKind} № ${payload.licenceNumber}`.trim(), "Место", payload.checkPlace],
    ["Тип ВС", payload.aircraftType, "Бортовой номер", payload.aircraftNumber],
    ["Полётное время", payload.flightTime, "Количество посадок", payload.landings],
    ["Результат", payload.result, "", ""],
    ["Проверяющий", payload.examinerName, "№ свидетельства", payload.examinerLicence],
    ["Подпись", "", "", ""],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    { s: { r: 6, c: 1 }, e: { r: 6, c: 3 } },
  ];
  sheet["!cols"] = [{ wch: 22 }, { wch: 34 }, { wch: 22 }, { wch: 28 }];
  sheet["!rows"] = rows.map((_, index) => ({ hpt: index < 2 ? 24 : 22 }));
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:D9");
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const item = sheet[address] ?? { t: "s", v: "" };
      item.s = {
        font: { name: "Arial", sz: row < 2 ? 13 : 10, bold: row === 0 || column % 2 === 0 },
        alignment: { vertical: "center", horizontal: row < 2 ? "center" : "left", wrapText: true },
        border: row >= 2 ? {
          top: { style: "thin", color: { rgb: "8EA3AE" } },
          bottom: { style: "thin", color: { rgb: "8EA3AE" } },
          left: { style: "thin", color: { rgb: "8EA3AE" } },
          right: { style: "thin", color: { rgb: "8EA3AE" } },
        } : undefined,
        fill: column % 2 === 0 && row >= 2 ? { fgColor: { rgb: "EAF3F2" } } : undefined,
      };
      sheet[address] = item;
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Вкладыш");
  XLSX.writeFile(workbook, `Вкладыш_квалификационной_проверки_${safeFilePart(payload.personName)}.xlsx`);
}
