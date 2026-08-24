import { canonicalAircraftType } from "./aircraft-rules.ts";
import { personMatchKey } from "./work-time-import-rules.ts";
import type { WorkTimeImportPerson } from "./work-time-import-rules.ts";

export type FlightTaskLegDraft = {
  id: string;
  flightMinutes: number;
  nightMinutes: number;
  dayLandings: number;
  nightLandings: number;
};

export type FlightTaskDraft = {
  personId: string;
  personText: string;
  date: string;
  dutyStart: string;
  dutyEnd: string;
  aircraftType: string;
  aircraft: string;
  purpose: string;
  seat: "КВС" | "Пилот-инструктор";
  legs: FlightTaskLegDraft[];
  note: string;
};

export type FlightTaskOcrSource = {
  page1: string;
  page2: string;
  fileName?: string;
  hints?: {
    dutyStart?: string;
    dutyEnd?: string;
    totalFlight?: string;
    landings?: string;
    legFlights?: string[];
  };
};

export type FlightTaskOcrResult = {
  draft: FlightTaskDraft;
  warnings: string[];
  recognizedFields: number;
};

const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const clean = (value: string) => value.replace(/[|_]+/g, " ").replace(/\s+/g, " ").trim();

function isoDate(value: string): string {
  for (const match of value.matchAll(/(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{2,4})/g)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return "";
}

export function normalizedClock(value: string): string {
  const match = /(\d{1,2})\s*[.:,]\s*(\d{2})/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

export function durationMinutes(value: string): number {
  const match = /(\d{1,3})\s*[.:,]\s*(\d{2})/.exec(value);
  if (!match || Number(match[2]) > 59) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function aircraftNumber(text: string): string {
  const compact = text.toLocaleUpperCase("ru-RU").replace(/[^A-ZА-Я0-9]/g, "");
  const match = /RA(\d{5})/.exec(compact);
  return match ? `RA-${match[1]}` : "";
}

function aircraftType(text: string, fileName = ""): string {
  const source = `${text} ${fileName}`.toLocaleUpperCase("ru-RU").replace(/[‐‑–—]/g, "-");
  const candidates = [
    /AW\s*139/, /AW\s*109/, /A\s*109/, /BELL\s*407/, /BO\s*-?\s*105/,
    /AS\s*350(?:\s*B3)?/, /EC\s*130/, /ROBINSON\s*66|(?:^|[^A-ZА-Я0-9])R\s*66(?:$|[^A-ZА-Я0-9])/, /ROBINSON\s*44|(?:^|[^A-ZА-Я0-9])R\s*44(?:$|[^A-ZА-Я0-9])/,
  ];
  const match = candidates.map((pattern) => source.match(pattern)?.[0]).find(Boolean);
  return match ? canonicalAircraftType(match) : "";
}

function flightPurpose(text: string): string {
  const source = text.toLocaleUpperCase("ru-RU");
  if (/АОН\s*\(?\s*УТП/.test(source)) return "АОН (УТП)";
  if (/(?:^|[^А-ЯЁ])КВП(?:$|[^А-ЯЁ])/.test(source)) return "КВП";
  if (/(?:^|[^А-ЯЁ])АОН(?:$|[^А-ЯЁ])/.test(source)) return "АОН";
  if (/(?:^|[^А-ЯЁ])АР(?:$|[^А-ЯЁ])/.test(source)) return "АР";
  return "";
}

function personText(text: string): string {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const labeled = lines.find((line) => /командир\s*вс/i.test(line));
  const source = labeled?.replace(/^.*?командир\s*вс\s*[:—-]?\s*/i, "") ?? "";
  const full = /([А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+)/.exec(source)?.[1];
  if (full) return full;
  return /([А-ЯЁ][а-яё-]+\s+[А-ЯЁ]\.?\s*[А-ЯЁ]\.?(?:\s|$))/.exec(text)?.[1]?.trim() ?? "";
}

function matchPerson(value: string, people: WorkTimeImportPerson[]): string {
  if (!value) return "";
  const key = personMatchKey(value);
  const exact = people.filter((person) => personMatchKey(person.name) === key);
  if (exact.length === 1) return exact[0].id;
  const surname = value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").split(/\s+/)[0];
  const surnameMatches = people.filter((person) => person.name.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").startsWith(`${surname} `));
  return surnameMatches.length === 1 ? surnameMatches[0].id : "";
}

function knownPerson(text: string, people: WorkTimeImportPerson[]): WorkTimeImportPerson | null {
  const normalized = text.toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
  const matches = people.filter((person) => {
    const surname = person.name.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").split(/\s+/)[0];
    return surname.length > 2 && normalized.includes(surname);
  });
  return matches.length === 1 ? matches[0] : null;
}

function hintedTime(value = ""): string {
  const direct = normalizedClock(value);
  if (direct) return direct;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 3 || digits.length === 4) {
    const hours = Number(digits.slice(0, -2));
    const minutes = Number(digits.slice(-2));
    if (hours <= 23 && minutes <= 59) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  return "";
}

function hintedDuration(value = ""): number {
  const direct = durationMinutes(value);
  if (direct) return direct;
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 2 && digits.length <= 4) {
    const hours = Number(digits.slice(0, -2) || "0");
    const minutes = Number(digits.slice(-2));
    if (minutes <= 59) return hours * 60 + minutes;
  }
  return 0;
}

function flightDurations(text: string): number[] {
  const reportRows = text.split(/продолжительность\s+пол[её]тной\s+смены/i)[0];
  const lines = reportRows.split(/\r?\n/).map(clean).filter(Boolean);
  const result: number[] = [];
  for (const line of lines) {
    const withoutDate = line.replace(/\b\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\b/g, " ");
    const times = [...withoutDate.matchAll(/\b(\d{1,2})[.:,](\d{2})\b/g)].map((match) => Number(match[1]) * 60 + Number(match[2]));
    // Строка рейса обычно содержит четыре отметки UTC и три продолжительности.
    if (times.length >= 7) {
      const value = times[6];
      if (value > 0 && value <= 12 * 60) result.push(value);
    }
  }
  return result.slice(0, 20);
}

function totalFlight(text: string): number {
  const crewBlock = text.match(/нал[её]т\s+экипажа[\s\S]{0,600}/i)?.[0] ?? text;
  const values = [...crewBlock.matchAll(/\b(\d{1,3})[.:,](\d{2})\b/g)]
    .filter((match) => Number(match[2]) <= 59)
    .map((match) => Number(match[1]) * 60 + Number(match[2]));
  return values.find((value) => value > 0 && value <= 24 * 60) ?? 0;
}

function landingCount(text: string): number {
  const block = text.match(/нал[её]т\s+экипажа[\s\S]{0,600}/i)?.[0] ?? "";
  const numbers = [...block.matchAll(/(?:^|\s)(\d{1,2})(?:\s|$)/g)].map((match) => Number(match[1]));
  return numbers.find((value) => value > 0 && value < 30) ?? 0;
}

export function buildFlightTaskOcr(source: FlightTaskOcrSource, people: WorkTimeImportPerson[]): FlightTaskOcrResult {
  const all = `${source.page1}\n${source.page2}`;
  const warnings: string[] = [];
  const recognizedPerson = knownPerson(all, people);
  const name = recognizedPerson?.name || personText(source.page1) || personText(source.page2);
  const date = isoDate(source.page1) || isoDate(source.page2) || isoDate(source.fileName ?? "");
  const type = aircraftType(source.page1, source.fileName);
  const number = aircraftNumber(source.page1) || aircraftNumber(source.fileName ?? "");
  const purpose = flightPurpose(source.page1);
  const shiftBlock = (source.page2.match(/продолжительность\s+пол[её]тной\s+смены[\s\S]{0,900}/i)?.[0] ?? source.page2)
    .replace(/\b\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\b/g, " ");
  const clocks = [...shiftBlock.matchAll(/\b(\d{1,2})[.:,](\d{2})\b/g)].map((match) => normalizedClock(match[0])).filter(Boolean);
  const dutyStart = hintedTime(source.hints?.dutyStart) || clocks[0] || "";
  const dutyEnd = hintedTime(source.hints?.dutyEnd) || clocks[1] || "";
  let durations = source.hints?.legFlights?.map(hintedDuration).filter((value) => value > 0) ?? [];
  if (!durations.length) durations = flightDurations(source.page2);
  const total = hintedDuration(source.hints?.totalFlight) || totalFlight(source.page2);
  if (durations.length > 1 && total && Math.abs(durations.reduce((sum, value) => sum + value, 0) - total) > 2) {
    durations = [total];
    warnings.push("Итоговый налёт найден, но разбивка по отдельным полётам требует ручной проверки.");
  }
  if (!durations.length && total) durations = [total];
  const landings = Number(source.hints?.landings?.match(/\d{1,2}/)?.[0] ?? 0) || landingCount(source.page2);
  const legs = durations.map((minutes, index) => ({
    id: uid(),
    flightMinutes: minutes,
    nightMinutes: 0,
    dayLandings: index === 0 && durations.length === 1 ? landings : 1,
    nightLandings: 0,
  }));
  if (legs.length > 1 && landings && landings !== legs.length) legs[0].dayLandings += landings - legs.length;
  if (!name) warnings.push("Не удалось уверенно определить сотрудника.");
  if (!date) warnings.push("Не удалось определить дату смены.");
  if (!dutyStart || !dutyEnd) warnings.push("Проверьте начало и окончание смены.");
  if (!type) warnings.push("Не удалось определить тип ВС.");
  if (!number) warnings.push("Не удалось определить бортовой номер.");
  if (!purpose) warnings.push("Не удалось определить цель полёта.");
  if (!legs.length) warnings.push("Не удалось определить полётное время.");
  const fields = [name, date, dutyStart, dutyEnd, type, number, purpose, legs.length ? "legs" : ""].filter(Boolean).length;
  return {
    draft: {
      personId: recognizedPerson?.id ?? matchPerson(name, people), personText: name, date, dutyStart, dutyEnd,
      aircraftType: type, aircraft: number, purpose: purpose || "АОН", seat: "КВС", legs,
      note: `Импортировано из полётного задания${source.fileName ? ` «${source.fileName}»` : ""}. Проверено перед сохранением.`,
    },
    warnings,
    recognizedFields: fields,
  };
}

export function sumFlightTaskLegs(legs: FlightTaskLegDraft[]) {
  return legs.reduce((result, leg) => ({
    flightMinutes: result.flightMinutes + Math.max(0, leg.flightMinutes || 0),
    nightMinutes: result.nightMinutes + Math.max(0, leg.nightMinutes || 0),
    dayLandings: result.dayLandings + Math.max(0, leg.dayLandings || 0),
    nightLandings: result.nightLandings + Math.max(0, leg.nightLandings || 0),
  }), { flightMinutes: 0, nightMinutes: 0, dayLandings: 0, nightLandings: 0 });
}
