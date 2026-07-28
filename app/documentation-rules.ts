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
  senderEmail: string;
  senderPhone: string;
};

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
  trainingPrograms: [],
  trainingProgramHours: {},
  senderEmail: "",
  senderPhone: "",
};

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
  return `${(numbers.length ? Math.max(...numbers) : 0) + 1}${registrySuffixes[kind]}`;
}

export function splitPersonName(fullName: string): { lastName: string; firstName: string; patronymic: string } {
  const [lastName = "", firstName = "", patronymic = ""] = fullName.trim().split(/\s+/);
  return { lastName, firstName, patronymic };
}

export function safeFilePart(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, "_").slice(0, 90) || "документ";
}
