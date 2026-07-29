import type { FlightBookBaselineRow } from "./flight-book-rules.ts";
import { canonicalAircraftType } from "./aircraft-rules.ts";

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
  format: "summary" | "monthly";
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

const monthIndexes: Record<string, number> = {
  январь: 0, февраль: 1, март: 2, апрель: 3, май: 4, июнь: 5,
  июль: 6, август: 7, сентябрь: 8, октябрь: 9, ноябрь: 10, декабрь: 11,
};

function normalizedAircraftType(value: unknown): string {
  const source = text(value).replace(/\s+/g, "").toUpperCase()
    .replace(/[ВB][ОO]105/, "BO105");
  if (source === "AS350") return "AS350";
  if (source === "EC130") return "EC130";
  if (source === "BO105") return "BO105";
  return canonicalAircraftType(text(value));
}

function lastDayOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month + 1, 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function parseMonthlyFlightBookImport(
  rows: unknown[][],
  sourceFile: string,
  allowedAircraftTypes: string[],
  siteFlightStartDate: string,
): FlightBookImportPreview {
  const issues: FlightBookImportIssue[] = [];
  const totals = new Map<string, FlightBookBaselineRow>();
  const years = [0, 0, 0, 0];
  let latestYear = 0;
  let latestMonth = -1;
  let recognizedRows = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    for (let block = 0; block < 4; block += 1) {
      const offset = block * 6;
      const first = text(row[offset]);
      const yearMatch = /(20\d{2})/.exec(first);
      if (yearMatch && !monthIndexes[normalized(first)]) {
        years[block] = Number(yearMatch[1]);
        continue;
      }
      const month = monthIndexes[normalized(first)];
      if (month === undefined || !years[block]) continue;
      const monthEnd = lastDayOfMonth(years[block], month);
      if (siteFlightStartDate && monthEnd >= siteFlightStartDate) continue;
      const aircraftType = normalizedAircraftType(row[offset + 1]);
      const flightMinutes = importDurationMinutes(row[offset + 2]);
      const nightMinutes = importDurationMinutes(row[offset + 3]);
      const seat = normalized(row[offset + 5]);
      if (!aircraftType || !flightMinutes) continue;
      recognizedRows += 1;
      if (years[block] > latestYear) {
        latestYear = years[block];
        latestMonth = month;
      } else if (years[block] === latestYear) {
        latestMonth = Math.max(latestMonth, month);
      }
      const current = totals.get(aircraftType) ?? {
        id: `import-monthly-${aircraftType}`,
        aircraftType,
        totalMinutes: 0,
        picMinutes: 0,
        secondPilotMinutes: 0,
        instructorMinutes: 0,
        nightMinutes: 0,
        ifrMinutes: 0,
        ifrApproaches: 0,
        note: "",
      };
      current.totalMinutes += flightMinutes;
      current.nightMinutes += nightMinutes;
      if (/^квс$|командир/.test(seat)) current.picMinutes += flightMinutes;
      else if (/^пи$|инструктор/.test(seat)) current.instructorMinutes += flightMinutes;
      else if (/2п|2-й|второй/.test(seat)) current.secondPilotMinutes += flightMinutes;
      else issues.push({ level: "warning", row: rowIndex + 1, message: `Не распознано кресло «${text(row[offset + 5])}» для ${aircraftType}. Налёт включён только в общий.` });
      if (nightMinutes > flightMinutes) issues.push({ level: "error", row: rowIndex + 1, message: `Ночной налёт больше общего налёта в строке ${aircraftType}.` });
      totals.set(aircraftType, current);
    }
  }
  const parsed = [...totals.values()].sort((left, right) => left.aircraftType.localeCompare(right.aircraftType, "ru-RU"));
  parsed.forEach((item) => {
    if (allowedAircraftTypes.length && !allowedAircraftTypes.some((allowed) => normalizedAircraftType(allowed) === item.aircraftType)) {
      issues.push({ level: "warning", row: 0, message: `Тип ВС «${item.aircraftType}» отсутствует в допусках сотрудника.` });
    }
    const seats = item.picMinutes + item.secondPilotMinutes + item.instructorMinutes;
    if (seats !== item.totalMinutes) issues.push({ level: "warning", row: 0, message: `По типу ${item.aircraftType} по креслам распознано ${seats} мин. из ${item.totalMinutes} мин.` });
  });
  if (!recognizedRows) issues.push({ level: "error", row: 0, message: "В помесячной таблице не найдено строк налёта." });
  return {
    date: latestYear && latestMonth >= 0 ? lastDayOfMonth(latestYear, latestMonth) : "",
    source: sourceFile,
    rows: parsed,
    issues,
    headerRow: rows.findIndex((row) => row.some((value) => normalized(value) === "месяц")),
    format: "monthly",
  };
}

export function parseFlightBookImport(
  rows: unknown[][],
  sourceFile: string,
  allowedAircraftTypes: string[] = [],
  siteFlightStartDate = "2026-07-01",
): FlightBookImportPreview {
  const isMonthly = rows.some((row) => {
    const values = row.map(normalized);
    return values.includes("месяц")
      && values.includes("тип вс")
      && values.includes("налет")
      && values.some((value) => /в качестве кого/.test(value));
  });
  if (isMonthly) return parseMonthlyFlightBookImport(rows, sourceFile, allowedAircraftTypes, siteFlightStartDate);
  const headerRow = rows.findIndex((row) => {
    const values = row.map(normalized);
    return values.some((value) => aliases.aircraftType.test(value))
      && values.some((value) => aliases.totalMinutes.test(value));
  });
  const issues: FlightBookImportIssue[] = [];
  if (headerRow < 0) return { date: "", source: sourceFile, rows: [], headerRow, format: "summary", issues: [{ level: "error", row: 0, message: "Не найдена строка заголовков с колонками «Тип ВС» и «Общий»." }] };
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
    const aircraftType = normalizedAircraftType(row[columns.aircraftType]);
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
  return { date, source: sourceFile, rows: parsed, issues, headerRow, format: "summary" };
}
