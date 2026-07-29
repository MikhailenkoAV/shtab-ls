export type DocumentRegistryKind = "order" | "act" | "protocol" | "certificate";

export type DocumentRegistryRecord = {
  id: string;
  kind: DocumentRegistryKind;
  number: string;
  date: string;
  subject: string;
  createdAt: string;
};

export type DocumentPersonProfile = {
  birthDate: string;
  pilotLicenceKind: string;
  pilotLicenceNumber: string;
  snils: string;
  passportSeries: string;
  passportNumber: string;
  educationDocumentSeries: string;
  educationDocumentNumber: string;
  educationQualification: string;
  educationLevel: string;
  email: string;
  phone: string;
};

export type DocumentSettings = {
  trainingCenterName: string;
  trainingCenterHead: string;
  trainingPrograms: string[];
  trainingProgramHours: Record<string, string[]>;
  trainingProgramKinds: Record<string, string>;
  trainingProgramVariants: Record<string, { kind: string; hours: string }[]>;
  trainingProgramsVersion: number;
  senderEmail: string;
  senderPhone: string;
};

export const TRAINING_PROGRAMS_VERSION = 1;
export const DEFAULT_TRAINING_PROGRAMS = [
  ["Подготовка членов летных экипажей в области человеческого фактора и управления ресурсами экипажа в кабине воздушного судна", "Первоначальное обучение", "40"],
  ["Подготовка членов летных экипажей в области человеческого фактора и управления ресурсами экипажа в кабине воздушного судна", "Повышение квалификации", "16"],
  ["Программа подготовки летчиков-наблюдателей", "Повышение квалификации", "16"],
  ["Подготовка членов летных экипажей по авиационной безопасности", "Повышение квалификации", "16"],
  ["Перевозка опасных грузов воздушным транспортом (10 категория ИКАО)", "Повышение квалификации", "16"],
  ["Ежегодная аварийно-спасательная подготовка пилотов (экипажей) на легких и тяжелых ВС при вынужденной посадке на сушу", "Повышение квалификации", "16"],
  ["Аварийно-спасательная подготовка летных экипажей ВС при вынужденной посадке на воду", "Повышение квалификации", "16"],
  ["Программа подготовки частных пилотов на вертолет BO-105", "Первоначальное обучение", "268"],
  ["Переподготовка пилотов на вертолет ВО-105", "Повышение квалификации", "113"],
  ["Периодическая наземная подготовка пилотов вертолета BО-105", "Повышение квалификации", "36"],
  ["Программа подготовки частных пилотов на вертолет ROBINSON R 44", "Первоначальное обучение", "268"],
  ["Переподготовка пилотов на вертолет ROBINSON R 44", "Повышение квалификации", "113"],
  ["Периодическая наземная подготовка пилотов вертолета ROBINSON R 44", "Повышение квалификации", "36"],
  ["Переподготовка пилотов на вертолет ROBINSON R 66", "Повышение квалификации", "113"],
  ["Периодическая наземная подготовка пилотов вертолета ROBINSON R 66", "Повышение квалификации", "36"],
  ["Переподготовка пилотов на вертолет AS 350", "Повышение квалификации", "106"],
  ["Периодическая наземная подготовка пилотов вертолета AS 350", "Повышение квалификации", "36"],
  ["Переподготовка пилотов на вертолет EC 130", "Повышение квалификации", "113"],
  ["Переподготовка пилотов на вертолет A109S (AW109SP)", "Повышение квалификации", "106"],
  ["Переподготовка пилотов на вертолет АНСАТ", "Повышение квалификации", "106"],
  ["Дополнительная профессиональная программа повышения квалификации «Переподготовка пилотов на вертолет BELL 429»", "Повышение квалификации", "106"],
  ["Подготовка инженерно-технического персонала по техническому обслуживанию ЛАиД и АиРЭО вертолета ВО-105 series с двигателями RR Corp 250-C20B", "Повышение квалификации", "116"],
  ["Подготовка инженерно-технического персонала по техническому обслуживанию ЛАиД и АиРЭО вертолета AS 350 с двигателем Arriel 2", "Повышение квалификации", "124"],
  ["Подготовка инженерно-технического персонала по техническому обслуживанию ЛАиД и АиРЭО вертолета EC130 с двигателем Arriel 2", "Повышение квалификации", "124"],
  ["Подготовка инженерно-технического персонала по техническому обслуживанию ЛАиД и АиРЭО по изучению отличий вертолета AS350 с двигателем Arriel 2 от вертолета EC130 с двигателем Arriel 2", "Повышение квалификации", "42"],
  ["Подготовка инженерно-технического персонала по техническому обслуживанию ЛАиД и АиРЭО по изучению отличий вертолета EC130 с двигателем Arriel 2D от вертолета AS350 с двигателем Arriel 2", "Повышение квалификации", "42"],
  ["Подготовка инженерно-технического персонала по техническому обслуживанию ЛАиД и АиРЭО вертолета BELL 407 с двигателем Allison 250-C47 с модификациями", "Повышение квалификации", "112"],
  ["Подготовка инженерно-технического персонала по техническому обслуживанию ЛАиД и АиРЭО вертолета BELL 429 с двигателем PW207D1/D2", "Повышение квалификации", "120"],
] as const;

const defaultProgramNames: string[] = [...new Set<string>(DEFAULT_TRAINING_PROGRAMS.map(([name]) => name))];
const defaultProgramHours = Object.fromEntries(defaultProgramNames.map((name) => [
  name,
  [...new Set(DEFAULT_TRAINING_PROGRAMS.filter(([item]) => item === name).map(([, , hours]) => hours))],
]));
const defaultProgramKinds = Object.fromEntries(defaultProgramNames.map((name) => [
  name,
  [...new Set(DEFAULT_TRAINING_PROGRAMS.filter(([item]) => item === name).map(([, kind]) => kind))].join(" / "),
]));
const defaultProgramVariants = Object.fromEntries(defaultProgramNames.map((name) => [
  name,
  DEFAULT_TRAINING_PROGRAMS.filter(([item]) => item === name).map(([, kind, hours]) => ({ kind, hours })),
]));

export const EMPTY_DOCUMENT_PROFILE: DocumentPersonProfile = {
  birthDate: "",
  pilotLicenceKind: "Свидетельство пилота",
  pilotLicenceNumber: "",
  snils: "",
  passportSeries: "",
  passportNumber: "",
  educationDocumentSeries: "",
  educationDocumentNumber: "",
  educationQualification: "",
  educationLevel: "",
  email: "",
  phone: "",
};

export const EMPTY_DOCUMENT_SETTINGS: DocumentSettings = {
  trainingCenterName: "",
  trainingCenterHead: "",
  trainingPrograms: defaultProgramNames,
  trainingProgramHours: defaultProgramHours,
  trainingProgramKinds: defaultProgramKinds,
  trainingProgramVariants: defaultProgramVariants,
  trainingProgramsVersion: TRAINING_PROGRAMS_VERSION,
  senderEmail: "",
  senderPhone: "",
};

export function normalizeDocumentSettings(value?: Partial<DocumentSettings>): DocumentSettings {
  const saved = value ?? {};
  const customPrograms = (saved.trainingPrograms ?? []).filter((name) => !defaultProgramNames.includes(name));
  return {
    ...EMPTY_DOCUMENT_SETTINGS,
    ...saved,
    trainingPrograms: saved.trainingProgramsVersion === TRAINING_PROGRAMS_VERSION
      ? (saved.trainingPrograms?.length ? saved.trainingPrograms : defaultProgramNames)
      : [...defaultProgramNames, ...customPrograms],
    trainingProgramHours: { ...defaultProgramHours, ...(saved.trainingProgramHours ?? {}) },
    trainingProgramKinds: { ...defaultProgramKinds, ...(saved.trainingProgramKinds ?? {}) },
    trainingProgramVariants: { ...defaultProgramVariants, ...(saved.trainingProgramVariants ?? {}) },
    trainingProgramsVersion: TRAINING_PROGRAMS_VERSION,
  };
}

export const registryKindLabels: Record<DocumentRegistryKind, string> = {
  order: "Приказы",
  act: "Акты",
  protocol: "Протоколы",
  certificate: "Справки",
};

const registrySuffixes: Record<DocumentRegistryKind, string> = {
  order: "-ЛС",
  act: "",
  protocol: "/ЛС",
  certificate: "-ЛС",
};

function leadingNumber(value: string): number | null {
  const match = /^\s*(\d+)/.exec(value);
  return match ? Number(match[1]) : null;
}

export function nextRegistryNumber(
  records: DocumentRegistryRecord[],
  kind: DocumentRegistryKind,
  date: string,
): string {
  const year = date.slice(0, 4);
  const numbers = records
    .filter((record) => record.kind === kind && (!year || record.date.startsWith(year)))
    .map((record) => leadingNumber(record.number))
    .filter((value): value is number => value !== null);
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  if (kind === "order") return `${next}/${year.slice(-2)}-ЛС`;
  return `${next}${registrySuffixes[kind]}`;
}

export function splitPersonName(fullName: string): { lastName: string; firstName: string; patronymic: string } {
  const [lastName = "", firstName = "", patronymic = ""] = fullName.trim().split(/\s+/);
  return { lastName, firstName, patronymic };
}

export function safeFilePart(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, "_").slice(0, 90) || "документ";
}
