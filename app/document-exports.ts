"use client";

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { safeFilePart, splitPersonName } from "./documentation-rules.ts";
import type { DocumentPersonProfile } from "./documentation-rules.ts";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import JSZip from "jszip";
import { AUC_TRAINING_TEMPLATE_BASE64 } from "./auc-training-template-data.ts";

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
  examinerRole: string;
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
  const page = { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } }, type: SectionType.NEXT_PAGE };
  const appendixTitle = (ru: string, en: string) => new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: ru, bold: true, size: 24 }),
      new TextRun({ text: `\n${en}`, bold: true, size: 17, color: "4F6570" }),
    ],
    spacing: { after: 180 },
  });
  const doc = new Document({
    sections: [
      {
        properties: page,
        children: [
          appendixTitle("ПРОВЕРКИ НА ТРЕНАЖЁРЕ", "SIMULATOR CHECKS"),
          ...qualificationTable("Тренажёрная подготовка / Simulator training", simulator),
          ...qualificationTable("Специальная подготовка и допуски / Special training and ratings", special),
          new Paragraph({
            spacing: { before: 260 },
            children: [
              new TextRun({ text: "Подпись уполномоченного лица / Authorized signature: ", bold: true, size: 18 }),
              new TextRun({ text: payload.signatory || "____________________", size: 18 }),
            ],
          }),
        ],
      },
      {
        properties: page,
        children: [
          await logoParagraph(),
          appendixTitle("ПРИЛОЖЕНИЕ К СВИДЕТЕЛЬСТВУ", "ATTACHMENT TO THE LICENCE"),
          detailsTable([
            ["Фамилия / Last name", lastName],
            ["Имя / First name", firstName],
            ["Отчество / Patronymic", patronymic],
            ["Вид свидетельства / Licence kind", payload.profile.pilotLicenceKind],
            ["Номер свидетельства / Licence number", payload.profile.pilotLicenceNumber],
            ["Дата оформления / Issue date", displayDate(payload.issueDate)],
            ["Эксплуатант / Operator", payload.operator],
          ]),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 520, after: 180 },
            children: [new TextRun({ text: "Настоящее приложение действительно только вместе со свидетельством.", italics: true, size: 18 })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Подписант / Signatory\n", bold: true, size: 18 }),
              new TextRun({ text: payload.signatory || "____________________", size: 20 }),
            ],
          }),
        ],
      },
      {
        properties: page,
        children: [
          appendixTitle("КВАЛИФИКАЦИОННЫЕ ПРОВЕРКИ", "PROFICIENCY CHECKS"),
          ...qualificationTable("Квалификационные проверки / Proficiency checks", proficiency),
          ...qualificationTable("Допуски к полётам в условиях ограниченной видимости / Low visibility operations", lowVisibility),
          new Paragraph({
            spacing: { before: 260 },
            children: [
              new TextRun({ text: "Номер свидетельства / Licence number: ", bold: true, size: 18 }),
              new TextRun({ text: payload.profile.pilotLicenceNumber || "____________________", size: 18 }),
            ],
          }),
        ],
      },
    ],
  });
  downloadBlob(await Packer.toBlob(doc), `Приложение_к_свидетельству_${safeFilePart(payload.personName)}.docx`);
}

async function downloadTrainingRequestWordLegacy(payload: TrainingRequestPayload): Promise<void> {
  let logo: Paragraph;
  try {
    const response = await fetch(new URL("solaris-logo.png", window.location.href).pathname);
    const bytes = new Uint8Array(await response.arrayBuffer());
    logo = new Paragraph({ children: [new ImageRun({ data: bytes, type: "png", transformation: { width: 158, height: 45 } })] });
  } catch {
    logo = new Paragraph({ children: [new TextRun({ text: "СОЛЯРИС\nЦЕНТР АВИАЦИИ", bold: true, size: 18 })] });
  }
  const blackBorders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  };
  const requestCell = (text: string, bold = false, width?: number) => new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 55, bottom: 55, left: 55, right: 55 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: text || " ", bold, size: 15 })],
    })],
  });
  const personHeader = ["№ п/п", "Фамилия Имя Отчество", "Дата рождения", "Тип ВС", "Должность", "СНИЛС", "Серия/номер документа о ВО/СПО", "Наименование квалификации, профессии, специальности", "Уровень образования ВО/СПО", "Серия/номер паспорта"];
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Trebuchet MS", size: 22 } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { orientation: "landscape", width: 11906, height: 16838 },
          margin: { top: 1100, right: 1134, bottom: 850, left: 1134 },
        },
      },
      children: [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
            insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
          },
          rows: [new TableRow({ children: [
            new TableCell({ width: { size: 55, type: WidthType.PERCENTAGE }, children: [logo] }),
            new TableCell({ width: { size: 45, type: WidthType.PERCENTAGE }, children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Начальнику АУЦ", bold: true, size: 22, font: "Trebuchet MS" })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: payload.trainingCenterName || "АО ЦА «Солярис»", bold: true, size: 22, font: "Trebuchet MS" })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: payload.trainingCenterHead || "Бакпоков С.В.", bold: true, size: 22, font: "Trebuchet MS" })] }),
            ] }),
          ] })],
        }),
        new Paragraph({ spacing: { before: 70 }, children: [new TextRun({ text: `Дата: ${displayDate(payload.requestDate)}`, size: 22, font: "Trebuchet MS" })] }),
        new Paragraph({
          children: [new TextRun({ text: "Заявка на обучение персонала", bold: true, size: 30, font: "Trebuchet MS" })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 500, after: 180 },
        }),
        new Paragraph({ children: [new TextRun({ text: "Просим Вас провести обучение наших сотрудников", size: 22, font: "Trebuchet MS" })], spacing: { after: 130 } }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
            insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
          },
          rows: [
            new TableRow({ children: [
              new TableCell({ width: { size: 1350, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: "Наименование\nпрограммы:", size: 16, font: "Trebuchet MS" })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: payload.programName, bold: true, size: 16, font: "Trebuchet MS" })] })] }),
            ] }),
            new TableRow({ children: [
              new TableCell({ width: { size: 1350, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: "Количество часов:", size: 16, font: "Trebuchet MS" })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: payload.hours, size: 16, font: "Trebuchet MS" })] })] }),
            ] }),
            new TableRow({ children: [
              new TableCell({ width: { size: 1350, type: WidthType.DXA }, children: [new Paragraph({ children: [new TextRun({ text: "В период\nс", size: 16, font: "Trebuchet MS" })] })] }),
              new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${displayDate(payload.dateFrom)}     по     ${displayDate(payload.dateTo)}`, size: 16, font: "Trebuchet MS" })] })] }),
            ] }),
          ],
        }),
        new Paragraph({ spacing: { after: 1500 } }),
        new Paragraph({ children: [new TextRun({ text: "Список сотрудников прилагается:", size: 20 })], spacing: { after: 90 } }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: blackBorders,
          rows: [
            new TableRow({ tableHeader: true, children: personHeader.map((value) => requestCell(value, true)) }),
            ...payload.rows.map((row, index) => new TableRow({ children: [
              requestCell(String(index + 1)),
              requestCell(row.personName),
              requestCell(displayDate(row.birthDate)),
              requestCell(row.aircraftType),
              requestCell(row.position),
              requestCell(row.snils),
              requestCell(row.educationDocument),
              requestCell(row.educationQualification),
              requestCell(row.educationLevel),
              requestCell(row.passport),
            ] })),
          ],
        }),
        new Paragraph({ children: [new TextRun({ text: "Форма оплаты:", size: 22, font: "Trebuchet MS" })], spacing: { before: 120 } }),
        new Paragraph({ indent: { left: 340 }, children: [new TextRun({ text: "1.  Безналичный расчет", size: 22, font: "Trebuchet MS" })], spacing: { after: 110 } }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
            left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
            insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
          },
          rows: [
            new TableRow({ children: [
              new TableCell({ width: { size: 2600, type: WidthType.DXA }, children: [
                new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: payload.senderTitle || "Начальник штаба", bold: true, size: 20, font: "Trebuchet MS" })] }),
                new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "(должность заказчика обучения)", size: 12, font: "Trebuchet MS" })] }),
              ] }),
              new TableCell({ children: [
                new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `____________________    ${payload.senderName}`, bold: true, size: 18, font: "Trebuchet MS" })] }),
                new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "(подпись/Фамилия, инициалы)", size: 12, font: "Trebuchet MS" })] }),
              ] }),
              new TableCell({ width: { size: 900, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "м.п.", size: 18, font: "Trebuchet MS" })] })] }),
            ] }),
            new TableRow({ children: [
              new TableCell({ columnSpan: 2, children: [
                new Paragraph({ children: [new TextRun({ text: "Данные лица, отправившего заявку:", bold: true, size: 18, font: "Trebuchet MS" })] }),
                new Paragraph({ children: [new TextRun({ text: `Фамилия, инициалы: ${payload.senderName}`, size: 16, font: "Trebuchet MS" })] }),
                new Paragraph({ children: [new TextRun({ text: `Эл.почта: ${payload.senderEmail}`, size: 16, font: "Trebuchet MS" })] }),
                new Paragraph({ children: [new TextRun({ text: `Телефон: ${payload.senderPhone}`, size: 16, font: "Trebuchet MS" })] }),
              ] }),
              new TableCell({ width: { size: 900, type: WidthType.DXA }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "м.п.", size: 18, font: "Trebuchet MS" })] })] }),
            ] }),
          ],
        }),
        new Paragraph({ spacing: { before: 80 }, children: [
          new TextRun({ text: "*Перечень документов при поступлении (копии): ", bold: true, size: 13 }),
          new TextRun({ text: "Документ о высшем/среднем-профессиональном образовании (номер, серия, специальность); паспорт; СНИЛС; свидетельство пилота/бортинженера/бортмеханика; документ, подтверждающий прохождение обучения по программе подготовки членов летного экипажа других видов авиации к выполнению полетов на воздушных судах гражданской авиации; Медицинское заключение (если требуется)", size: 13 }),
        ] }),
      ],
    }],
  });
  downloadBlob(await Packer.toBlob(doc), `Заявка_в_АУЦ_${safeFilePart(payload.programName || payload.requestDate)}.docx`);
}

function xmlValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function replaceTemplateToken(xml: string, token: string, value: string): string {
  return xml.split(`{{${token}}}`).join(xmlValue(value));
}

export async function downloadTrainingRequestWord(payload: TrainingRequestPayload): Promise<void> {
  const archive = await JSZip.loadAsync(AUC_TRAINING_TEMPLATE_BASE64, { base64: true });
  const documentFile = archive.file("word/document.xml");
  if (!documentFile) {
    await downloadTrainingRequestWordLegacy(payload);
    return;
  }

  let xml = await documentFile.async("string");
  const staffRowMatch = [...xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
    .find((match) => match[0].includes("{{INDEX}}"));
  if (!staffRowMatch) {
    await downloadTrainingRequestWordLegacy(payload);
    return;
  }

  const staffRows = (payload.rows.length ? payload.rows : [{
    personName: "",
    birthDate: "",
    aircraftType: "",
    position: "",
    snils: "",
    educationDocument: "",
    educationQualification: "",
    educationLevel: "",
    passport: "",
  }]).map((row, index) => {
    let rowXml = staffRowMatch[0];
    const values: Record<string, string> = {
      INDEX: String(index + 1),
      PERSON_NAME: row.personName,
      BIRTH_DATE: displayDate(row.birthDate),
      AIRCRAFT_TYPE: row.aircraftType,
      POSITION: row.position,
      SNILS: row.snils,
      EDUCATION_DOCUMENT: row.educationDocument,
      EDUCATION_QUALIFICATION: row.educationQualification,
      EDUCATION_LEVEL: row.educationLevel,
      PASSPORT: row.passport,
    };
    Object.entries(values).forEach(([token, value]) => {
      rowXml = replaceTemplateToken(rowXml, token, value);
    });
    return rowXml;
  }).join("");
  xml = xml.replace(staffRowMatch[0], staffRows);

  const values: Record<string, string> = {
    REQUEST_DATE: displayDate(payload.requestDate),
    PROGRAM_NAME: payload.programName,
    HOURS: payload.hours,
    DATE_FROM: displayDate(payload.dateFrom),
    DATE_TO: displayDate(payload.dateTo),
    SENDER_TITLE: payload.senderTitle || "Начальник штаба",
    SENDER_NAME: payload.senderName,
    SENDER_SHORT: payload.senderName,
    SENDER_EMAIL: payload.senderEmail,
    SENDER_PHONE: payload.senderPhone,
  };
  Object.entries(values).forEach(([token, value]) => {
    xml = replaceTemplateToken(xml, token, value);
  });
  archive.file("word/document.xml", xml);
  const blob = await archive.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  downloadBlob(blob, `Заявка_в_АУЦ_${safeFilePart(payload.requestDate || "без_даты")}.docx`);
}

export function buildQualificationCheckPdf(payload: QualificationCheckPayload): TDocumentDefinitions {
  const line = (label: string, value: string) => ({
    columns: [
      { width: 80, text: label, color: "#36434a" },
      { width: "*", text: value || " ", bold: true, decoration: "underline" as const },
    ],
    columnGap: 4,
    margin: [0, 2.5, 0, 2.5] as [number, number, number, number],
  });
  return {
    pageSize: { width: 297.64, height: 419.53 },
    pageMargins: [13, 12, 13, 12],
    info: {
      title: `Вкладыш квалификационной проверки — ${payload.personName}`,
      author: "ШТАБ ЛС — АО ЦА «Солярис»",
    },
    content: [
      { text: "КВАЛИФИКАЦИОННАЯ ПРОВЕРКА", alignment: "center", bold: true, fontSize: 9.5, margin: [0, 0, 0, 2] },
      { text: "вкладыш в свидетельство авиационного специалиста", alignment: "center", fontSize: 6.2, color: "#4b555a", margin: [0, 0, 0, 7] },
      line("Фамилия, имя, отчество", payload.personName),
      line("Свидетельство", [payload.licenceKind, payload.licenceNumber && `№ ${payload.licenceNumber}`].filter(Boolean).join(" ")),
      {
        table: {
          widths: [48, "*", 52, "*"],
          body: [
            [
              { text: "Тип ВС", bold: true },
              { text: payload.aircraftType || " " },
              { text: "Бортовой №", bold: true },
              { text: payload.aircraftNumber || " " },
            ],
            [
              { text: "Дата", bold: true },
              { text: displayDate(payload.checkDate) || " " },
              { text: "Место", bold: true },
              { text: payload.checkPlace || " " },
            ],
            [
              { text: "Полётное время", bold: true },
              { text: payload.flightTime || " " },
              { text: "Посадки", bold: true },
              { text: payload.landings || " " },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0.6,
          vLineWidth: () => 0.6,
          hLineColor: () => "#1f2f37",
          vLineColor: () => "#1f2f37",
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 3,
          paddingBottom: () => 3,
        },
        margin: [0, 5, 0, 6],
      },
      { text: "РЕЗУЛЬТАТ ПРОВЕРКИ", bold: true, alignment: "center", fontSize: 7.5, margin: [0, 1, 0, 3] },
      {
        table: {
          widths: ["*"],
          heights: [29],
          body: [[{ text: payload.result || " ", bold: true, alignment: "center", margin: [3, 8, 3, 8] }]],
        },
        layout: {
          hLineWidth: () => 0.7,
          vLineWidth: () => 0.7,
          hLineColor: () => "#1f2f37",
          vLineColor: () => "#1f2f37",
        },
        margin: [0, 0, 0, 6],
      },
      line("Проверяющий", payload.examinerName),
      line("Должность", payload.examinerRole),
      line("№ свидетельства", payload.examinerLicence),
      {
        columns: [
          { width: "*", text: "Подпись проверяющего ____________________", margin: [0, 10, 0, 0] },
          { width: 70, text: "М. П.", alignment: "center", margin: [0, 10, 0, 0] },
        ],
      },
      { text: "Размер страницы: 1/2 формата А5 (105 × 148 мм)", fontSize: 5.2, color: "#6c777c", alignment: "right", margin: [0, 10, 0, 0] },
    ],
    defaultStyle: {
      font: "Roboto",
      fontSize: 6.6,
      color: "#111111",
      lineHeight: 1.05,
    },
  };
}

export async function downloadQualificationCheckPdf(payload: QualificationCheckPayload): Promise<void> {
  const [pdfMakeModule, fontModule] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  const pdfMakePackage = pdfMakeModule as unknown as { default?: typeof pdfMakeModule };
  const fontPackage = fontModule as unknown as { default?: Record<string, string>; vfs?: Record<string, string> };
  const pdfMake = (pdfMakePackage.default ?? pdfMakeModule) as typeof pdfMakeModule;
  pdfMake.vfs = fontPackage.default ?? fontPackage.vfs ?? {};
  pdfMake.createPdf(buildQualificationCheckPdf(payload))
    .download(`Вкладыш_квалификационной_проверки_${safeFilePart(payload.personName)}.pdf`);
}
