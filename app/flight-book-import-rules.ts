import type { FlightBookBaselineRow } from "./flight-book-rules.ts";

export type FlightBookImportIssue = {
  level: "error" | "warning";
  row: number;
  message: string;
};

export type FlightBookImportPreview = {
  date: string;
  source: string;
  rows: FlightBookBaselineRow[];
  issues: FlightBookImportIssue[];
  headerRow: number;
};

const text = (value: unknown) => String(value ?? "").trim();
const normalized = (value: unknown) => text(value).toLocaleLowerCase("ru-RU")
  .replace(/ё/g, "е").replace(/\s+/g, " ");

function isoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && value > 20_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  const ru = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text(value));
  if (ru) return `${ru[3].length === 2 ? `20${ru[3]}` : ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text(value));
  return iso ? `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}` : "";
}

export function importDurationMinutes(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getUTCHours() * 60 + value.getUTCMinutes();
  if (typeof value === "number") {
    if (value >= 0 && value < 1) return Math.round(value * 24 * 60);
    return Math.round(Math.max(0, value) * 60);
  }
  const valueText = text(value).replace(",", ".");
  const duration = /^(\d+)\s*[:ч]\s*(\d{1,2})/.exec(valueText);
  if (duration) return Number(duration[1]) * 60 + Math.min(59, Number(duration[2]));
  const compact = /^(\d{1,4})$/.exec(valueText);
  if (compact) {
    const number = Number(compact[1]);
    return compact[1].length >= 3
      ? Number(compact[1].slice(0, -2)) * 60 + Math.min(59, Number(compact[1].slice(-2)))
      : number * 60;
  }
  const decimal = Number(valueText);
  return Number.isFinite(decimal) ? Math.round(Math.max(0, decimal) * 60) : 0;
}

const aliases: Record<string, RegExp> = {
  aircraftType: /^(тип|тип вс|воздушное судно|вс)$/,
  totalMinutes: /^(общий|общий налет|налет всего|всего|итого)$/,
  picMinutes: /^(квс|командир вс)$/,
  secondPilotMinutes: /^(2п|2-й пилот|второй пилот)$/,
  instructorMinutes: /^(пи|инструктор|пилот-инструктор)$/,
  nightMinutes: /^(ночь|ночной налет|из них ночь)$/,
  ifrMinutes: /^(ппп|налет ппп)$/,
  ifrApproaches: /^(заходы ппп|ппп заходы|заходов ппп)$/,
};

export function parseFlightBookImport(
  rows: unknown[][],
  sourceFile: string,
  allowedAircraftTypes: string[] = [],
): FlightBookImportPreview {
  const headerRow = rows.findIndex((row) => {
    const values = row.map(normalized);
    return values.some((value) => aliases.aircraftType.test(value))
      && values.some((value) => aliases.totalMinutes.test(value));
  });
  const issues: FlightBookImportIssue[] = [];
  if (headerRow < 0) return { date: "", source: sourceFile, rows: [], headerRow, issues: [{ level: "error", row: 0, message: "Не найдена строка заголовков с колонками «Тип ВС» и «Общий»." }] };
  const columns: Record<string, number> = {};
  rows[headerRow].forEach((value, index) => {
    const label = normalized(value);
    Object.entries(aliases).forEach(([key, pattern]) => { if (columns[key] === undefined && pattern.test(label)) columns[key] = index; });
  });
  const date = rows.slice(0, headerRow + 1).flat().map((value) => {
    const direct = isoDate(value);
    if (direct) return direct;
    const match = /(?:по состоянию на|дата контрольной точки)\s*[:\-]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i.exec(text(value));
    return match ? isoDate(match[1]) : "";
  }).find(Boolean) ?? "";
  const parsed: FlightBookBaselineRow[] = [];
  rows.slice(headerRow + 1).forEach((row, offset) => {
    const rowNumber = headerRow + offset + 2;
    const aircraftType = text(row[columns.aircraftType]);
    if (!aircraftType || /всего|итого|все тип/i.test(aircraftType)) return;
    const values = (key: string) => importDurationMinutes(row[columns[key]]);
    const imported: FlightBookBaselineRow = {
      id: `import-${rowNumber}-${aircraftType}`,
      aircraftType,
      totalMinutes: values("totalMinutes"),
      picMinutes: values("picMinutes"),
      secondPilotMinutes: values("secondPilotMinutes"),
      instructorMinutes: values("instructorMinutes"),
      nightMinutes: values("nightMinutes"),
      ifrMinutes: values("ifrMinutes"),
      ifrApproaches: Math.max(0, Math.floor(Number(row[columns.ifrApproaches]) || 0)),
      note: "",
    };
    if (!imported.totalMinutes && !imported.picMinutes && !imported.secondPilotMinutes && !imported.instructorMinutes && !imported.nightMinutes && !imported.ifrMinutes) return;
    if (allowedAircraftTypes.length && !allowedAircraftTypes.some((item) => normalized(item) === normalized(aircraftType))) {
      issues.push({ level: "warning", row: rowNumber, message: `Тип ВС «${aircraftType}» отсутствует в допусках сотрудника.` });
    }
    if (imported.picMinutes + imported.secondPilotMinutes + imported.instructorMinutes > imported.totalMinutes) {
      issues.push({ level: "warning", row: rowNumber, message: "Сумма налёта по креслам больше общего налёта." });
    }
    if (imported.nightMinutes > imported.totalMinutes || imported.ifrMinutes > imported.totalMinutes) {
      issues.push({ level: "error", row: rowNumber, message: "Ночной налёт или ППП больше общего налёта." });
    }
    parsed.push(imported);
  });
  if (!parsed.length) issues.push({ level: "error", row: 0, message: "В таблице не найдено строк с исходным налётом." });
  if (!date) issues.push({ level: "warning", row: 0, message: "Дата контрольной точки не найдена — укажите её перед импортом." });
  return { date, source: sourceFile, rows: parsed, issues, headerRow };
}
